// Pattern-match exhaustiveness and redundancy, after Maranget,
// "Warnings for pattern matching" (JFP 2007).
//
// Patterns are normalized to constructor applications over a "signature" (the
// set of constructors a column's type can have). The check works purely from
// the patterns: a column's signature is inferred from the constructors that
// appear in it. That's enough because patterns have been type-checked already.

import type { Pat } from "./ast.ts";
import { printContext } from "./types.ts";

/** A normalized pattern: a wildcard or a constructor applied to sub-patterns. */
type P = null | { head: string; args: P[] };

export interface VariantCtor {
  name: string;
  hasArg: boolean;
}

/** Looks up all constructors of the variant type that `ctor` belongs to. */
export type Siblings = (ctor: string) => VariantCtor[];

const WILD: P = null;

function norm(p: Pat): P {
  switch (p.p) {
    case "wild":
    case "var":
      return WILD;
    case "annot":
      return norm(p.pat);
    case "int":
    case "float":
    case "string":
      return { head: `${p.p}:${JSON.stringify(p.value)}`, args: [] };
    case "bool":
      return { head: `bool:${p.value}`, args: [] };
    case "unit":
      return { head: "unit", args: [] };
    case "tuple":
      return { head: `tuple/${p.items.length}`, args: p.items.map(norm) };
    case "nil":
      return { head: "nil", args: [] };
    case "cons":
      return { head: "cons", args: [norm(p.head), norm(p.tail)] };
    case "ctor":
      // Constructors are identified by their resolved (module-qualified) name.
      return { head: `C:${p.resolved ?? p.name}`, args: p.arg ? [norm(p.arg)] : [] };
  }
}

const arityOf = (head: string, siblings: Siblings): number => {
  if (head.startsWith("tuple/")) return Number(head.slice(6));
  if (head === "cons") return 2;
  if (head.startsWith("C:")) return siblings(head.slice(2)).find((c) => c.name === head.slice(2))!.hasArg ? 1 : 0;
  return 0;
};

/**
 * The full signature for a column whose heads include `heads`, or null when
 * the type has infinitely many values (int, string, float literals).
 */
function signature(heads: Set<string>, siblings: Siblings): string[] | null {
  const first = heads.values().next().value as string;
  if (first.startsWith("tuple/") || first === "unit") return [first];
  if (first.startsWith("bool:")) return ["bool:true", "bool:false"];
  if (first === "nil" || first === "cons") return ["nil", "cons"];
  if (first.startsWith("C:")) return siblings(first.slice(2)).map((c) => `C:${c.name}`);
  return null;
}

type Row = P[];

function specialize(rows: Row[], head: string, arity: number): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    const p = r[0]!;
    if (p === null) out.push([...Array<P>(arity).fill(WILD), ...r.slice(1)]);
    else if (p.head === head) out.push([...p.args, ...r.slice(1)]);
  }
  return out;
}

function defaults(rows: Row[]): Row[] {
  return rows.filter((r) => r[0] === null).map((r) => r.slice(1));
}

function headsOf(rows: Row[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) if (r[0] !== null) s.add(r[0]!.head);
  return s;
}

/** Is `q` matched by some value that no row of `rows` matches? */
function useful(rows: Row[], q: Row, sib: Siblings): boolean {
  if (q.length === 0) return rows.length === 0;
  const q0 = q[0]!;
  if (q0 !== null) return useful(specialize(rows, q0.head, q0.args.length), [...q0.args, ...q.slice(1)], sib);
  const heads = headsOf(rows);
  const sig = heads.size > 0 ? signature(heads, sib) : null;
  if (sig && sig.every((h) => heads.has(h))) {
    return sig.some((h) => {
      const n = arityOf(h, sib);
      return useful(specialize(rows, h, n), [...Array<P>(n).fill(WILD), ...q.slice(1)], sib);
    });
  }
  return useful(defaults(rows), q.slice(1), sib);
}

/** A vector of `n` patterns matched by no row, or null if `rows` is exhaustive. */
function missing(rows: Row[], n: number, sib: Siblings): Row | null {
  if (n === 0) return rows.length === 0 ? [] : null;
  const heads = headsOf(rows);
  const sig = heads.size > 0 ? signature(heads, sib) : null;
  if (sig && sig.every((h) => heads.has(h))) {
    for (const h of sig) {
      const a = arityOf(h, sib);
      const w = missing(specialize(rows, h, a), a + n - 1, sib);
      if (w) return [{ head: h, args: w.slice(0, a) }, ...w.slice(a)];
    }
    return null;
  }
  const w = missing(defaults(rows), n - 1, sib);
  if (!w) return null;
  // Some constructor (or literal) not covered by the column fits here.
  const absent = sig?.find((h) => !heads.has(h)) ?? sampleInt(heads);
  if (absent === undefined) return [WILD, ...w];
  return [{ head: absent, args: Array<P>(arityOf(absent, sib)).fill(WILD) }, ...w];
}

/** For an int column, a concrete uncovered value makes a clearer example than `_`. */
function sampleInt(heads: Set<string>): string | undefined {
  const first = heads.values().next().value;
  if (first === undefined || !first.startsWith("int:")) return undefined;
  let n = 0;
  while (heads.has(`int:${n}`)) n++;
  return `int:${n}`;
}

function show(p: P, nested = false): string {
  if (p === null) return "_";
  const { head, args } = p;
  let s: string;
  if (head.startsWith("tuple/")) return `(${args.map((a) => show(a)).join(", ")})`;
  if (head === "unit") return "()";
  if (head === "nil") return "[]";
  if (head.startsWith("bool:")) return head.slice(5);
  if (head === "cons") s = `${show(args[0]!, true)} :: ${show(args[1]!)}`;
  else if (head.startsWith("C:")) {
    // Print constructors of the current module without their module prefix.
    const m = printContext.module;
    const name = m && head.startsWith(`C:${m}.`) ? head.slice(m.length + 3) : head.slice(2);
    s = args.length ? `${name} ${show(args[0]!, true)}` : name;
  }
  else return head.slice(head.indexOf(":") + 1);
  return nested && args.length > 0 ? `(${s})` : s;
}

export interface MatchCase {
  pat: Pat;
  guarded: boolean;
}

export interface MatchReport {
  /** An example of a value no case matches, if the match isn't exhaustive. */
  missing: string | null;
  /** Indices of cases that can never be selected. */
  redundant: number[];
}

export function checkMatch(cases: MatchCase[], sib: Siblings): MatchReport {
  const rows: Row[] = [];
  const redundant: number[] = [];
  cases.forEach((c, i) => {
    const row = [norm(c.pat)];
    if (!useful(rows, row, sib)) redundant.push(i);
    // A guarded case may fail, so it doesn't cover anything for later cases.
    if (!c.guarded) rows.push(row);
  });
  const w = missing(rows, 1, sib);
  return { missing: w ? show(w[0]!) : null, redundant };
}
