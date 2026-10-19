// moss check <file.moss>
// moss build <file.moss> [-o dist]
// moss dev   <file.moss> [--port 5173]

import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { type Binders, MossError, check, compile, formatError } from "./compiler/compile.ts";

const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), "runtime/index.ts");

/** Compile a .moss file and bundle it with the runtime into one browser script. */
export async function bundle(file: string, minify = true, binders: Binders = "library"): Promise<string> {
  const src = readFileSync(file, "utf8");
  const js =
    compile(src, file, { binders, onWarning: (w) => console.warn(formatError(w, "warning")) }) +
    `\nR.run(main, document.getElementById("app"), { debug: /[?&]debug\\b/.test(location.search) });\n`;
  const out = await esbuild.build({
    stdin: { contents: js, resolveDir: dirname(resolve(file)), loader: "js", sourcefile: basename(file) + ".js" },
    bundle: true,
    write: false,
    format: "esm",
    minify,
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
  const binders: Binders = rest.includes("--builtin-binders") ? "builtin" : "library";
  const flag = (name: string, def: string) => {
    const i = rest.indexOf(name);
    return i >= 0 && rest[i + 1] ? rest[i + 1]! : def;
  };
  if (!cmd || !file || !["check", "build", "dev"].includes(cmd)) {
    console.error("usage: moss <check|build|dev> <file.moss> [-o dir] [--port n] [--builtin-binders]");
    return 2;
  }

  if (cmd === "check") {
    try {
      const { warnings } = check(readFileSync(file, "utf8"), file, binders);
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
      const js = await bundle(file, true, binders);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "app.js"), js);
      writeFileSync(join(out, "index.html"), html(basename(file, ".moss"), cssFor(file)));
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
      js = await bundle(file, false, binders);
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
  watch(file, onChange);
  const css = file.replace(/\.moss$/, ".css");
  if (existsSync(css)) watch(css, onChange);

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
    res.writeHead(404).end("not found");
  }).listen(port, () => console.log(`[moss] dev server on http://localhost:${port}`));
  return new Promise(() => {});
}

main(process.argv.slice(2)).then((code) => process.exit(code));
