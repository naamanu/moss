// Binding operators, as in OCaml (>= 4.08) and Bonsai's ppx_let.
//
//   let+ p1 = e1 and+ p2 = e2 in body  ~>  ( let+ ) (( and+ ) e1 e2) (fun (p1, p2) -> body)
//   let* x = c in body                 ~>  ( let* ) c (fun x -> body)
//   let* p1 = c1 and* p2 = c2 in body  ~>  let* (p1, p2) = ( and* ) c1 c2 in body
//
// The operators are ordinary names resolved in scope, so any library (or user
// code) can define them.
//
// A tuple pattern on `let*` depends on what the in-scope `( let* )` passes to
// its continuation. For a monad ('a m -> ('a -> 'b m) -> 'b m) it's the plain
// value, matched as in OCaml. For Rhizoid's `let*` ('a comp -> ('a val -> ...))
// it's an incremental value, which a pattern can't take apart, so each
// variable is projected out with `let+` (what Bonsai's `let%sub` does):
//
//   let* (a, b) = c in body
//     ~>  let* t = c in
//         let* a = (let+ (a, _) = t in a) in
//         let* b = (let+ (_, b) = t in b) in body
//
// That choice needs the operator's type, so tuple-pattern `let*` nodes are
// left `deferred` here and resolved by the type checker (`resolveLetStar`).
//
//   match* v with p_0 -> b_0 | ... | p_n -> b_n
//     ~>  ( match* ) v
//           (fun x -> match x with p_0 -> 0 | ... | p_n -> n)
//           (fun i v' -> match i with
//              | 0 -> let* (vars of p_0) = (let+ x = v' in match x with p_0 -> (vars)) in b_0
//              | ...)
//
// `( match* )` must call the branch function with a view of the scrutinee that
// only updates while it matches that branch, so the projections above never
// see a value of another case.

import type { Case, Expr, LetPlusBind, Pat } from "./ast.ts";
import { MossError, type Span } from "./errors.ts";

let n = 0;
const fresh = (base: string) => `$${base}${++n}`;

const v = (name: string, span: Span): Expr => ({ e: "var", name, span });
const pv = (name: string, span: Span): Pat => ({ p: "var", name, span });
const app = (fn: string, args: Expr[], span: Span): Expr => ({ e: "app", fn: v(fn, span), args, span });
const fun = (params: Pat[], body: Expr, span: Span): Expr => ({ e: "fun", params, body, span });

/** Combine `p1 = e1 and p2 = e2 ...` into one value and one (nested tuple) pattern. */
function combine(first: LetPlusBind, rest: LetPlusBind[], op: string, span: Span): LetPlusBind {
  let value = first.value;
  let pat = first.pat;
  for (const b of rest) {
    value = app(op, [value, b.value], span);
    pat = { p: "tuple", items: [pat, b.pat], span };
  }
  return { pat, value };
}

function patVars(p: Pat, out: string[] = []): string[] {
  switch (p.p) {
    case "var":
      out.push(p.name);
      break;
    case "tuple":
      p.items.forEach((q) => patVars(q, out));
      break;
    case "ctor":
      if (p.arg) patVars(p.arg, out);
      break;
    case "cons":
      patVars(p.head, out);
      patVars(p.tail, out);
      break;
    case "annot":
      patVars(p.pat, out);
      break;
  }
  return out;
}

/** `p` with every variable except `keep` replaced by `_`. */
function only(p: Pat, keep: string): Pat {
  switch (p.p) {
    case "var":
      return p.name === keep ? p : { p: "wild", span: p.span };
    case "tuple":
      return { ...p, items: p.items.map((q) => only(q, keep)) };
    case "annot":
      return { ...p, pat: only(p.pat, keep) };
    default:
      return p;
  }
}

function letStar(pat: Pat, value: Expr, body: Expr, span: Span): Expr {
  const inner = pat.p === "annot" ? pat.pat : pat;
  switch (inner.p) {
    case "var":
      return app("let*", [value, fun([pat], body, span)], span);
    case "wild":
      return app("let*", [value, fun([{ p: "wild", span: pat.span }], body, span)], span);
    default:
      return { e: "letstar", pat, value, ands: [], body, deferred: true, span };
  }
}

/**
 * Resolve a deferred `let*`. `projecting` says whether the in-scope `( let* )`
 * hands its continuation a wrapped value (see the header comment).
 * Children are already desugared.
 */
