// Hindley–Milner type inference (Algorithm W with levels) for Moss.
//
// The compiler knows nothing about UI: libraries such as Rhizoid declare
// abstract types (e.g. `'a val`) whose only operations are their externals,
// so an incremental value can't be read outside the library's `let+`.
// Attributes on type declarations ([@@opaque], [@@hint_found],
// [@@hint_expected]) supply comparability and error hints.

import { type Attr, BINDING_OPS, type Decl, type Expr, PRELUDE, type Pat, type Program, type TypeExpr, qualify } from "./ast.ts";
import { MossError, type Span } from "./errors.ts";
import { resolveLetStar } from "./desugar.ts";
import { checkMatch, type VariantCtor } from "./exhaustive.ts";
import {
  type Scheme,
  type TVar,
  type Type,
  TypePrinter,
  UnifyError,
  arity,
  generalize,
  instantiate,
  mono,
  prune,
  tBool,

  tFloat,

  tInt,
  tList,
  tString,
  tUnit,

  tcon,
  tfun,
  ttuple,
  tvar,
  printContext,
  substitute,
  typeName,
  unify,
} from "./types.ts";

/**
 * A type definition, resolved once where it's declared (so names in it mean
 * what they meant in its own module, opens included). Its parts are written
 * in terms of `vars`, one per parameter, and are instantiated by substitution.
 */
interface TypeInfo {
  params: string[];
  vars: TVar[];
  def: Decl & { d: "type" };
  /** An abbreviation's expansion; undefined while it's being declared (to catch cycles). */
  alias?: Type;
  /** A variant's constructor argument types, in declaration order. */
  ctorArgs?: (Type | null)[];
  /** A record's field types, in declaration order. */
  fields?: Map<string, Type>;
}

export interface CtorInfo {
  typeName: string;
  /** The argument type, in terms of the type definition's `vars`. */
  arg: Type | null;
  /** Position within its type's constructor list. */
  index: number;
}

/**
 * A module-level value. Everything known about a binding lives here, so
 * redefining the name (shadowing) replaces all of it at once.
 */
interface ValueInfo {
  scheme: Scheme;
  /** Attributes of an external (e.g. [@@project_with]); none for `let`. */
  attrs: Attr[];
}

export interface Checked {
  program: Program;
  /** Each module's own top-level definitions (short name -> qualified name). */
  exports: Map<string, ModEnv>;
  ctors: Map<string, CtorInfo>;
  warnings: MossError[];
}

const BUILTIN_TYPES: Record<string, number> = {
  int: 0,
  float: 0,
  string: 0,
  bool: 0,
  unit: 0,
  list: 1,
};

/** Names visible in (or exported by) a module: short name -> qualified global name. */
export class ModEnv {
  values = new Map<string, string>();
  types = new Map<string, string>();
  ctors = new Map<string, string>();
  /** field name -> qualified name of the record type that has it */
  fields = new Map<string, string>();

  addAll(o: ModEnv): void {
    for (const k of ["values", "types", "ctors", "fields"] as const) for (const [a, b] of o[k]) this[k].set(a, b);
  }
}

class Scope {
  private vars = new Map<string, Scheme>();
  constructor(readonly parent: Scope | null) {}
  get(name: string): Scheme | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const v = s.vars.get(name);
      if (v) return v;
    }
    return undefined;
  }
  set(name: string, s: Scheme): void {
    this.vars.set(name, s);
  }
  child(): Scope {
    return new Scope(this);
  }
}

export function typecheck(program: Program): Checked {
  return new Checker().check(program);
}

class Checker {
  // Global tables, keyed by qualified name (`Todo.todo`; Prelude names are unqualified).
  private types = new Map<string, TypeInfo>();
  private ctors = new Map<string, CtorInfo>();
  /** The current binding of each module-level name (later definitions replace earlier ones). */
  private values = new Map<string, ValueInfo>();
  /** Each module's own definitions. */
  private exports = new Map<string, ModEnv>();
  /** The module being checked, and the names visible in it (own + opened + Prelude). */
  private mod = PRELUDE;
  private env = new ModEnv();
  private entry: string | undefined;
  private level = 0;
  private warnings: MossError[] = [];
  /** Operand types of `=`, `<`, ... in the current declaration, checked once it's fully inferred. */
  private comparisons: { span: Span; op: string; ty: Type }[] = [];

