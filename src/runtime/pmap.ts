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

/** Structural ordering on Moss values used as map keys. */
export function compare(a: any, b: any): number {
  if (a === b) return 0;
  const ta = typeof a;
  if (ta === "number" || ta === "string" || ta === "boolean") return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = compare(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (a === null || b === null) return a === null ? (b === null ? 0 : -1) : 1;
  if (ta === "object") {
    if ("$" in a) {
      // Variants: order by tag, then payload.
      if (a.$ !== b.$) return a.$ < b.$ ? -1 : 1;
      return compare(a.v, b.v);
    }
    if ("h" in a && "t" in a) {
      const c = compare(a.h, b.h);
      return c !== 0 ? c : compare(a.t, b.t);
    }
    const keys = Object.keys(a).sort();
    for (const k of keys) {
      const c = compare(a[k], b[k]);
      if (c !== 0) return c;
    }
    return 0;
  }
  return 0;
}
