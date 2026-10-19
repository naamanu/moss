// JS implementations of Moss `external`s. Each takes its arguments uncurried;
// function-typed arguments are Moss closures and are called curried.
//
// Representations: lists are cons cells `{h, t}` / null, tuples are arrays,
// variants are `{$: tag, v?: payload}`, records are plain objects.

import { Eff } from "./effect.ts";
import { PMap, assertComparable, compare } from "./pmap.ts";

export type List<T> = { h: T; t: List<T> } | null;
type F1<A, B> = (a: A) => B;
type F2<A, B, C> = (a: A) => (b: B) => C;
type F3<A, B, C, D> = (a: A) => (b: B) => (c: C) => D;

// Constructor indices (`i`) must match declaration order in the Moss prelude.
export const None = { $: "None", i: 0 } as const;
export const Some = <T>(v: T) => ({ $: "Some", i: 1, v });

// ---------------------------------------------------------------------------
// Core helpers used directly by generated code

export function list(...xs: any[]): List<any> {
  let l: List<any> = null;
  for (let i = xs.length - 1; i >= 0; i--) l = { h: xs[i], t: l };
  return l;
}

/** Structural equality (`=`). nan is not equal to itself, as in IEEE and OCaml. */
export function eq(a: any, b: any): boolean {
  assertComparable(a, "equal");
  assertComparable(b, "equal");
  if (a === b) return typeof a !== "number" || a === a;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof PMap) {
    if (!(b instanceof PMap) || a.size !== b.size) return false;
    let same = true;
    a.symmetricDiff(b, () => (same = false), eq);
    return same;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!eq(a[k], b[k])) return false;
  return true;
}

export const cmp = compare;

/** Integer division and remainder; raise like OCaml's Division_by_zero. */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new Error("Division_by_zero");
  return Math.trunc(a / b);
}
export function imod(a: number, b: number): number {
  if (b === 0) throw new Error("Division_by_zero");
  return a % b;
}

export function matchFail(where: string): never {
  throw new Error(`Match failure at ${where}`);
}

// ---------------------------------------------------------------------------
// Int / Float / String