  // -- comparability ------------------------------------------------------------

  /**
   * Why values of type `t` can't be compared structurally, or null if they can.
   * Type variables pass here; the runtime raises if they turn out to be functions.
   */
  private incomparable(t: Type, seen = new Set<string>()): string | null {
    t = prune(t);
    switch (t.k) {
      case "var":
        return null;
      case "fun":
        return "functions";
      case "tuple":
        for (const i of t.items) {
          const r = this.incomparable(i, seen);
          if (r) return r;
        }
        return null;
      case "con": {
        if (this.attr(t.name, "opaque") !== undefined) return `values of type '${typeName(t.name)}'`;
        for (const a of t.args) {
          const r = this.incomparable(a, seen);
          if (r) return r;
        }
        const info = this.types.get(t.name);
        if (!info || seen.has(t.name)) return null;
        seen.add(t.name);
        const sub = new Map<TVar, Type>(info.vars.map((v, i) => [v, t.args[i]!]));
        const parts = [...(info.ctorArgs ?? []).filter((a): a is Type => a !== null), ...(info.fields?.values() ?? [])];
        for (const part of parts) {
          const r = this.incomparable(substitute(part, sub), seen);
          if (r) return `${r} (inside '${typeName(t.name)}')`;
        }
        return null;
      }
    }
  }

  private checkComparisons(): void {
    const pending = this.comparisons;
    this.comparisons = [];
    for (const c of pending) {
      const why = this.incomparable(c.ty);
      if (why) {
        throw new MossError(
          `'${c.op}' can't compare values of type ${new TypePrinter().print(c.ty)}: it contains ${why}` +
            "\n  hint: '==' compares by identity",
          c.span,
        );
      }
    }
  }

  // -- exhaustiveness ---------------------------------------------------------

  /** All constructors (by qualified name) of the variant that `ctor` belongs to. */
  private readonly siblings = (ctor: string): VariantCtor[] => {
    const typeName = this.ctors.get(ctor)!.typeName;
    const def = this.types.get(typeName)!.def.def;
    if (def.kind !== "variant") throw new Error("not a variant");
    const dot = typeName.lastIndexOf(".");
    const m = dot < 0 ? PRELUDE : typeName.slice(0, dot);
    return def.ctors.map((c) => ({ name: qualify(m, c.name), hasArg: c.arg !== null }));
  };

  /** Error if `cases` can fail to match; warn about cases that can never match. */
  private checkCases(cases: { pat: Pat; guard: Expr | null }[], span: Span, what: string): void {
    const r = checkMatch(cases.map((c) => ({ pat: c.pat, guarded: c.guard !== null })), this.siblings);
    for (const i of r.redundant) this.warnings.push(new MossError("this case is unused: earlier cases already match every value it could", cases[i]!.pat.span));
    if (r.missing !== null) {
      throw new MossError(`${what} is not exhaustive; this value is not matched:\n  ${r.missing}`, span);
    }
  }

  /** Patterns in let/fun/let+ bindings must match every value of their type. */
  private checkIrrefutable(p: Pat): void {
    const r = checkMatch([{ pat: p, guarded: false }], this.siblings);
    if (r.missing !== null) {
      throw new MossError(`this pattern can fail to match (e.g. ${r.missing}); use 'match' instead`, p.span);
    }
  }

  check(program: Program): Checked {
    this.entry = program.entry;
    this.exports.set(PRELUDE, new ModEnv());
    for (const d of program.decls) {
      const m = d.mod ?? program.entry ?? PRELUDE;
      if (m !== this.mod) this.enterModule(m);
      this.decl(d, new Scope(null));
    }
    return { program, exports: this.exports, ctors: this.ctors, warnings: this.warnings };
  }

  /** Start checking module `m`: it sees Prelude's names, then its own. */
  private enterModule(m: string): void {
    this.mod = m;
    printContext.module = m;
    if (!this.exports.has(m)) this.exports.set(m, new ModEnv());
    this.env = new ModEnv();
    if (m !== PRELUDE) this.env.addAll(this.exports.get(PRELUDE)!);
    printContext.types = this.env.types;
  }

  /** Record a top-level definition of the current module. */
  private define(kind: "values" | "types" | "ctors" | "fields", name: string, target: string): void {
    this.env[kind].set(name, target);
    this.exports.get(this.mod)![kind].set(name, target);
  }

