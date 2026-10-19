import * as Runtime from "../runtime/index.ts";
import { type Decl, type Expr, PRELUDE, type Pat, type Program, type TypeExpr } from "./ast.ts";
import { codegen } from "./codegen.ts";
import { desugar } from "./desugar.ts";
import { MossError, type Span, sources } from "./errors.ts";
import { parse } from "./parser.ts";
import { STDLIB } from "./stdlib.generated.ts";
import { type Checked, typecheck } from "./typecheck.ts";

export { MossError, formatError } from "./errors.ts";

export interface CompileOptions {
  /** Module specifier the generated code imports the runtime from. */
  runtimeImport?: string;
  /** Require an `app` declaration (true for builds, false for `check`). */
  requireApp?: boolean;
  /** Require a `main : unit effect` in the entry module (for `moss run`). */
  requireMain?: boolean;
  /** Called with each non-fatal diagnostic (e.g. unused match cases). */
  onWarning?: (w: MossError) => void;
  /**
   * "library" (default): `let*`/`let+`/`and+`/`and*`/`match*` call the
   * binding operators in scope. "builtin": the compiler's own typing and
   * codegen for vals and computations (kept to check equivalence).
   */
  binders?: Binders;
  /** Finds the entry module's dependencies; the standard library is always available. */
  loader?: Loader;
}

export type Binders = "library" | "builtin";

export interface ModuleSource {
  /** Shown in diagnostics. */
  file: string;
  source: string;
}

/** Finds a module's source by module name (`Todo_utils` -> todo_utils.moss), or undefined. */
export type Loader = (module: string) => ModuleSource | undefined;

