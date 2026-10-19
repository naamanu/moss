// moss run   <file.moss>             run its `main` with Node
// moss check <file.moss>
// moss build <file.moss> [-o dist]   bundle it for the browser (main starts the app)
// moss dev   <file.moss> [--port 5173]
//
// build and dev also publish the project's `public/` directory (next to its
// moss.json) as static files: dev serves them, build copies them.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { MossError, check, compile, formatError } from "./compiler/compile.ts";
import { projectLoader, projectRoot, runtimeExports } from "./node.ts";

const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), "runtime/index.ts");

const warn = (w: MossError) => console.warn(formatError(w, "warning"));

/** Compile a .moss file and bundle it with the runtime into one browser script. */
export async function bundle(file: string, minify = true): Promise<string> {
  const src = readFileSync(file, "utf8");
  const opts = { loader: projectLoader(file), runtimeExports: await runtimeExports(file), requireMain: true, onWarning: warn };
  const js = compile(src, file, opts) + `\nR.runMain(main);\n`;
  return esbundle(js, file, { minify, platform: "browser" });
}

async function esbundle(js: string, file: string, o: { minify: boolean; platform: "browser" | "node" }): Promise<string> {
  const out = await esbuild.build({
    stdin: { contents: js, resolveDir: dirname(resolve(file)), loader: "js", sourcefile: basename(file) + ".js" },
    bundle: true,
    write: false,
    format: "esm",
    minify: o.minify,
    platform: o.platform,
    target: "es2022",
    plugins: [
      {
        name: "moss-runtime",
        setup(b) {
          b.onResolve({ filter: /^moss\/runtime$/ }, () => ({ path: RUNTIME }));
        },
      },
    ],
  });
  return out.outputFiles[0]!.text;
}

function html(title: string, css: string, extra = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="module" src="app.js"></script>
${extra}
</body>
</html>
`;
}

/** Optional stylesheet next to the source: foo.moss -> foo.css */
function cssFor(file: string): string {
  const css = file.replace(/\.moss$/, ".css");
  return existsSync(css) ? readFileSync(css, "utf8") : "";
}

function report(e: unknown): string {
  if (e instanceof MossError) return formatError(e);
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, file, ...rest] = argv;
  const flag = (name: string, def: string) => {
    const i = rest.indexOf(name);
    return i >= 0 && rest[i + 1] ? rest[i + 1]! : def;
  };
  if (!cmd || !file || !["run", "check", "build", "dev"].includes(cmd)) {
    console.error("usage: moss <run|check|build|dev> <file.moss> [-o dir] [--port n]");
    return 2;
  }

  if (cmd === "run") {
    let js: string;
    try {
      const src = readFileSync(file, "utf8");
      const exports = await runtimeExports(file);
      js = compile(src, file, { loader: projectLoader(file), runtimeExports: exports, requireMain: true, onWarning: warn });
      js = await esbundle(`${js}\nR.runMain(main);\n`, file, { minify: false, platform: "node" });
    } catch (e) {
      console.error(report(e));
      return 1;
    }
    const dir = mkdtempSync(join(tmpdir(), "moss-run-"));
    const out = join(dir, "main.mjs");
    writeFileSync(out, js);
    try {
      await import(pathToFileURL(out).href);
    } catch (e) {
      console.error(e instanceof Error ? `error: ${e.message}` : e);
      return 1;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Let pending tasks (timers, fetches) finish before exiting.
    return new Promise<number>((done) => process.once("beforeExit", () => done(0)));
  }

  if (cmd === "check") {
    try {
      const { warnings } = check(readFileSync(file, "utf8"), file, projectLoader(file));
      for (const w of warnings) console.warn(formatError(w, "warning"));
      console.log(`${file}: ok${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : ""}`);
      return 0;
    } catch (e) {
      console.error(report(e));
      return 1;
    }
  }

  if (cmd === "build") {
    const out = flag("-o", "dist");
    try {
      const js = await bundle(file, true);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "app.js"), js);
      writeFileSync(join(out, "index.html"), html(basename(file, ".moss"), cssFor(file)));
      const pub = join(projectRoot(file), "public");
      if (existsSync(pub)) cpSync(pub, out, { recursive: true });
      console.log(`wrote ${join(out, "index.html")} and ${join(out, "app.js")} (${(js.length / 1024).toFixed(1)} KiB)`);
      return 0;
    } catch (e) {
      console.error(report(e));
      return 1;
    }
  }

  // dev server with live reload
  const port = Number(flag("--port", "5173"));
  let js = "";
  let error: string | null = null;
  const clients = new Set<ServerResponse>();
  const rebuild = async () => {
    try {
      js = await bundle(file, false);
      error = null;
      console.log(`[moss] built ${file}`);
    } catch (e) {
      error = report(e);
      console.error(error);
    }
    for (const c of clients) c.write("data: reload\n\n");
  };
  await rebuild();
  let timer: NodeJS.Timeout | undefined;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 50);
  };
  // Watch the whole project: modules, styles, and its JS runtime.
  const root = projectRoot(file);
  watch(root, { recursive: true }, (_, name) => {
    if (name && /\.(moss|css|ts)$/.test(name) && !/(^|[\\/])(node_modules|dist|public)[\\/]/.test(name)) onChange();
  });
  const pub = resolve(root, "public");
  const TYPES: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".html": "text/html; charset=utf-8" };

  const reload = `<script>new EventSource("/__events").onmessage = () => location.reload();</script>`;
  createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/__events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": hi\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      res.end(error ? "" : js);
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      if (error) {
        const esc = error.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        res.end(`<!doctype html><title>moss: error</title><pre style="padding:16px;color:#b00;font:14px/1.4 ui-monospace,monospace">${esc}</pre>${reload}`);
      } else res.end(html(basename(file, ".moss"), cssFor(file), reload));
      return;
    }
    // Static files from public/ (never outside it).
    const path = resolve(pub, "." + decodeURIComponent(url.pathname));
    if (path.startsWith(pub + "/") && existsSync(path) && statSync(path).isFile()) {
      const ext = path.slice(path.lastIndexOf("."));
      res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(readFileSync(path));
      return;
    }
    res.writeHead(404).end("not found");
  }).listen(port, () => console.log(`[moss] dev server on http://localhost:${port}`));
  return new Promise(() => {});
}

main(process.argv.slice(2)).then((code) => process.exit(code));