  /**
   * Resolve a possibly qualified name (`x` or `M.x`) to its global name, or
   * undefined if an unqualified name isn't visible.
   */
  private resolve(kind: "values" | "types" | "ctors", name: string, span: Span, what: string): string | undefined {
    const dot = name.lastIndexOf(".");
    if (dot < 0) return this.env[kind].get(name);
    const m = name.slice(0, dot);
    const short = name.slice(dot + 1);
    const ex = this.exports.get(m);
    if (!ex) throw new MossError(`unknown module '${m}'`, span);
    const q = ex[kind].get(short);
    if (!q) throw new MossError(`module '${m}' has no ${what} '${short}'`, span);
    return q;
  }

  /** A value: local variables first, then module-level names. */
  private lookupValue(scope: Scope, name: string, span: Span): { scheme: Scheme; resolved?: string } | undefined {
    if (!name.includes(".")) {
      const local = scope.get(name);
      if (local) return { scheme: local };
    }
    const q = this.resolve("values", name, span, "value");
    return q === undefined ? undefined : { scheme: this.values.get(q)!.scheme, resolved: q };
  }

  /** The record type a field belongs to: from the target's type when known, else by name. */
  private recordFor(field: string, known: Type | undefined, span: Span): string {
    const t = known && prune(known);
    if (t?.k === "con") {
      const def = this.types.get(t.name)?.def.def;
      if (def?.kind === "record" && def.fields.some((f) => f.name === field)) return t.name;
    }
    const q = this.env.fields.get(field);
    if (!q) throw new MossError(`unknown field '${field}'`, span);
    return q;
  }

  // -- errors -----------------------------------------------------------------

  private mismatch(span: Span, actual: Type, expected: Type, what = "This expression"): never {
    const p = new TypePrinter();
    const a = p.print(actual);
    const b = p.print(expected);
    let msg = `${what} has type ${a} but an expression was expected of type ${b}`;
    const hint = this.hintFor(prune(actual), prune(expected));
    if (hint) msg += `\n  hint: ${hint}`;
    throw new MossError(msg, span);
  }

  /** A library-supplied hint: the expected type's `hint_expected`, else the actual type's `hint_found`. */
  private hintFor(actual: Type, expected: Type): string | undefined {
    if (actual.k === "var" || expected.k === "var") return undefined;
    const name = (t: Type) => (t.k === "con" ? t.name : undefined);
    if (name(actual) === name(expected) && name(actual) !== undefined) return undefined;
    return (
      (name(expected) && this.attr(name(expected)!, "hint_expected")) ||
      (name(actual) && this.attr(name(actual)!, "hint_found")) ||
      undefined
    );
  }

  /** The payload of attribute `attr` on type `q` ("" if it has none), or undefined if absent. */
  private attr(q: string, attr: string): string | undefined {
    const a = this.types.get(q)?.def.attrs.find((x) => x.name === attr);
    return a === undefined ? undefined : (a.arg ?? "");
  }

  /** Unify `actual` (the type of the thing at `span`) with `expected`. */
  private expect(span: Span, actual: Type, expected: Type, what?: string): void {
    try {
      unify(actual, expected);
    } catch (e) {
      if (!(e instanceof UnifyError)) throw e;
      if (e.reason) throw new MossError(`${e.reason}: ${new TypePrinter().print(actual)}`, span);
      this.mismatch(span, actual, expected, what);
    }
  }

  // -- type expressions -------------------------------------------------------

  private convert(te: TypeExpr, vars: Map<string, Type>, fresh: boolean): Type {
    switch (te.t) {
      case "var": {
        let v = vars.get(te.name);
        if (!v) {
          if (!fresh) throw new MossError(`unbound type variable '${te.name}`, te.span);
          v = tvar(this.level + 1);
          vars.set(te.name, v);
        }
        return v;
      }
      case "fun":
        return tfun(this.convert(te.from, vars, fresh), this.convert(te.to, vars, fresh));
      case "tuple":
        return ttuple(te.items.map((i) => this.convert(i, vars, fresh)));
      case "con": {
        const args = te.args.map((a) => this.convert(a, vars, fresh));
        const builtin = BUILTIN_TYPES[te.name];
        if (builtin !== undefined) {
          if (builtin !== args.length) {
            throw new MossError(`type '${te.name}' expects ${builtin} argument(s), got ${args.length}`, te.span);
          }
          return tcon(te.name, ...args);
        }
        const q = this.resolve("types", te.name, te.span, "type");
        const info = q === undefined ? undefined : this.types.get(q);
        if (!info || q === undefined) throw new MossError(`unknown type '${te.name}'`, te.span);
        if (info.params.length !== args.length) {
          throw new MossError(`type '${te.name}' expects ${info.params.length} argument(s), got ${args.length}`, te.span);
        }
        if (info.def.def.kind === "alias") {
          if (info.alias === undefined) throw new MossError(`type abbreviation '${te.name}' is cyclic`, te.span);
          return substitute(info.alias, new Map(info.vars.map((v, i) => [v, args[i]!])));
        }
        return tcon(q, ...args);
      }
    }
  }

