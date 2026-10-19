// Node-side project loading: moss.json manifests, packages and their runtimes.
// The compiler itself never touches the filesystem; it only sees a Loader.
//
// moss.json (all fields optional):
//   {
//     "name": "rhizoid",
//     "src": "src",                     modules of this package
//     "runtime": "runtime/index.ts",    JS module implementing its externals
//     "dependencies": { "rhizoid": "../rhizoid" }   other packages, by path
//   }
//
// A file belongs to the project of the nearest moss.json above it. Its
// imports resolve to, in order: a module next to the file, a module in the
// project's `src`, a module in a dependency's `src` (transitively), and
// finally the standard library.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type Loader, fileNameOf } from "./compiler/compile.ts";

interface Manifest {
  name?: string;
  src?: string;
  runtime?: string;
  dependencies?: Record<string, string>;
}

export interface Package {
  name: string;
  dir: string;
  /** Absolute directory of the package's modules. */
  src: string;
  /** Absolute path of the package's JS runtime, if it has one. */
  runtime?: string;
}

function readManifest(dir: string): Manifest {
  const path = join(dir, "moss.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
}

function findProjectDir(file: string): string | undefined {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "moss.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function toPackage(dir: string, m: Manifest): Package {
  return {
    name: m.name ?? dir.split(/[\\/]/).pop()!,
    dir,
    src: resolve(dir, m.src ?? "."),
    runtime: m.runtime ? resolve(dir, m.runtime) : undefined,
  };
}

/** The project containing `file`, then its dependencies (depth-first, each once). */
export function packagesFor(file: string): Package[] {
  const root = findProjectDir(file);
  if (!root) return [];
  const out: Package[] = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const m = readManifest(dir);
    out.push(toPackage(dir, m));
    for (const [name, path] of Object.entries(m.dependencies ?? {})) {
      const dep = resolve(dir, path);
      if (!existsSync(join(dep, "moss.json"))) throw new Error(`${join(dir, "moss.json")}: dependency '${name}' has no moss.json at ${dep}`);
      add(dep);
    }
  };
  add(root);
  return out;
}

/** A loader for `file`'s project: neighbours, then project and dependency packages. */
export function projectLoader(file: string): Loader {
  const here = dirname(resolve(file));
  const packages = packagesFor(file);
  const shown = (abs: string) => relative(process.cwd(), abs) || abs;
  const ownRuntime = packages[0]?.runtime;
  return (m) => {
    const name = fileNameOf(m);
    const local = join(here, name);
    if (existsSync(local)) return { file: shown(local), source: readFileSync(local, "utf8"), runtime: ownRuntime };
    for (const p of packages) {
      const path = join(p.src, name);
      if (existsSync(path)) return { file: shown(path), source: readFileSync(path, "utf8"), runtime: p.runtime };
    }
    return undefined;
  };
}

/** Import every package runtime, for checking externals against them. */
export async function runtimeExports(file: string): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const p of packagesFor(file)) {
    if (p.runtime) out[p.runtime] = (await import(p.runtime)) as Record<string, unknown>;
  }
  return out;
}
