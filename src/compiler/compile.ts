import * as Runtime from "../runtime/index.ts";
import type { Decl, Program } from "./ast.ts";
import { codegen } from "./codegen.ts";
import { MossError, sources } from "./errors.ts";
import { parse } from "./parser.ts";
import { PRELUDE } from "./prelude.ts";
import { type Checked, typecheck } from "./typecheck.ts";

export { MossError, formatError } from "./errors.ts";

export interface CompileOptions {
  /** Module specifier the generated code imports the runtime from. */
  runtimeImport?: string;
  /** Require an `app` declaration (true for builds, false for `check`). */
  requireApp?: boolean;
  /** Called with each non-fatal diagnostic (e.g. unused match cases). */
  onWarning?: (w: MossError) => void;
}

let preludeAst: Program | undefined;

export function check(src: string, file = "main.moss"): Checked {
  sources.set("<prelude>", PRELUDE);
  sources.set(file, src);
  preludeAst ??= parse(PRELUDE, "<prelude>");
  const user = parse(src, file);
  // Parsing mutates nothing, but type inference annotates nodes: give each
  // compilation its own copy of the prelude AST.
  const prelude: Program = structuredClone(preludeAst);
  return typecheck({ decls: [...prelude.decls, ...user.decls] });
}

/**
 * An external must name a runtime export, and a function-typed external must
 * take exactly as many (uncurried) arguments as its type has arrows.
 */
function checkExternal(d: Decl & { d: "external" }): void {
  const impl = (Runtime as Record<string, unknown>)[d.js];
  if (impl === undefined) throw new MossError(`external '${d.name}': the runtime has no export named "${d.js}"`, d.span);
  let arity = 0;
  for (let t = d.type; t.t === "fun"; t = t.to) arity++;
  if (arity === 0) return; // a value (or a function used as a value)
  if (typeof impl !== "function") throw new MossError(`external '${d.name}': runtime export "${d.js}" is not a function`, d.span);
  if (impl.length !== arity) {
    throw new MossError(`external '${d.name}': type takes ${arity} argument(s) but runtime "${d.js}" takes ${impl.length}`, d.span);
  }
}

export function compile(src: string, file = "main.moss", opts: CompileOptions = {}): string {
  const checked = check(src, file);
  for (const w of checked.warnings) opts.onWarning?.(w);
  for (const d of checked.program.decls) if (d.d === "external") checkExternal(d);
  const apps = checked.program.decls.filter((d) => d.d === "app");
  if (opts.requireApp !== false && apps.length === 0) {
    throw new MossError("no 'app' declaration: add e.g. 'app main' at the end of the file", undefined);
  }
  if (apps.length > 1) throw new MossError("more than one 'app' declaration", apps[1]!.span);
  return codegen(checked, opts.runtimeImport);
}
