// Typed AST -> ES module.
//
// Pure code compiles to plain JS in A-normal-ish form: `expr()` returns a JS
// expression and pushes any statements it needs (lets, matches) onto `st`.
// Known-arity functions (top-level and local `let f a b = ...`, externals)
// are called uncurried when saturated; everything else is curried.
//
// Computation forms (`let*`, `let+`, `match*`) compile to runtime
// combinators (R.sub, R.arr, R.sw) that build the incremental graph.

import type { Decl, Expr, Pat } from "./ast.ts";
import type { Checked } from "./typecheck.ts";
import { prune } from "./types.ts";

interface Binding {
  js: string;
  /** > 0 when `js` is an uncurried function of that many params. */
  arity: number;
  /** JS name of a curried wrapper, if one exists. */
  curried?: string;
}

class Env {
  private m = new Map<string, Binding>();
  constructor(readonly parent: Env | null) {}
  get(name: string): Binding | undefined {
    for (let e: Env | null = this; e; e = e.parent) {
      const b = e.m.get(name);
      if (b) return b;
    }
    return undefined;
  }
  set(name: string, b: Binding): void {
    this.m.set(name, b);
  }
  child(): Env {
    return new Env(this);
  }
}

const PRIMITIVE = new Set(["int", "float", "string", "bool", "unit"]);
const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const prop = (name: string) => (JS_IDENT.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`);
const key = (name: string) => (JS_IDENT.test(name) ? name : JSON.stringify(name));

export function codegen(checked: Checked, runtimeImport = "moss/runtime"): string {
  return new Gen(checked).module(runtimeImport);
}

class Gen {
  private n = 0;
  private header: string[] = [];
  private body: string[] = [];
  private globalNames = new Set<string>();
  private externWrappers = new Map<string, string>();
  /** Constructor name -> {JS constant for nullary ctors, declaration index}, latest declaration wins. */
  private ctorJs = new Map<string, { js: string | null; index: number }>();

  constructor(private readonly checked: Checked) {}

  private fresh(base: string): string {
    const clean = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "") || "t";
    return `${clean}_${++this.n}`;
  }

  private globalName(name: string): string {
    const base = "$" + name.replace(/\./g, "_").replace(/[^A-Za-z0-9_$]/g, "_");
    let js = base;
    for (let i = 2; this.globalNames.has(js); i++) js = `${base}_${i}`;
    this.globalNames.add(js);
    return js;
  }

  module(runtimeImport: string): string {
    const env = new Env(null);
    let main: string | null = null;
    for (const d of this.checked.program.decls) {
      const m = this.decl(d, env);
      if (m) main = m;
    }
    return [
      `import * as R from ${JSON.stringify(runtimeImport)};`,
      ...this.header,
      ...this.body,
      main ? `export const main = ${main};` : `export const main = undefined;`,
      "",
    ].join("\n");
  }

  // -- declarations -----------------------------------------------------------

  private decl(d: Decl, env: Env): string | null {
    switch (d.d) {
      case "type":
        if (d.def.kind === "variant") {
          // A later type may reuse a constructor name; give each declaration its own constant.
          d.def.ctors.forEach((c, index) => {
            let js: string | null = null;
            if (!c.arg) {
              js = `C_${c.name}`;
              for (let i = 2; this.globalNames.has(js); i++) js = `C_${c.name}_${i}`;
              this.globalNames.add(js);
              this.header.push(`const ${js} = { $: ${JSON.stringify(c.name)}, i: ${index} };`);
            }
            this.ctorJs.set(c.name, { js, index });
          });
        }
        return null;
      case "external": {
        let arity = 0;
        for (let t = d.type; t.t === "fun"; t = t.to) arity++;
        env.set(d.name, { js: `R.${d.js}`, arity: arity > 1 ? arity : 0 });
        return null;
      }
      case "let": {
        const js = this.globalName(d.name);
        if (d.params.length > 0) {
          const b: Binding = { js, arity: d.params.length };
          if (d.params.length > 1) b.curried = `${js}$c`;
          // Only `let rec` sees itself; otherwise the name refers to any earlier binding.
          if (d.rec) env.set(d.name, b);
          const fn = this.fnBody(d.params, d.body, env);
          env.set(d.name, b);
          this.body.push(`function ${js}(${fn.params}) {\n${fn.body}\n}`);
          if (b.curried) this.body.push(`const ${b.curried} = ${this.curryWrapper(js, d.params.length)};`);
        } else {
          // Non-function lets are not recursive at the top level.
          const st: string[] = [];
          const v = this.expr(d.body, env, st);
          this.body.push(st.length ? `const ${js} = (() => {\n${st.join("\n")}\nreturn ${v};\n})();` : `const ${js} = ${v};`);
          env.set(d.name, { js, arity: 0 });
        }
        return null;
      }
      case "app": {
        const st: string[] = [];
        const v = this.expr(d.expr, env, st);
        if (st.length === 0) return v;
        this.body.push(`const $main = (() => {\n${st.join("\n")}\nreturn ${v};\n})();`);
        return "$main";
      }
    }
  }

  private curryWrapper(js: string, n: number): string {
    const ps = Array.from({ length: n }, (_, i) => `a${i}`);
    return `${ps.map((p) => `(${p}) => `).join("")}${js}(${ps.join(", ")})`;
  }

  /** Compile params + body into uncurried JS param list and statement body. */
  private fnBody(params: Pat[], body: Expr, env: Env): { params: string; body: string } {
    const inner = env.child();
    const st: string[] = [];
    const names = params.map((p) => this.bindParam(p, inner, st));
    const v = this.expr(body, inner, st);
    st.push(`return ${v};`);
    return { params: names.join(", "), body: st.join("\n") };
  }

  /** Name a function parameter; destructure non-variable patterns in `st`. */
  private bindParam(p: Pat, env: Env, st: string[]): string {
    while (p.p === "annot") p = p.pat;
    if (p.p === "var") {
      const js = this.fresh(p.name);
      env.set(p.name, { js, arity: 0 });
      return js;
    }
    const js = this.fresh("p");
    for (const [name, acc] of this.patBinds(p, js)) {
      const v = this.fresh(name);
      env.set(name, { js: v, arity: 0 });
      st.push(`const ${v} = ${acc};`);
    }
    return js;
  }

  // -- patterns ---------------------------------------------------------------

  /** Conditions under which `p` matches the value at `acc`. */
  private patTests(p: Pat, acc: string, out: string[] = []): string[] {
    switch (p.p) {
      case "wild":
      case "var":
      case "unit":
        break;
      case "int":
      case "float":
      case "string":
      case "bool":
        out.push(`${acc} === ${JSON.stringify(p.value)}`);
        break;
      case "tuple":
        p.items.forEach((q, i) => this.patTests(q, `${acc}[${i}]`, out));
        break;
      case "ctor":
        out.push(`${acc}.$ === ${JSON.stringify(p.name)}`);
        if (p.arg) this.patTests(p.arg, `${acc}.v`, out);
        break;
      case "nil":
        out.push(`${acc} === null`);
        break;
      case "cons":
        out.push(`${acc} !== null`);
        this.patTests(p.head, `${acc}.h`, out);
        this.patTests(p.tail, `${acc}.t`, out);
        break;
      case "annot":
        this.patTests(p.pat, acc, out);
        break;
    }
    return out;
  }

  /** Variables bound by `p`, with the JS accessor for each. */
  private patBinds(p: Pat, acc: string, out: [string, string][] = []): [string, string][] {
    switch (p.p) {
      case "var":
        out.push([p.name, acc]);
        break;
      case "tuple":
        p.items.forEach((q, i) => this.patBinds(q, `${acc}[${i}]`, out));
        break;
      case "ctor":
        if (p.arg) this.patBinds(p.arg, `${acc}.v`, out);
        break;
      case "cons":
        this.patBinds(p.head, `${acc}.h`, out);
        this.patBinds(p.tail, `${acc}.t`, out);
        break;
      case "annot":
        this.patBinds(p.pat, acc, out);
        break;
    }
    return out;
  }

  private where(e: Expr): string {
    return JSON.stringify(`${e.span.file}:${e.span.start}`);
  }

  // -- expressions ------------------------------------------------------------

  /** Bind an expression to a temp unless it's already a simple name/literal. */
  private atomize(js: string, st: string[], base = "t"): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(js) || /^-?\d+(\.\d+)?$/.test(js)) return js;
    const t = this.fresh(base);
    st.push(`const ${t} = ${js};`);
    return t;
  }

  private expr(e: Expr, env: Env, st: string[]): string {
    switch (e.e) {
      case "int":
      case "float":
        return e.value < 0 ? `(${e.value})` : String(e.value);
      case "string":
        return JSON.stringify(e.value);
      case "bool":
        return String(e.value);
      case "unit":
        return "undefined";
      case "var": {
        const b = env.get(e.name);
        if (!b) throw new Error(`codegen: unbound ${e.name}`);
        if (b.arity > 1) return b.curried ?? this.wrapperFor(b);
        return b.js;
      }
      case "ctor": {
        const c = this.ctorJs.get(e.name)!;
        if (!e.arg) return c.js!;
        return `{ $: ${JSON.stringify(e.name)}, i: ${c.index}, v: ${this.expr(e.arg, env, st)} }`;
      }
      case "app":
        return this.app(e, env, st);
      case "fun": {
        const inner = env.child();
        const pre: string[] = [];
        const names = e.params.map((p) => this.bindParam(p, inner, pre));
        const body: string[] = [...pre];
        const v = this.expr(e.body, inner, body);
        const arrows = names.map((n) => `(${n}) => `).join("");
        return body.length === 0 ? `(${arrows}${v.startsWith("{") ? `(${v})` : v})` : `(${arrows}{\n${body.join("\n")}\nreturn ${v};\n})`;
      }
      case "let":
        return this.letExpr(e, env, st);
      case "letstar": {
        const inner = env.child();
        const pre: string[] = [];
        const param = this.bindValPat(e.pat, inner, pre);
        const c = this.expr(e.value, env, st);
        const body = [...pre];
        const v = this.expr(e.body, inner, body);
        return `R.sub(${c}, (${param}) => {\n${body.join("\n")}\nreturn ${v};\n})`;
      }
      case "letplus": {
        const inner = env.child();
        const inputs = e.binds.map((b) => this.expr(b.value, env, st));
        const pre: string[] = [];
        const params = e.binds.map((b) => this.bindParam(b.pat, inner, pre));
        const body = [...pre];
        const v = this.expr(e.body, inner, body);
        return `R.arr([${inputs.join(", ")}], (${params.join(", ")}) => {\n${body.join("\n")}\nreturn ${v};\n})`;
      }
      case "if": {
        const c = this.expr(e.cond, env, st);
        const s1: string[] = [];
        const s2: string[] = [];
        const a = this.expr(e.then, env, s1);
        const b = this.expr(e.else, env, s2);
        if (s1.length === 0 && s2.length === 0) return `(${c} ? ${a} : ${b})`;
        const t = this.fresh("if");
        st.push(`let ${t};`, `if (${c}) {`, ...s1, `${t} = ${a};`, `} else {`, ...s2, `${t} = ${b};`, `}`);
        return t;
      }
      case "match":
        return this.match(e, env, st);
      case "matchstar": {
        const scrut = this.expr(e.scrut, env, st);
        const matchers: string[] = [];
        const branches: string[] = [];
        for (const c of e.cases) {
          const tests = this.patTests(c.pat, "x");
          const binds = this.patBinds(c.pat, "x");
          matchers.push(`(x) => ${tests.length ? `${tests.join(" && ")} ? ` : ""}[${binds.map(([, a]) => a).join(", ")}]${tests.length ? " : null" : ""}`);
          const inner = env.child();
          const body: string[] = [];
          binds.forEach(([name], i) => {
            const v = this.fresh(name);
            inner.set(name, { js: v, arity: 0 });
            body.push(`const ${v} = b[${i}];`);
          });
          const v = this.expr(c.body, inner, body);
          branches.push(`(b) => {\n${body.join("\n")}\nreturn ${v};\n}`);
        }
        return `R.sw(${scrut}, [${matchers.join(", ")}], [${branches.join(", ")}])`;
      }
      case "tuple":
        return `[${e.items.map((i) => this.expr(i, env, st)).join(", ")}]`;
      case "list":
        if (e.items.length === 0) return "null";
        return `R.list(${e.items.map((i) => this.expr(i, env, st)).join(", ")})`;
      case "record":
        return `{ ${e.fields.map((f) => `${key(f.name)}: ${this.expr(f.value, env, st)}`).join(", ")} }`;
      case "update": {
        const base = this.expr(e.base, env, st);
        return `{ ...${base}, ${e.fields.map((f) => `${key(f.name)}: ${this.expr(f.value, env, st)}`).join(", ")} }`;
      }
      case "field":
        return `${this.expr(e.target, env, st)}${prop(e.name)}`;
      case "binop":
        return this.binop(e as Expr & { e: "binop" }, env, st);
      case "neg":
        return `(-${this.expr(e.arg, env, st)})`;
      case "annot":
        return this.expr(e.expr, env, st);
    }
  }

  /** A `let*` pattern binds vals; tuple components become projection nodes. */
  private bindValPat(p: Pat, env: Env, st: string[]): string {
    while (p.p === "annot") p = p.pat;
    if (p.p === "var") {
      const js = this.fresh(p.name);
      env.set(p.name, { js, arity: 0 });
      return js;
    }
    const js = this.fresh("v");
    const go = (p: Pat, acc: string): void => {
      while (p.p === "annot") p = p.pat;
      if (p.p === "var") {
        const v = this.fresh(p.name);
        env.set(p.name, { js: v, arity: 0 });
        st.push(`const ${v} = ${acc};`);
      } else if (p.p === "tuple") {
        const t = p.items.some((q) => q.p !== "wild") ? this.atomize(acc, st, "v") : acc;
        p.items.forEach((q, i) => {
          if (q.p !== "wild") go(q, `R.proj(${t}, ${i})`);
        });
      }
    };
    go(p, js);
    return js;
  }

  private wrapperFor(b: Binding): string {
    // Curried wrapper for an uncurried external referenced as a value.
    let w = this.externWrappers.get(b.js);
    if (!w) {
      w = `${b.js.replace(/\W/g, "_")}$c`;
      this.externWrappers.set(b.js, w);
      this.header.push(`const ${w} = ${this.curryWrapper(b.js, b.arity)};`);
    }
    return w;
  }

  private app(e: Expr & { e: "app" }, env: Env, st: string[]): string {
    // Flatten nested applications: ((f a) b) c -> f [a, b, c]
    let fn: Expr = e;
    const args: Expr[] = [];
    while (fn.e === "app") {
      args.unshift(...fn.args);
      fn = fn.fn;
    }
    const b = fn.e === "var" ? env.get(fn.name) : undefined;
    const argJs = args.map((a) => this.expr(a, env, st));
    if (b && b.arity > 0) {
      if (argJs.length >= b.arity) {
        const call = `${b.js}(${argJs.slice(0, b.arity).join(", ")})`;
        return call + argJs.slice(b.arity).map((a) => `(${a})`).join("");
      }
      // Partial application of a known-arity function.
      const given = argJs.map((a) => this.atomize(a, st, "arg"));
      const rest = Array.from({ length: b.arity - given.length }, (_, i) => `r${i}`);
      return `(${rest.map((r) => `(${r}) => `).join("")}${b.js}(${[...given, ...rest].join(", ")}))`;
    }
    const f = this.expr(fn, env, st);
    return f + argJs.map((a) => `(${a})`).join("");
  }

  private letExpr(e: Expr & { e: "let" }, env: Env, st: string[]): string {
    const inner = env.child();
    if (e.pat.p === "var" && e.params.length > 0) {
      const js = this.fresh(e.pat.name);
      const b: Binding = { js, arity: e.params.length };
      // Recursive functions see themselves; non-recursive ones see the outer scope.
      const fnEnv = e.rec ? inner : env;
      if (e.rec) inner.set(e.pat.name, b);
      const fn = this.fnBody(e.params, e.value, fnEnv);
      st.push(`const ${js} = (${fn.params}) => {\n${fn.body}\n};`);
      if (e.params.length > 1) {
        b.curried = `${js}$c`;
        st.push(`const ${b.curried} = ${this.curryWrapper(js, e.params.length)};`);
      }
      inner.set(e.pat.name, b);
    } else if (e.pat.p === "var") {
      const js = this.fresh(e.pat.name);
      st.push(`const ${js} = ${this.expr(e.value, env, st)};`);
      inner.set(e.pat.name, { js, arity: 0 });
    } else {
      const v = this.atomize(this.expr(e.value, env, st), st, "m");
      const tests = this.patTests(e.pat, v);
      if (tests.length > 0) st.push(`if (!(${tests.join(" && ")})) R.matchFail(${this.where(e)});`);
      for (const [name, acc] of this.patBinds(e.pat, v)) {
        const js = this.fresh(name);
        st.push(`const ${js} = ${acc};`);
        inner.set(name, { js, arity: 0 });
      }
    }
    return this.expr(e.body, inner, st);
  }

  private match(e: Expr & { e: "match" }, env: Env, st: string[]): string {
    const s = this.atomize(this.expr(e.scrut, env, st), st, "s");
    const t = this.fresh("m");
    const label = this.fresh("L");
    st.push(`let ${t};`, `${label}: {`);
    for (const c of e.cases) {
      const tests = this.patTests(c.pat, s);
      const inner = env.child();
      const body: string[] = [];
      for (const [name, acc] of this.patBinds(c.pat, s)) {
        const js = this.fresh(name);
        body.push(`const ${js} = ${acc};`);
        inner.set(name, { js, arity: 0 });
      }
      const finish = (out: string[]) => {
        const v = this.expr(c.body, inner, out);
        out.push(`${t} = ${v};`, `break ${label};`);
      };
      if (c.guard) {
        const g = this.expr(c.guard, inner, body);
        const gb: string[] = [];
        finish(gb);
        body.push(`if (${g}) {`, ...gb, `}`);
      } else finish(body);
      if (tests.length === 0) {
        st.push(...body);
        if (!c.guard) break; // later cases are unreachable
      } else st.push(`if (${tests.join(" && ")}) {`, ...body, `}`);
    }
    st.push(`R.matchFail(${this.where(e)});`, `}`);
    return t;
  }

  private binop(e: Expr & { e: "binop" }, env: Env, st: string[]): string {
    if (e.op === "&&" || e.op === "||") {
      const l = this.expr(e.left, env, st);
      const rs: string[] = [];
      const r = this.expr(e.right, env, rs);
      if (rs.length === 0) return `(${l} ${e.op} ${r})`;
      const t = this.fresh("b");
      st.push(`let ${t} = ${l};`, `if (${e.op === "&&" ? t : `!${t}`}) {`, ...rs, `${t} = ${r};`, `}`);
      return t;
    }
    const l = this.expr(e.left, env, st);
    const r = this.expr(e.right, env, st);
    // A literal non-zero divisor can't raise Division_by_zero.
    const nonzero = () => e.right.e === "int" && e.right.value !== 0;
    const primitive = () => {
      const t = e.operandTy && prune(e.operandTy);
      return t !== undefined && t.k === "con" && PRIMITIVE.has(t.name);
    };
    switch (e.op) {
      case "+":
      case "+.":
      case "^":
        return `(${l} + ${r})`;
      case "-":
      case "-.":
        return `(${l} - ${r})`;
      case "*":
      case "*.":
        return `(${l} * ${r})`;
      case "/":
        return nonzero() ? `Math.trunc(${l} / ${r})` : `R.idiv(${l}, ${r})`;
      case "/.":
        return `(${l} / ${r})`;
      case "mod":
        return nonzero() ? `(${l} % ${r})` : `R.imod(${l}, ${r})`;
      case "==":
        return `(${l} === ${r})`;
      case "=":
        return primitive() ? `(${l} === ${r})` : `R.eq(${l}, ${r})`;
      case "<>":
        return primitive() ? `(${l} !== ${r})` : `!R.eq(${l}, ${r})`;
      case "<":
      case ">":
      case "<=":
      case ">=":
        return primitive() ? `(${l} ${e.op} ${r})` : `(R.cmp(${l}, ${r}) ${e.op} 0)`;
      case "::":
        return `{ h: ${l}, t: ${r} }`;
      case "@":
        return `R.List_append(${l}, ${r})`;
    }
    throw new Error(`codegen: unknown operator ${e.op}`);
  }
}