  // -- declarations -------------------------------------------------------------

  private decl(d: Decl, top: Scope): void {
    switch (d.d) {
      case "type":
        return this.typeDecl(d);
      case "external": {
        this.level++;
        const t = this.convert(d.type, new Map(), true);
        this.level--;
        const q = qualify(this.mod, d.name);
        this.values.set(q, { scheme: generalize(t, this.level), attrs: d.attrs });
        this.define("values", d.name, q);
        // Recorded on this declaration, so a later binding of the same name can't change it.
        d.arity = arity(t);
        return;
      }
      case "let": {
        const t = this.letBinding(d.name, d.rec, d.params, d.body, d.span, top);
        this.checkComparisons();
        if (d.name === "main" && this.mod === this.entry) {
          this.expect(d.span, instantiate(t, this.level), tcon("effect", tUnit), "'main'");
        }
        const q = qualify(this.mod, d.name);
        this.values.set(q, { scheme: t, attrs: [] });
        this.define("values", d.name, q);
        return;
      }
      case "open": {
        const ex = this.exports.get(d.name);
        if (!ex) throw new MossError(`unknown module '${d.name}'`, d.span);
        this.env.addAll(ex);
        return;
      }
    }
  }

  private typeDecl(d: Decl & { d: "type" }): void {
    const q = qualify(this.mod, d.name);
    if (this.types.has(q) || BUILTIN_TYPES[d.name] !== undefined) {
      throw new MossError(`type '${d.name}' is already defined`, d.span);
    }
    const tvars = d.params.map(() => tvar(0));
    const info: TypeInfo = { params: d.params, vars: tvars, def: d };
    // Registered before its parts are resolved, so recursive types can refer to themselves.
    this.types.set(q, info);
    this.define("types", d.name, q);
    const vars = new Map<string, Type>(d.params.map((p, i) => [p, tvars[i]!]));
    const def = d.def;
    if (def.kind === "variant") {
      info.ctorArgs = def.ctors.map((c, index) => {
        const arg = c.arg ? this.convert(c.arg, vars, false) : null;
        const cq = qualify(this.mod, c.name);
        this.ctors.set(cq, { typeName: q, arg, index });
        this.define("ctors", c.name, cq);
        return arg;
      });
    } else if (def.kind === "record") {
      info.fields = new Map();
      for (const f of def.fields) {
        info.fields.set(f.name, this.convert(f.type, vars, false));
        this.define("fields", f.name, q);
      }
    } else if (def.kind === "alias") {
      info.alias = this.convert(def.type, vars, false);
    }
  }

  /** Infer a (possibly recursive, possibly parameterized) let binding and generalize it. */
  private letBinding(name: string, rec: boolean, params: Pat[], body: Expr, span: Span, scope: Scope): Scheme {
    this.level++;
    const self = tvar(this.level);
    const inner = scope.child();
    if (rec) inner.set(name, mono(self));
    let t: Type;
    if (params.length > 0) {
      t = this.inferFun(params, body, inner);
    } else {
      t = this.infer(body, inner);
    }
    if (rec) this.expect(span, self, t);
    this.level--;
    return generalize(t, this.level);
  }

  /**
   * `expected`, when known, gives the parameters their types before the body is
   * checked (type-directed checking for `f (fun x -> ...)`), so a misuse of `x`
   * is reported where it happens rather than at the whole lambda.
   */
  private inferFun(params: Pat[], body: Expr, scope: Scope, expected?: Type): Type {
    const inner = scope.child();
    let exp = expected && prune(expected);
    const pts = params.map((p) => {
      let t: Type = tvar(this.level);
      if (exp?.k === "fun") {
        t = exp.from;
        exp = prune(exp.to);
      } else exp = undefined;
      this.bindPat(p, t, inner);
      this.checkIrrefutable(p);
      return t;
    });
    let r = this.infer(body, inner);
    for (let i = pts.length - 1; i >= 0; i--) r = tfun(pts[i]!, r);
    return r;
  }