export const show = (n: number): string => String(n);
export const Float_to_string = (x: number): string => String(x);
export const Float_of_int = (n: number): number => n;
export const Float_fixed = (digits: number, x: number): string => x.toFixed(digits);
export const Int_of_float = (x: number): number => Math.trunc(x);
export const Int_abs = (n: number): number => Math.abs(n);
export const Int_min = (a: number, b: number): number => Math.min(a, b);
export const Int_max = (a: number, b: number): number => Math.max(a, b);
export const Int_of_string = (s: string) => {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? None : Some(n);
};
export const String_length = (s: string): number => s.length;
export const String_trim = (s: string): string => s.trim();
export const String_is_empty = (s: string): boolean => s.length === 0;
export const String_upper = (s: string): string => s.toUpperCase();
export const String_lower = (s: string): string => s.toLowerCase();
export const String_contains = (needle: string, s: string): boolean => s.includes(needle);
export function String_concat(sep: string, xs: List<string>): string {
  const out: string[] = [];
  for (let l = xs; l !== null; l = l.t) out.push(l.h);
  return out.join(sep);
}
/** Deterministic PRNG step (xorshift32), for pure "random" data. */
export function Random_next(seed: number): number {
  let x = seed | 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// ---------------------------------------------------------------------------
// Lists

export function List_map<A, B>(f: F1<A, B>, xs: List<A>): List<B> {
  if (xs === null) return null;
  const head: { h: B; t: List<B> } = { h: f(xs.h), t: null };
  let last = head;
  for (let l = xs.t; l !== null; l = l.t) {
    const cell = { h: f(l.h), t: null };
    last.t = cell;
    last = cell;
  }
  return head;
}

export function List_mapi<A, B>(f: F2<number, A, B>, xs: List<A>): List<B> {
  let i = 0;
  return List_map((x: A) => f(i++)(x), xs);
}

export function List_filter<A>(p: F1<A, boolean>, xs: List<A>): List<A> {
  const out: A[] = [];
  for (let l = xs; l !== null; l = l.t) if (p(l.h)) out.push(l.h);
  return list(...out);
}

export function List_fold<A, Acc>(f: F2<Acc, A, Acc>, acc: Acc, xs: List<A>): Acc {
  for (let l = xs; l !== null; l = l.t) acc = f(acc)(l.h);
  return acc;
}

export function List_length(xs: List<any>): number {
  let n = 0;
  for (let l = xs; l !== null; l = l.t) n++;
  return n;
}

export function List_rev<A>(xs: List<A>): List<A> {
  let out: List<A> = null;
  for (let l = xs; l !== null; l = l.t) out = { h: l.h, t: out };
  return out;
}

export function List_append<A>(xs: List<A>, ys: List<A>): List<A> {
  if (xs === null) return ys;
  const out: A[] = [];
  for (let l: List<A> = xs; l !== null; l = l.t) out.push(l.h);
  let r = ys;
  for (let i = out.length - 1; i >= 0; i--) r = { h: out[i]!, t: r };
  return r;
}

export function List_range(a: number, b: number): List<number> {
  let l: List<number> = null;
  for (let i = b - 1; i >= a; i--) l = { h: i, t: l };
  return l;
}

export function List_concat<A>(xss: List<List<A>>): List<A> {
  const out: A[] = [];
  for (let l = xss; l !== null; l = l.t) for (let m: List<A> = l.h; m !== null; m = m.t) out.push(m.h);
  return list(...out);
}

export function List_concat_map<A, B>(f: F1<A, List<B>>, xs: List<A>): List<B> {
  return List_concat(List_map(f, xs));
}

export function List_exists<A>(p: F1<A, boolean>, xs: List<A>): boolean {
  for (let l = xs; l !== null; l = l.t) if (p(l.h)) return true;
  return false;
}

export function List_for_all<A>(p: F1<A, boolean>, xs: List<A>): boolean {
  for (let l = xs; l !== null; l = l.t) if (!p(l.h)) return false;
  return true;
}

export function List_find<A>(p: F1<A, boolean>, xs: List<A>) {
  for (let l = xs; l !== null; l = l.t) if (p(l.h)) return Some(l.h);
  return None;
}

export function List_take<A>(n: number, xs: List<A>): List<A> {
  const out: A[] = [];
  for (let l = xs; l !== null && out.length < n; l = l.t) out.push(l.h);
  return list(...out);
}

export function List_sort<A>(xs: List<A>): List<A> {
  const out: A[] = [];
  for (let l = xs; l !== null; l = l.t) out.push(l.h);
  return list(...out.sort(compare));
}

export const List_is_empty = (xs: List<any>): boolean => xs === null;

// ---------------------------------------------------------------------------
// Maps (persistent, ordered by structural comparison)

export const Map_empty: PMap<any, any> = PMap.empty(compare);
export const Map_add = <K, V>(k: K, v: V, m: PMap<K, V>) => m.set(k, v);
export const Map_remove = <K, V>(k: K, m: PMap<K, V>) => m.delete(k);
export const Map_mem = <K>(k: K, m: PMap<K, any>) => m.has(k);
export const Map_size = (m: PMap<any, any>) => m.size;
export function Map_find<K, V>(k: K, m: PMap<K, V>) {
  const v = m.get(k);
  return v === undefined && !m.has(k) ? None : Some(v);
}
export function Map_update<K, V>(k: K, f: F1<any, any>, m: PMap<K, V>): PMap<K, V> {
  const r = f(Map_find(k, m));
  return r.$ === "None" ? m.delete(k) : m.set(k, r.v);
}
export function Map_values<V>(m: PMap<any, V>): List<V> {
  let l: List<V> = null;
  m.forEachRev((v) => (l = { h: v, t: l }));
  return l;
}
export function Map_keys<K>(m: PMap<K, any>): List<K> {
  let l: List<K> = null;
  m.forEachRev((_, k) => (l = { h: k, t: l }));
  return l;
}
export function Map_to_list<K, V>(m: PMap<K, V>): List<[K, V]> {
  let l: List<[K, V]> = null;
  m.forEachRev((v, k) => (l = { h: [k, v], t: l }));
  return l;
}
export function Map_of_list<K, V>(xs: List<[K, V]>): PMap<K, V> {
  let m = Map_empty as PMap<K, V>;
  for (let l = xs; l !== null; l = l.t) m = m.set(l.h[0], l.h[1]);
  return m;
}
export function Map_fold<K, V, Acc>(f: F3<K, V, Acc, Acc>, m: PMap<K, V>, acc: Acc): Acc {
  m.forEach((v, k) => (acc = f(k)(v)(acc)));
  return acc;
}
export function Map_filter<K, V>(p: F2<K, V, boolean>, m: PMap<K, V>): PMap<K, V> {
  // Deleting from the original keeps every untouched subtree shared, so a
  // downstream `assoc` can still diff the result cheaply.
  let r = m;
  m.forEach((v, k) => {
    if (!p(k)(v)) r = r.delete(k);
  });
  return r;
}
export function Map_map<K, V, W>(f: F1<V, W>, m: PMap<K, V>): PMap<K, W> {
  let r = Map_empty as PMap<K, W>;
  m.forEach((v, k) => (r = r.set(k, f(v))));
  return r;
}

// ---------------------------------------------------------------------------
// Effects

export { none as Effect_none, seq as Effect_seq, print as Effect_print } from "./effect.ts";
