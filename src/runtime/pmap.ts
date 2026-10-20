// Persistent AVL map. Updates copy only the path to the changed key, so two
// versions of a map share every untouched subtree. `symmetricDiff` exploits
// that sharing: physically-equal subtrees are skipped without being walked,
// making a diff cost O(changes * log n) rather than O(n).

export type Compare<K> = (a: K, b: K) => number;

interface Tree<K, V> {
  readonly l: Tree<K, V> | null;
  readonly k: K;
  readonly v: V;
  readonly r: Tree<K, V> | null;
  readonly h: number;
  readonly size: number;
}

type T<K, V> = Tree<K, V> | null;

const height = (t: T<any, any>) => (t === null ? 0 : t.h);
const sizeOf = (t: T<any, any>) => (t === null ? 0 : t.size);

function mk<K, V>(l: T<K, V>, k: K, v: V, r: T<K, V>): Tree<K, V> {
  const hl = height(l);
  const hr = height(r);
  return { l, k, v, r, h: (hl > hr ? hl : hr) + 1, size: sizeOf(l) + sizeOf(r) + 1 };
}

function bal<K, V>(l: T<K, V>, k: K, v: V, r: T<K, V>): Tree<K, V> {
  const hl = height(l);
  const hr = height(r);
  if (hl > hr + 1) {
    const L = l!;
    if (height(L.l) >= height(L.r)) return mk(L.l, L.k, L.v, mk(L.r, k, v, r));
    const LR = L.r!;
    return mk(mk(L.l, L.k, L.v, LR.l), LR.k, LR.v, mk(LR.r, k, v, r));
  }
  if (hr > hl + 1) {
    const R = r!;
    if (height(R.r) >= height(R.l)) return mk(mk(l, k, v, R.l), R.k, R.v, R.r);
    const RL = R.l!;
    return mk(mk(l, k, v, RL.l), RL.k, RL.v, mk(RL.r, R.k, R.v, R.r));
  }
  return mk(l, k, v, r);
}

function add<K, V>(cmp: Compare<K>, t: T<K, V>, k: K, v: V): Tree<K, V> {
  if (t === null) return { l: null, k, v, r: null, h: 1, size: 1 };
  const c = cmp(k, t.k);
  if (c === 0) return t.v === v ? t : { ...t, k, v };
  if (c < 0) {
    const l = add(cmp, t.l, k, v);
    return l === t.l ? t : bal(l, t.k, t.v, t.r);
  }
  const r = add(cmp, t.r, k, v);
  return r === t.r ? t : bal(t.l, t.k, t.v, r);
}

function removeMin<K, V>(t: Tree<K, V>): T<K, V> {
  if (t.l === null) return t.r;
  return bal(removeMin(t.l), t.k, t.v, t.r);
}

function minNode<K, V>(t: Tree<K, V>): Tree<K, V> {
  while (t.l !== null) t = t.l;
  return t;
}

function merge<K, V>(a: T<K, V>, b: T<K, V>): T<K, V> {
  if (a === null) return b;
  if (b === null) return a;
  const m = minNode(b);
  return bal(a, m.k, m.v, removeMin(b));
}

function remove<K, V>(cmp: Compare<K>, t: T<K, V>, k: K): T<K, V> {
  if (t === null) return null;
  const c = cmp(k, t.k);
  if (c === 0) return merge(t.l, t.r);
  if (c < 0) {
    const l = remove(cmp, t.l, k);
    return l === t.l ? t : bal(l, t.k, t.v, t.r);
  }
  const r = remove(cmp, t.r, k);
  return r === t.r ? t : bal(t.l, t.k, t.v, r);
}

export type DiffEntry<K, V> =
  | { kind: "add"; key: K; value: V }
  | { kind: "remove"; key: K; old: V }
  | { kind: "update"; key: K; old: V; value: V };

export class PMap<K, V> {
  private constructor(readonly cmp: Compare<K>, private readonly root: T<K, V>) {}

  static empty<K, V>(cmp: Compare<K>): PMap<K, V> {
    return new PMap<K, V>(cmp, null);
  }

  get size(): number {
    return sizeOf(this.root);
  }

  get(k: K): V | undefined {
    let t = this.root;
    const cmp = this.cmp;
    while (t !== null) {
      const c = cmp(k, t.k);
      if (c === 0) return t.v;
      t = c < 0 ? t.l : t.r;
    }
    return undefined;
  }

  has(k: K): boolean {
    let t = this.root;
    while (t !== null) {
      const c = this.cmp(k, t.k);
      if (c === 0) return true;
      t = c < 0 ? t.l : t.r;
    }
    return false;
  }

  set(k: K, v: V): PMap<K, V> {
    const r = add(this.cmp, this.root, k, v);
    return r === this.root ? this : new PMap(this.cmp, r);
  }

  delete(k: K): PMap<K, V> {
    const r = remove(this.cmp, this.root, k);
    return r === this.root ? this : new PMap(this.cmp, r);
  }

  /** In-order traversal. */
  forEach(f: (v: V, k: K) => void): void {
    const go = (t: T<K, V>): void => {
      if (t === null) return;
      go(t.l);
      f(t.v, t.k);
      go(t.r);
    };
    go(this.root);
  }

  /** Right-to-left traversal (handy for building cons lists in order). */
  forEachRev(f: (v: V, k: K) => void): void {
    const go = (t: T<K, V>): void => {
      if (t === null) return;
      go(t.r);
      f(t.v, t.k);
      go(t.l);
    };
    go(this.root);
  }