  // -- patterns -------------------------------------------------------------

  /** Check `p` against `t`, adding its variables to `scope` (wrapped by `wrap`). */
  private bindPat(p: Pat, t: Type, scope: Scope, wrap: (t: Type) => Type = (x) => x): void {
    const seen = new Set<string>();
    const go = (p: Pat, t: Type): void => {
      switch (p.p) {
        case "wild":
          return;
        case "var":
          if (seen.has(p.name)) throw new MossError(`variable '${p.name}' is bound twice in this pattern`, p.span);
          seen.add(p.name);
          scope.set(p.name, mono(wrap(t)));
          return;
        case "int":
          return this.expect(p.span, tInt, t, "This pattern");
        case "float":
          return this.expect(p.span, tFloat, t, "This pattern");
        case "string":
          return this.expect(p.span, tString, t, "This pattern");
        case "bool":
          return this.expect(p.span, tBool, t, "This pattern");
        case "unit":
          return this.expect(p.span, tUnit, t, "This pattern");
        case "tuple": {
          const items = p.items.map(() => tvar(this.level));
          this.expect(p.span, ttuple(items), t, "This pattern");
          p.items.forEach((q, i) => go(q, items[i]!));
          return;
        }
        case "nil":
          return this.expect(p.span, tList(tvar(this.level)), t, "This pattern");
        case "cons": {
          const el = tvar(this.level);
          this.expect(p.span, tList(el), t, "This pattern");
          go(p.head, el);
          go(p.tail, tList(el));
          return;
        }
        case "ctor": {
          const { result, arg, resolved } = this.instCtor(p.name, p.span);
          p.resolved = resolved;
          this.expect(p.span, result, t, "This pattern");
          if (arg && !p.arg) throw new MossError(`constructor '${p.name}' expects an argument`, p.span);
          if (!arg && p.arg) throw new MossError(`constructor '${p.name}' takes no argument`, p.span);
          if (arg && p.arg) go(p.arg, arg);
          return;
        }
        case "annot": {
          this.expect(p.span, this.convert(p.type, new Map(), true), t, "This pattern");
          go(p.pat, t);
          return;
        }
      }
    };
    go(p, t);
  }

  private instCtor(name: string, span: Span): { result: Type; arg: Type | null; resolved: string } {
    const q = this.resolve("ctors", name, span, "constructor");
    const info = q === undefined ? undefined : this.ctors.get(q);
    if (!info || q === undefined) throw new MossError(`unknown constructor '${name}'`, span);
    const { type: result, sub } = this.instType(info.typeName);
    return { result, arg: info.arg && substitute(info.arg, sub), resolved: q };
  }

  /** A fresh instance of type definition `q`: the type, and the substitution for its parameters. */
  private instType(q: string): { type: Type; sub: Map<TVar, Type> } {
    const info = this.types.get(q)!;
    const fresh = info.vars.map(() => tvar(this.level));
    return { type: tcon(q, ...fresh), sub: new Map(info.vars.map((v, i) => [v, fresh[i]!])) };
  }

  private instRecord(typeName: string): { type: Type; fields: Map<string, Type> } {
    const info = this.types.get(typeName)!;
    if (!info.fields) throw new Error("not a record");
    const { type, sub } = this.instType(typeName);
    const fields = new Map([...info.fields].map(([n, t]) => [n, substitute(t, sub)] as const));
    return { type, fields };
  }

  // -- expressions ------------------------------------------------------------

  private infer(e: Expr, scope: Scope): Type {
    const t = this.inferInner(e, scope);
    e.ty = t;
    return t;
  }