/** `todo_utils.moss` -> `Todo_utils` */
export function moduleNameOf(file: string): string {
  const base = file.split(/[\\/]/).pop()!.replace(/\.moss$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** `Todo_utils` -> `todo_utils.moss` */
export function fileNameOf(module: string): string {
  return module.charAt(0).toLowerCase() + module.slice(1) + ".moss";
}

const stdlib: Loader = (m) => (STDLIB[m] === undefined ? undefined : { file: `<stdlib>/${fileNameOf(m)}`, source: STDLIB[m] });

// ---------------------------------------------------------------------------
// Module graph

/** Modules referenced by qualified names (`M.x`, `M.t`, `M.C`) or `open M`, with where. */
function dependencies(decls: Decl[]): Map<string, Span> {
  const deps = new Map<string, Span>();
  const note = (name: string, span: Span) => {
    const dot = name.lastIndexOf(".");
    if (dot > 0 && !deps.has(name.slice(0, dot))) deps.set(name.slice(0, dot), span);
  };
  const ty = (t: TypeExpr): void => {
    switch (t.t) {
      case "con":
        note(t.name, t.span);
        t.args.forEach(ty);
        return;
      case "fun":
        ty(t.from);
        ty(t.to);
        return;
      case "tuple":
        t.items.forEach(ty);
    }
  };
  const pat = (p: Pat): void => {
    switch (p.p) {
      case "ctor":
        note(p.name, p.span);
        if (p.arg) pat(p.arg);
        return;
      case "tuple":
        p.items.forEach(pat);
        return;
      case "cons":
        pat(p.head);
        pat(p.tail);
        return;
      case "annot":
        pat(p.pat);
        ty(p.type);
    }
  };
  const expr = (e: Expr): void => {
    switch (e.e) {
      case "var":
        return note(e.name, e.span);
      case "ctor":
        note(e.name, e.span);
        if (e.arg) expr(e.arg);
        return;
      case "app":
        expr(e.fn);
        e.args.forEach(expr);
        return;
      case "fun":
        e.params.forEach(pat);
        return expr(e.body);
      case "let":
        pat(e.pat);
        e.params.forEach(pat);
        expr(e.value);
        return expr(e.body);
      case "letstar":
        pat(e.pat);
        expr(e.value);
        e.ands.forEach((b) => (pat(b.pat), expr(b.value)));
        return expr(e.body);
      case "letplus":
        e.binds.forEach((b) => (pat(b.pat), expr(b.value)));
        return expr(e.body);
      case "if":
        expr(e.cond);
        expr(e.then);
        return expr(e.else);
      case "match":
      case "matchstar":
        expr(e.scrut);
        for (const c of e.cases) {
          pat(c.pat);
          if (c.guard) expr(c.guard);
          expr(c.body);
        }
        return;
      case "tuple":
      case "list":
        return e.items.forEach(expr);
      case "record":
        return e.fields.forEach((f) => expr(f.value));
      case "update":
        expr(e.base);
        return e.fields.forEach((f) => expr(f.value));
      case "field":
        return expr(e.target);
      case "binop":
        expr(e.left);
        return expr(e.right);
      case "neg":
        return expr(e.arg);
      case "annot":
        expr(e.expr);
        return ty(e.type);
    }
  };
  for (const d of decls) {
    switch (d.d) {
      case "open":
        if (!deps.has(d.name)) deps.set(d.name, d.span);
        break;
      case "let":
        d.params.forEach(pat);
        expr(d.body);
        break;
      case "app":
        expr(d.expr);
        break;
      case "external":
        ty(d.type);
        break;
      case "type":
        if (d.def.kind === "variant") d.def.ctors.forEach((c) => c.arg && ty(c.arg));
        else if (d.def.kind === "record") d.def.fields.forEach((f) => ty(f.type));
        else if (d.def.kind === "alias") ty(d.def.type);
        break;
    }
  }
  return deps;
}

/**
 * Parse the entry module and everything it depends on, and order all
 * declarations so each module comes after the modules it uses (Prelude first).
 */
function loadProgram(src: string, file: string, loader: Loader | undefined): Program {
  const entry = moduleNameOf(file);
  const find = (m: string): ModuleSource | undefined => (m === entry ? { file, source: src } : (loader?.(m) ?? stdlib(m)));
  const decls: Decl[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];

  const visit = (m: string, from?: Span): void => {
    if (done.has(m)) return;
    if (visiting.includes(m)) {
      const cycle = [...visiting.slice(visiting.indexOf(m)), m].join(" -> ");
      throw new MossError(`modules depend on each other in a cycle: ${cycle}`, from);
    }
    const s = find(m);
    if (!s) throw new MossError(`unknown module '${m}' (no ${fileNameOf(m)} found)`, from);
    sources.set(s.file, s.source);
    const own = parse(s.source, s.file).decls;
    visiting.push(m);
    for (const [dep, span] of dependencies(own)) if (dep !== m && dep !== PRELUDE) visit(dep, span);
    visiting.pop();
    done.add(m);
    for (const d of own) decls.push({ ...d, mod: m });
  };

  visit(PRELUDE);
  visit(entry);
  return { decls, entry };
}

export function check(src: string, file = "main.moss", binders: Binders = "library", loader?: Loader): Checked {
  const program = loadProgram(src, file, loader);
  if (binders === "library") program.decls = program.decls.map(desugarDecl);
  return typecheck(program);
}

function desugarDecl(d: Decl): Decl {
  switch (d.d) {
    case "let":
      return { ...d, body: desugar(d.body) };
    case "app":
      return { ...d, expr: desugar(d.expr) };
    default:
      return d;
  }
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
  const checked = check(src, file, opts.binders, opts.loader);
  for (const w of checked.warnings) opts.onWarning?.(w);
  for (const d of checked.program.decls) if (d.d === "external") checkExternal(d);
  const apps = checked.program.decls.filter((d) => d.d === "app");
  if (opts.requireApp !== false && apps.length === 0) {
    throw new MossError("no 'app' declaration: add e.g. 'app page' at the end of the file", undefined);
  }
  if (apps.length > 1) throw new MossError("more than one 'app' declaration", apps[1]!.span);
  const { entry } = checked.program;
  if (opts.requireMain && !checked.program.decls.some((d) => d.d === "let" && d.name === "main" && d.mod === entry)) {
    throw new MossError(`no 'main' in ${file}: define e.g. 'let main = Effect.print "hello"'`, undefined);
  }
  return codegen(checked, opts.runtimeImport);
}