export function resolveLetStar(e: Expr & { e: "letstar" }, projecting: boolean): Expr {
  const { pat, value, body, span } = e;
  if (!projecting) return app("let*", [value, fun([pat], body, span)], span);
  const inner = pat.p === "annot" ? pat.pat : pat;
  if (inner.p === "unit") return app("let*", [value, fun([{ p: "wild", span: pat.span }], body, span)], span);
  if (inner.p !== "tuple") throw new MossError("this 'let*' binds incremental values: its pattern can only use variables, '_' and tuples", pat.span);
  // Project each variable out of the tuple as its own incremental value.
  const t = fresh("t");
  let rest = body;
  for (const name of patVars(pat).reverse()) {
    const proj = app("let+", [v(t, span), fun([only(pat, name)], v(name, span), span)], span);
    rest = app("let*", [proj, fun([pv(name, span)], rest, span)], span);
  }
  return app("let*", [value, fun([pv(t, span)], rest, span)], span);
}

function matchStar(scrut: Expr, cases: Case[], span: Span): Expr {
  const x = fresh("x");
  const index: Expr = fun(
    [pv(x, span)],
    {
      e: "match",
      scrut: v(x, span),
      cases: cases.map((c, i) => ({ pat: c.pat, guard: null, body: { e: "int", value: i, span: c.pat.span } })),
      label: "This 'match*'",
      span,
    },
    span,
  );
  const i = fresh("i");
  const view = fresh("v");
  const branches: Case[] = cases.map((c, k) => {
    const vars = patVars(c.pat);
    let body = c.body;
    if (vars.length > 0) {
      const y = fresh("y");
      const tuple: Expr = vars.length === 1 ? v(vars[0]!, span) : { e: "tuple", items: vars.map((n) => v(n, span)), span };
      const project = app(
        "let+",
        [
          v(view, span),
          fun(
            [pv(y, span)],
            { e: "match", scrut: v(y, span), cases: [{ pat: c.pat, guard: null, body: tuple }], generated: true, span },
            span,
          ),
        ],
        span,
      );
      const pat: Pat = vars.length === 1 ? pv(vars[0]!, span) : { p: "tuple", items: vars.map((n) => pv(n, span)), span };
      body = letStar(pat, project, body, span);
    }
    const last = k === cases.length - 1;
    return { pat: last ? { p: "wild", span } : { p: "int", value: k, span }, guard: null, body };
  });
  const branch = fun([pv(i, span), pv(view, span)], { e: "match", scrut: v(i, span), cases: branches, generated: true, span }, span);
  return app("match*", [scrut, index, branch], span);
}

/** Rewrite binding-operator syntax everywhere in `e`. */
export function desugar(e: Expr): Expr {
  switch (e.e) {
    case "letplus": {
      const b = combine(e.binds[0]!, e.binds.slice(1), "and+", e.span);
      return desugar(app("let+", [b.value, fun([b.pat], e.body, e.span)], e.span));
    }
    case "letstar": {
      if (e.deferred) return { ...e, value: desugar(e.value), body: desugar(e.body) };
      const b = combine({ pat: e.pat, value: e.value }, e.ands, "and*", e.span);
      return desugar(letStar(b.pat, b.value, e.body, e.span));
    }
    case "matchstar":
      return desugar(matchStar(e.scrut, e.cases, e.span));
    case "app":
      return { ...e, fn: desugar(e.fn), args: e.args.map(desugar) };
    case "ctor":
      return e.arg ? { ...e, arg: desugar(e.arg) } : e;
    case "fun":
      return { ...e, body: desugar(e.body) };
    case "let":
      return { ...e, value: desugar(e.value), body: desugar(e.body) };
    case "if":
      return { ...e, cond: desugar(e.cond), then: desugar(e.then), else: desugar(e.else) };
    case "match":
      return {
        ...e,
        scrut: desugar(e.scrut),
        cases: e.cases.map((c) => ({ pat: c.pat, guard: c.guard && desugar(c.guard), body: desugar(c.body) })),
      };
    case "tuple":
    case "list":
      return { ...e, items: e.items.map(desugar) };
    case "record":
      return { ...e, fields: e.fields.map((f) => ({ name: f.name, value: desugar(f.value) })) };
    case "update":
      return { ...e, base: desugar(e.base), fields: e.fields.map((f) => ({ name: f.name, value: desugar(f.value) })) };
    case "field":
      return { ...e, target: desugar(e.target) };
    case "binop":
      return { ...e, left: desugar(e.left), right: desugar(e.right) };
    case "neg":
      return { ...e, arg: desugar(e.arg) };
    case "annot":
      return { ...e, expr: desugar(e.expr) };
    default:
      return e;
  }
}