  private inferInner(e: Expr, scope: Scope): Type {
    switch (e.e) {
      case "int":
        return tInt;
      case "float":
        return tFloat;
      case "string":
        return tString;
      case "bool":
        return tBool;
      case "unit":
        return tUnit;
      case "var": {
        const found = this.lookupValue(scope, e.name, e.span);
        if (!found) {
          if ((BINDING_OPS as readonly string[]).includes(e.name)) {
            throw new MossError(`unbound binding operator '( ${e.name} )': open a module that defines it (e.g. 'open Rhizoid')`, e.span);
          }
          throw new MossError(`unbound variable '${e.name}'`, e.span);
        }
        e.resolved = found.resolved;
        return instantiate(found.scheme, this.level);
      }
      case "ctor": {
        const { result, arg, resolved } = this.instCtor(e.name, e.span);
        e.resolved = resolved;
        if (arg && !e.arg) throw new MossError(`constructor '${e.name}' expects an argument`, e.span);
        if (!arg && e.arg) throw new MossError(`constructor '${e.name}' takes no argument`, e.span);
        if (arg && e.arg) this.expect(e.arg.span, this.infer(e.arg, scope), arg);
        return result;
      }
      case "app": {
        let ft = this.infer(e.fn, scope);
        for (const a of e.args) {
          const pre = prune(ft);
          const at =
            a.e === "fun" && pre.k === "fun"
              ? ((a.ty = this.inferFun(a.params, a.body, scope, pre.from)))
              : this.infer(a, scope);
          const f = prune(ft);
          if (f.k === "fun") {
            this.expect(a.span, at, f.from, "This argument");
            ft = f.to;
          } else if (f.k === "var") {
            const r = tvar(this.level);
            this.expect(e.fn.span, f, tfun(at, r), "This function");
            ft = r;
          } else {
            throw new MossError(
              `This expression has type ${new TypePrinter().print(f)}; it is not a function and cannot be applied`,
              e.fn.span,
            );
          }
        }
        return ft;
      }
      case "fun":
        return this.inferFun(e.params, e.body, scope);
      case "let": {
        const inner = scope.child();
        if (e.pat.p === "var") {
          inner.set(e.pat.name, this.letBinding(e.pat.name, e.rec, e.params, e.value, e.span, scope));
        } else {
          this.level++;
          const t = this.infer(e.value, scope);
          this.level--;
          const tmp = scope.child();
          this.bindPat(e.pat, t, tmp);
          this.checkIrrefutable(e.pat);
          // Generalize each pattern variable.
          this.collectPatVars(e.pat).forEach((n) => inner.set(n, generalize(tmp.get(n)!.type, this.level)));
        }
        return this.infer(e.body, inner);
      }
      case "letstar": {
        // Desugaring leaves only tuple-pattern `let*`, whose meaning depends on the operator in scope.
        if (!e.deferred) throw new Error("let* should have been desugared");
        Object.assign(e, resolveLetStar(e, this.letStarProjection(scope, e.span)));
        return this.inferInner(e, scope);
      }
      case "letplus":
      case "matchstar":
        throw new Error(`${e.e} should have been desugared`);
      case "if": {
        this.expect(e.cond.span, this.infer(e.cond, scope), tBool, "The condition");
        const t = this.infer(e.then, scope);
        this.expect(e.else.span, this.infer(e.else, scope), t);
        return t;
      }
      case "match": {
        const st = this.infer(e.scrut, scope);
        const r = tvar(this.level);
        for (const c of e.cases) {
          const inner = scope.child();
          this.bindPat(c.pat, st, inner);
          if (c.guard) this.expect(c.guard.span, this.infer(c.guard, inner), tBool, "The guard");
          this.expect(c.body.span, this.infer(c.body, inner), r);
        }
        if (!e.generated) this.checkCases(e.cases, e.span, e.label ?? "This match");
        return r;
      }
      case "tuple":
        return ttuple(e.items.map((i) => this.infer(i, scope)));
      case "list": {
        const el = tvar(this.level);
        for (const i of e.items) this.expect(i.span, this.infer(i, scope), el);
        return tList(el);
      }
      case "record": {
        const first = e.fields[0];
        if (!first) throw new MossError("empty record", e.span);
        const typeName = this.recordFor(first.name, undefined, e.span);
        const { type, fields } = this.instRecord(typeName);
        const given = new Set<string>();
        for (const f of e.fields) {
          const ft = fields.get(f.name);
          if (!ft) throw new MossError(`record type '${typeName}' has no field '${f.name}'`, f.value.span);
          if (given.has(f.name)) throw new MossError(`field '${f.name}' is given twice`, f.value.span);
          given.add(f.name);
          this.expect(f.value.span, this.infer(f.value, scope), ft);
        }
        const missing = [...fields.keys()].filter((f) => !given.has(f));
        if (missing.length > 0) throw new MossError(`missing field(s) ${missing.join(", ")} in record '${typeName}'`, e.span);
        // Emit fields in declaration order: structural comparison relies on it.
        const order = [...fields.keys()];
        e.fields.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
        return type;
      }
      case "update": {
        const first = e.fields[0];
        if (!first) throw new MossError("empty record update", e.span);
        const baseTy = this.infer(e.base, scope);
        const typeName = this.recordFor(first.name, baseTy, e.span);
        const { type, fields } = this.instRecord(typeName);
        this.expect(e.base.span, baseTy, type);
        for (const f of e.fields) {
          const ft = fields.get(f.name);
          if (!ft) throw new MossError(`record type '${typeName}' has no field '${f.name}'`, f.value.span);
          this.expect(f.value.span, this.infer(f.value, scope), ft);
        }
        return type;
      }
      case "field": {
        const tt = this.infer(e.target, scope);
        const typeName = this.recordFor(e.name, tt, e.span);
        const { type, fields } = this.instRecord(typeName);
        this.expect(e.target.span, tt, type);
        return fields.get(e.name)!;
      }
      case "binop":
        return this.binop(e as Expr & { e: "binop" }, scope);
      case "neg": {
        const t = e.float ? tFloat : tInt;
        this.expect(e.arg.span, this.infer(e.arg, scope), t);
        return t;
      }
      case "annot": {
        const t = this.convert(e.type, new Map(), true);
        this.expect(e.expr.span, this.infer(e.expr, scope), t);
        return t;
      }
    }
  }

