// Hindley–Milner type inference (Algorithm W with levels) for Moss.
//
// The Bonsai discipline is enforced purely through types: `'a val` is an
// incremental value that pure code can never read directly; the only way in
// is `let+`, whose result is a `'a comp`. `let*` binds the result of a
// computation as a `val`, and `match*` switches computations on a `val`.

import type { Decl, Expr, Pat, Program, TypeExpr } from "./ast.ts";
import { MossError, type Span } from "./errors.ts";
import { checkMatch, type VariantCtor } from "./exhaustive.ts";
import {
  type Scheme,
  type Type,
  TypePrinter,
  UnifyError,
  arity,
  generalize,
  instantiate,
  mono,
  prune,
  tBool,
  tComp,
  tFloat,
  tHtml,
  tInt,
  tList,
  tString,
  tUnit,
  tVal,
  tcon,
  tfun,
  ttuple,
  tvar,
  unify,
} from "./types.ts";

interface TypeInfo {
  params: string[];
  def: Decl & { d: "type" };
}

export interface CtorInfo {
  typeName: string;
  params: string[];
  arg: TypeExpr | null;
  /** Position within its type's constructor list. */
  index: number;
}

export interface GlobalInfo {
  kind: "external" | "let";
  /** JS name of the external, if any. */
  js?: string;
  arity: number;
}