  /**
   * Visit the differences from `this` (old) to `next` (new), in key order.
   * Subtrees shared between the two versions are skipped in O(1).
   */
  symmetricDiff(next: PMap<K, V>, f: (d: DiffEntry<K, V>) => void, eq: (a: V, b: V) => boolean = (a, b) => a === b): void {
    if (this.root === next.root) return;
    const cmp = this.cmp;
    // Each stack holds pending work; the top is the next thing in key order.
    // Entries are either whole subtrees or single (unexpanded) nodes.
    type Item = { t: Tree<K, V>; leaf: boolean };
    const a: Item[] = [];
    const b: Item[] = [];
    if (this.root) a.push({ t: this.root, leaf: false });
    if (next.root) b.push({ t: next.root, leaf: false });

    const expand = (s: Item[]): void => {
      const { t } = s.pop()!;
      if (t.r) s.push({ t: t.r, leaf: false });
      s.push({ t, leaf: true });
      if (t.l) s.push({ t: t.l, leaf: false });
    };

    while (a.length > 0 && b.length > 0) {
      const x = a[a.length - 1]!;
      const y = b[b.length - 1]!;
      if (!x.leaf && !y.leaf) {
        if (x.t === y.t) {
          a.pop();
          b.pop();
        } else if (x.t.h >= y.t.h) expand(a);
        else expand(b);
        continue;
      }
      if (!x.leaf) {
        expand(a);
        continue;
      }
      if (!y.leaf) {
        expand(b);
        continue;
      }
      const c = cmp(x.t.k, y.t.k);
      if (c === 0) {
        a.pop();
        b.pop();
        if (!eq(x.t.v, y.t.v)) f({ kind: "update", key: x.t.k, old: x.t.v, value: y.t.v });
      } else if (c < 0) {
        a.pop();
        f({ kind: "remove", key: x.t.k, old: x.t.v });
      } else {
        b.pop();
        f({ kind: "add", key: y.t.k, value: y.t.v });
      }
    }
    while (a.length > 0) {
      const x = a[a.length - 1]!;
      if (!x.leaf) expand(a);
      else {
        a.pop();
        f({ kind: "remove", key: x.t.k, old: x.t.v });
      }
    }
    while (b.length > 0) {
      const y = b[b.length - 1]!;
      if (!y.leaf) expand(b);
      else {
        b.pop();
        f({ kind: "add", key: y.t.k, value: y.t.v });
      }
    }
  }
}

/**
 * Values that `=` and `compare` may look inside: primitives, tuples (arrays),
 * cons cells, variants and records (plain objects), and maps. Functions and
 * opaque runtime objects (vals, effects, tasks, html) raise, as in OCaml.
 */
export function assertComparable(x: unknown, op: string): void {
  if (typeof x === "function") throw new Error(`${op}: functional value`);
  if (typeof x === "object" && x !== null && !Array.isArray(x) && !(x instanceof PMap)) {
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) throw new Error(`${op}: abstract value`);
  }
}

/**
 * Total structural order on Moss values (`compare`, map keys, and `<` on
 * non-primitive types). Variants order by declaration (`i`), then payload;
 * records by their fields in declaration order (literals are emitted in that
 * order); lists element-wise with [] first; nan is smaller than every number.
 */
export function compare(a0: any, b0: any): number {
  // Fast path for the common case (int and string map keys): no work stack.
  const t0 = typeof a0;
  if ((t0 === "string" || t0 === "boolean" || (t0 === "number" && a0 === a0)) && typeof b0 === t0 && b0 === b0) {
    return a0 < b0 ? -1 : a0 > b0 ? 1 : 0;
  }
  // An explicit work stack instead of recursion, so long lists can't overflow
  // the JS stack. Pairs are popped leftmost-first; a TIE entry carries the
  // result to use if everything before it compared equal (an array's length).
  const work: any[] = [a0, b0];
  while (work.length > 0) {
    const b = work.pop();
    const a = work.pop();
    if (a === TIE) {
      if (b !== 0) return b;
      continue;
    }
    assertComparable(a, "compare");
    assertComparable(b, "compare");
    const ta = typeof a;
    if (ta === "number") {
      if (a !== a) {
        if (b !== b) continue;
        return -1;
      }
      if (b !== b) return 1;
      if (a !== b) return a < b ? -1 : 1;
      continue;
    }
    if (ta === "string" || ta === "boolean") {
      if (a !== b) return a < b ? -1 : 1;
      continue;
    }
    if (a === b && (a === null || a === undefined)) continue;
    if (Array.isArray(a)) {
      work.push(TIE, a.length - b.length);
      for (let i = Math.min(a.length, b.length) - 1; i >= 0; i--) work.push(a[i], b[i]);
      continue;
    }
    if (a === null || b === null) return a === null ? -1 : 1;
    if (a === undefined || b === undefined) continue; // unit
    if (a instanceof PMap) {
      const xs: [any, any][] = [];
      const ys: [any, any][] = [];
      a.forEach((v, k) => xs.push([k, v]));
      (b as PMap<any, any>).forEach((v, k) => ys.push([k, v]));
      work.push(xs, ys);
      continue;
    }
    if ("$" in a) {
      if (a.$ !== b.$) return a.i - b.i;
      work.push(a.v, b.v);
      continue;
    }
    // Records and cons cells: fields in insertion (= declaration) order.
    const keys = Object.keys(a);
    for (let i = keys.length - 1; i >= 0; i--) work.push(a[keys[i]!], b[keys[i]!]);
  }
  return 0;
}

const TIE = Symbol("tie");