  private binop(e: Expr & { e: "binop" }, scope: Scope): Type {
    const l = this.infer(e.left, scope);
    const r = this.infer(e.right, scope);
    const both = (t: Type, res: Type = t) => {
      this.expect(e.left.span, l, t);
      this.expect(e.right.span, r, t);
      return res;
    };
    switch (e.op) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "mod":
        return both(tInt);
      case "+.":
      case "-.":
      case "*.":
      case "/.":
        return both(tFloat);
      case "^":
        return both(tString);
      case "&&":
      case "||":
        return both(tBool);
      case "=":
      case "<>":
      case "==":
      case "<":
      case ">":
      case "<=":
      case ">=":
        this.expect(e.right.span, r, l);
        e.operandTy = l;
        if (e.op !== "==") this.comparisons.push({ span: e.span, op: e.op, ty: l });
        return tBool;
      case "::":
        this.expect(e.right.span, r, tList(l));
        return r;
      case "@": {
        const t = tList(tvar(this.level));
        return both(t);
      }
    }
    throw new MossError(`unknown operator '${e.op}'`, e.span);
  }

  /**
   * Does the in-scope `( let* )` pass its continuation a wrapped value (e.g.
   * Rhizoid's 'a val) rather than the plain one (a monad's 'a)? Decided from
   * the parameter type of the continuation in the operator's type.
   */
  /**
   * The operator that projects tuple patterns for the in-scope `( let* )`, if
   * it declares one with `[@@project_with "..."]`; otherwise null, and tuple
   * patterns are matched as in OCaml.
   */
  private letStarProjection(scope: Scope, span: Span): string | null {
    const found = this.lookupValue(scope, "let*", span);
    if (!found) throw new MossError("unbound binding operator '( let* )': open a module that defines it (e.g. 'open Rhizoid')", span);
    if (found.resolved === undefined) return null; // a local definition carries no attributes
    const attr = this.values.get(found.resolved)!.attrs.find((a) => a.name === "project_with");
    if (!attr) return null;
    if (!attr.arg || !(BINDING_OPS as readonly string[]).includes(attr.arg)) {
      throw new MossError(`[@@project_with] must name a binding operator, e.g. [@@project_with "let+"]`, attr.span);
    }
    return attr.arg;
  }

  private collectPatVars(p: Pat, out: string[] = []): string[] {
    switch (p.p) {
      case "var":
        out.push(p.name);
        break;
      case "tuple":
        p.items.forEach((q) => this.collectPatVars(q, out));
        break;
      case "ctor":
        if (p.arg) this.collectPatVars(p.arg, out);
        break;
      case "cons":
        this.collectPatVars(p.head, out);
        this.collectPatVars(p.tail, out);
        break;
      case "annot":
        this.collectPatVars(p.pat, out);
        break;
    }
    return out;
  }
}