export interface Checked {
  program: Program;
  globals: Map<string, GlobalInfo>;
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
  val: 1,
  comp: 1,
};

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
  private types = new Map<string, TypeInfo>();
  private ctors = new Map<string, CtorInfo>();
  private fields = new Map<string, string>(); // field -> record type name
  private globals = new Map<string, GlobalInfo>();
  private level = 0;
  private warnings: MossError[] = [];

  // -- exhaustiveness ---------------------------------------------------------

  private readonly siblings = (ctor: string): VariantCtor[] => {
    const def = this.types.get(this.ctors.get(ctor)!.typeName)!.def.def;
    if (def.kind !== "variant") throw new Error("not a variant");
    return def.ctors.map((c) => ({ name: c.name, hasArg: c.arg !== null }));
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
    const top = new Scope(null);
    for (const d of program.decls) this.decl(d, top);
    return { program, globals: this.globals, ctors: this.ctors, warnings: this.warnings };
  }

  // -- errors -----------------------------------------------------------------

  private mismatch(span: Span, actual: Type, expected: Type, what = "This expression"): never {
    const p = new TypePrinter();
    const a = p.print(actual);
    const b = p.print(expected);
    let msg = `${what} has type ${a} but an expression was expected of type ${b}`;
    const aa = prune(actual);
    const bb = prune(expected);
    const isCon = (t: Type, n: string) => t.k === "con" && t.name === n;
    if (isCon(aa, "val") && !isCon(bb, "val") && !isCon(bb, "comp")) {
      msg += "\n  hint: a 'val' can only be read inside 'let+ x = ... in ...'";
    } else if (isCon(aa, "comp") && isCon(bb, "val")) {
      msg += "\n  hint: bind the computation first with 'let* x = ... in ...' to get a 'val'";
    } else if (!isCon(aa, "comp") && isCon(bb, "comp")) {
      msg += "\n  hint: wrap a pure result with 'let+' (or 'return (const x)') to make a computation";
    }
    throw new MossError(msg, span);
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
        const info = this.types.get(te.name);
        if (!info) throw new MossError(`unknown type '${te.name}'`, te.span);
        if (info.params.length !== args.length) {
          throw new MossError(`type '${te.name}' expects ${info.params.length} argument(s), got ${args.length}`, te.span);
        }
        if (info.def.def.kind === "alias") {
          const sub = new Map<string, Type>(info.params.map((p, i) => [p, args[i]!]));
          return this.convert(info.def.def.type, sub, false);
        }
        return tcon(te.name, ...args);
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
        top.set(d.name, generalize(t, this.level));
        this.globals.set(d.name, { kind: "external", js: d.js, arity: arity(t) });
        return;
      }
      case "let": {
        const t = this.letBinding(d.name, d.rec, d.params, d.body, d.span, top, d.component);
        top.set(d.name, t);
        this.globals.set(d.name, { kind: "let", arity: d.params.length });
        return;
      }
      case "app": {
        const t = this.infer(d.expr, top);
        this.expect(d.expr.span, t, tComp(tHtml), "The app");
        return;
      }
    }
  }

  private typeDecl(d: Decl & { d: "type" }): void {
    if (this.types.has(d.name) || BUILTIN_TYPES[d.name] !== undefined) {
      throw new MossError(`type '${d.name}' is already defined`, d.span);
    }
    this.types.set(d.name, { params: d.params, def: d });
    const vars = new Map<string, Type>(d.params.map((p) => [p, tvar(0)]));
    const def = d.def;
    if (def.kind === "variant") {
      def.ctors.forEach((c, index) => {
        if (c.arg) this.convert(c.arg, vars, false); // validate
        this.ctors.set(c.name, { typeName: d.name, params: d.params, arg: c.arg, index });
      });
    } else if (def.kind === "record") {
      for (const f of def.fields) {
        this.convert(f.type, vars, false);
        this.fields.set(f.name, d.name);
      }
    } else if (def.kind === "alias") {
      this.convert(def.type, vars, false);
    }
  }

  /** Infer a (possibly recursive, possibly parameterized) let binding and generalize it. */
  private letBinding(name: string, rec: boolean, params: Pat[], body: Expr, span: Span, scope: Scope, component = false): Scheme {
    this.level++;
    const self = tvar(this.level);
    const inner = scope.child();
    if (rec) inner.set(name, mono(self));
    let t: Type;
    if (params.length > 0) {
      t = this.inferFun(params, body, inner, component ? span : null);
    } else {
      t = this.infer(body, inner);
      if (component) this.expect(body.span, t, tComp(tvar(this.level)), "A component");
    }
    if (rec) this.expect(span, self, t);
    this.level--;
    return generalize(t, this.level);
  }

  private inferFun(params: Pat[], body: Expr, scope: Scope, componentSpan: Span | null): Type {
    const inner = scope.child();
    const pts = params.map((p) => {
      const t = tvar(this.level);
      this.bindPat(p, t, inner);
      this.checkIrrefutable(p);
      return t;
    });
    let r = this.infer(body, inner);
    if (componentSpan) this.expect(body.span, r, tComp(tvar(this.level)), "A component body");
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
          const { result, arg } = this.instCtor(p.name, p.span);
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

  private instCtor(name: string, span: Span): { result: Type; arg: Type | null } {
    const info = this.ctors.get(name);
    if (!info) throw new MossError(`unknown constructor '${name}'`, span);
    const vars = new Map<string, Type>(info.params.map((p) => [p, tvar(this.level)]));
    const result = tcon(info.typeName, ...info.params.map((p) => vars.get(p)!));
    const arg = info.arg ? this.convert(info.arg, vars, false) : null;
    return { result, arg };
  }

  private instRecord(typeName: string): { type: Type; fields: Map<string, Type> } {
    const info = this.types.get(typeName)!;
    const vars = new Map<string, Type>(info.params.map((p) => [p, tvar(this.level)]));
    const def = info.def.def;
    if (def.kind !== "record") throw new Error("not a record");
    const fields = new Map(def.fields.map((f) => [f.name, this.convert(f.type, vars, false)] as const));
    return { type: tcon(typeName, ...info.params.map((p) => vars.get(p)!)), fields };
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
        const s = scope.get(e.name);
        if (!s) throw new MossError(`unbound variable '${e.name}'`, e.span);
        return instantiate(s, this.level);
      }
      case "ctor": {
        const { result, arg } = this.instCtor(e.name, e.span);
        if (arg && !e.arg) throw new MossError(`constructor '${e.name}' expects an argument`, e.span);
        if (!arg && e.arg) throw new MossError(`constructor '${e.name}' takes no argument`, e.span);
        if (arg && e.arg) this.expect(e.arg.span, this.infer(e.arg, scope), arg);
        return result;
      }
      case "app": {
        let ft = this.infer(e.fn, scope);
        for (const a of e.args) {
          const at = this.infer(a, scope);
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
        return this.inferFun(e.params, e.body, scope, null);
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
        const vt = this.infer(e.value, scope);
        const t = tvar(this.level);
        this.expect(e.value.span, vt, tComp(t), "The right-hand side of 'let*'");
        this.checkLetStarPat(e.pat);
        const inner = scope.child();
        this.bindPat(e.pat, t, inner, tVal);
        const bt = this.infer(e.body, inner);
        this.expect(e.body.span, bt, tComp(tvar(this.level)), "The body of 'let*'");
        return bt;
      }
      case "letplus": {
        const inner = scope.child();
        for (const b of e.binds) {
          const vt = this.infer(b.value, scope);
          const t = tvar(this.level);
          this.expect(b.value.span, vt, tVal(t), "The right-hand side of 'let+'");
          this.bindPat(b.pat, t, inner);
          this.checkIrrefutable(b.pat);
        }
        return tComp(this.infer(e.body, inner));
      }
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
        this.checkCases(e.cases, e.span, "This match");
        return r;
      }
      case "matchstar": {
        const st = tvar(this.level);
        this.expect(e.scrut.span, this.infer(e.scrut, scope), tVal(st), "The scrutinee of 'match*'");
        const r = tComp(tvar(this.level));
        for (const c of e.cases) {
          const inner = scope.child();
          this.bindPat(c.pat, st, inner, tVal);
          this.expect(c.body.span, this.infer(c.body, inner), r, "This 'match*' case");
        }
        this.checkCases(e.cases, e.span, "This 'match*'");
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
        const typeName = this.fields.get(first.name);
        if (!typeName) throw new MossError(`unknown field '${first.name}'`, e.span);
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
        return type;
      }
      case "update": {
        const first = e.fields[0];
        if (!first) throw new MossError("empty record update", e.span);
        const typeName = this.fields.get(first.name);
        if (!typeName) throw new MossError(`unknown field '${first.name}'`, e.span);
        const { type, fields } = this.instRecord(typeName);
        this.expect(e.base.span, this.infer(e.base, scope), type);
        for (const f of e.fields) {
          const ft = fields.get(f.name);
          if (!ft) throw new MossError(`record type '${typeName}' has no field '${f.name}'`, f.value.span);
          this.expect(f.value.span, this.infer(f.value, scope), ft);
        }
        return type;
      }
      case "field": {
        const tt = this.infer(e.target, scope);
        const typeName = this.fields.get(e.name);
        if (!typeName) throw new MossError(`unknown field '${e.name}'`, e.span);
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

  private checkLetStarPat(p: Pat): void {
    switch (p.p) {
      case "var":
      case "wild":
      case "unit":
        return;
      case "tuple":
        return p.items.forEach((q) => this.checkLetStarPat(q));
      case "annot":
        return this.checkLetStarPat(p.pat);
      default:
        throw new MossError("'let*' patterns can only be variables, '_' or tuples", p.span);
    }
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
