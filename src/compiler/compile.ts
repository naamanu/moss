import type { Program } from "./ast.ts";
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

export function compile(src: string, file = "main.moss", opts: CompileOptions = {}): string {
  const checked = check(src, file);
  for (const w of checked.warnings) opts.onWarning?.(w);
  const apps = checked.program.decls.filter((d) => d.d === "app");
  if (opts.requireApp !== false && apps.length === 0) {
    throw new MossError("no 'app' declaration: add e.g. 'app main' at the end of the file", undefined);
  }
  if (apps.length > 1) throw new MossError("more than one 'app' declaration", apps[1]!.span);
  return codegen(checked, opts.runtimeImport);
}
