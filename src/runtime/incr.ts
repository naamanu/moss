// A small self-adjusting computation engine in the style of Jane Street's
// Incremental. Nodes form a DAG; only "necessary" nodes (reachable from an
// observer) are kept up to date. Stabilization recomputes stale nodes in
// height order, and a node whose new value passes its cutoff does not
// propagate to its parents.

import { RecomputeHeap } from "./heap.ts";

let stamp = 0;
let stabilizing = false;
const heap = new RecomputeHeap<Node<any>>();
const changedVars: Var<any>[] = [];
const observers = new Set<Observer<any>>();

export const stats = { recomputed: 0, stabilizations: 0 };

export abstract class Node<T> {
  value!: T;
  height = 0;
  heapHeight = -1;
  inHeap = false;
  /** Number of links keeping this node alive (parents + observers). */
  refs = 0;
  parents = new Set<Node<any>>();
  changedAt = -1;

  /** Children this node reads in `compute`. */
  abstract children(): Iterable<Node<any>>;
  abstract compute(): T;

  cutoff(a: T, b: T): boolean {
    return defaultCutoff(a, b);
  }

  /** Called when a child's value changed, before this node is scheduled. */
  childChanged(_child: Node<any>): void {}

  /** Link children; called when the node becomes necessary. */
  activate(): void {
    for (const c of this.children()) link(c, this);
  }

  deactivate(): void {
    for (const c of this.children()) unlink(c, this);
  }

  /** Schedule parents after this node changed. */
  propagate(): void {
    for (const p of this.parents) {
      p.childChanged(this);
      heap.push(p);
    }
  }

  get necessary(): boolean {
    return this.refs > 0;
  }
}

/** Equality used as the default cutoff: physical, then shallow structural. */
export function defaultCutoff(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return a !== a && b !== b; // NaN
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) {
    return false;
  }
  let n = 0;
  for (const k in a) {
    if (a[k] !== b[k]) return false;
    n++;
  }
  for (const _ in b) n--;
  return n === 0;
}

/** Make `parent` depend on `child`. Idempotent. */
export function link(child: Node<any>, parent: Node<any>): void {
  if (!child.parents.has(parent)) {
    child.parents.add(parent);
    incRef(child);
  }
  ensureHeight(parent, child.height + 1);
}

export function unlink(child: Node<any>, parent: Node<any>): void {
  if (child.parents.delete(parent)) decRef(child);
}

function incRef(n: Node<any>): void {
  if (n.refs++ === 0) {
    n.activate();
    n.value = n.compute();
    n.changedAt = stamp;
    stats.recomputed++;
  }
}

function decRef(n: Node<any>): void {
  if (--n.refs === 0) {
    heap.remove(n);
    n.deactivate();
  }
}

/** Raise a node's height (and transitively its parents') to at least `h`. */
export function ensureHeight(n: Node<any>, h: number): void {
  if (n.height >= h) return;
  n.height = h;
  heap.rebucket(n);
  for (const p of n.parents) ensureHeight(p, h + 1);
}

/** Force a necessary node to be recomputed in the current/next stabilization. */
export function schedule(n: Node<any>): void {
  if (n.refs > 0) heap.push(n);
}

function recompute(n: Node<any>): void {
  if (n.refs === 0) return;
  stats.recomputed++;
  const v = n.compute();
  if (n.cutoff(n.value, v)) return;
  n.value = v;
  n.changedAt = stamp;
  n.propagate();
}

// ---------------------------------------------------------------------------
// Node kinds

export class Var<T> extends Node<T> {
  private pending: T;
  private dirty = false;

  constructor(init: T) {
    super();
    this.value = init;
    this.pending = init;
  }

  children(): Node<any>[] {
    return [];
  }

  compute(): T {
    return this.value;
  }

  /** The most recently set value, including not-yet-stabilized writes. */
  latest(): T {
    return this.pending;
  }

  set(v: T): void {
    this.pending = v;
    if (!this.dirty) {
      this.dirty = true;
      changedVars.push(this);
    }
  }

  /** @internal */
  commit(): void {
    this.dirty = false;
    const v = this.pending;
    if (this.cutoff(this.value, v)) return;
    this.value = v;
    this.changedAt = stamp;
    if (this.refs > 0) this.propagate();
  }

  override cutoff(a: T, b: T): boolean {
    return a === b;
  }
}

export class Const<T> extends Node<T> {
  constructor(v: T) {
    super();
    this.value = v;
  }
  children(): Node<any>[] {
    return [];
  }
  compute(): T {
    return this.value;
  }
}

export class Map1<A, T> extends Node<T> {
  constructor(readonly a: Node<A>, readonly f: (a: A) => T) {
    super();
  }
  children(): Node<any>[] {
    return [this.a];
  }
  compute(): T {
    return this.f(this.a.value);
  }
}

export class Map2<A, B, T> extends Node<T> {
  constructor(readonly a: Node<A>, readonly b: Node<B>, readonly f: (a: A, b: B) => T) {
    super();
  }
  children(): Node<any>[] {
    return [this.a, this.b];
  }
  compute(): T {
    return this.f(this.a.value, this.b.value);
  }
}

export class MapN<T> extends Node<T> {
  constructor(readonly inputs: Node<any>[], readonly f: (...xs: any[]) => T) {
    super();
  }
  children(): Node<any>[] {
    return this.inputs;
  }
  compute(): T {
    const xs = this.inputs;
    const args = new Array(xs.length);
    for (let i = 0; i < xs.length; i++) args[i] = xs[i]!.value;
    return this.f(...args);
  }
}

/** Projection with physical-equality cutoff (used for tuple patterns). */
export class Proj<A, T> extends Map1<A, T> {
  override cutoff(a: T, b: T): boolean {
    return a === b;
  }
}

/**
 * Dynamic node: `f` picks a right-hand-side node based on the value of `lhs`.
 * Re-runs `f` only when `lhs` changes; the rhs graph is linked dynamically.
 */
export class Bind<A, T> extends Node<T> {
  rhs: Node<T> | undefined;
  private lhsSeen = -2;

  constructor(readonly lhs: Node<A>, readonly f: (a: A) => Node<T>) {
    super();
  }

  children(): Node<any>[] {
    return this.rhs ? [this.lhs, this.rhs] : [this.lhs];
  }

  compute(): T {
    if (this.lhs.changedAt !== this.lhsSeen || this.rhs === undefined) {
      this.lhsSeen = this.lhs.changedAt;
      const next = this.f(this.lhs.value);
      if (next !== this.rhs) {
        const old = this.rhs;
        this.rhs = next;
        link(next, this);
        if (old) unlink(old, this);
      }
    }
    return this.rhs.value;
  }

  override cutoff(a: T, b: T): boolean {
    return a === b;
  }
}

// ---------------------------------------------------------------------------
// Observers and stabilization

class ObserverRoot<T> extends Node<T> {
  constructor(readonly target: Node<T>) {
    super();
  }
  children(): Node<any>[] {
    return [this.target];
  }
  compute(): T {
    return this.target.value;
  }
  override cutoff(a: T, b: T): boolean {
    return a === b;
  }
}

export class Observer<T> {
  private root: ObserverRoot<T>;
  private seen: number;

  constructor(node: Node<T>, readonly onChange?: (v: T) => void) {
    this.root = new ObserverRoot(node);
    this.root.refs = 1;
    this.root.activate();
    this.root.value = this.root.compute();
    this.seen = node.changedAt;
    observers.add(this);
  }

  get value(): T {
    return this.root.value;
  }

  /** @internal */
  notify(): void {
    const n = this.root.target;
    if (n.changedAt !== this.seen) {
      this.seen = n.changedAt;
      this.onChange?.(n.value);
    }
  }

  dispose(): void {
    observers.delete(this);
    this.root.deactivate();
  }
}

export function observe<T>(n: Node<T>, onChange?: (v: T) => void): Observer<T> {
  return new Observer(n, onChange);
}

export function isStabilizing(): boolean {
  return stabilizing;
}

export function stabilize(): void {
  if (stabilizing) throw new Error("stabilize: already stabilizing");
  stabilizing = true;
  stamp++;
  stats.stabilizations++;
  try {
    for (let i = 0; i < changedVars.length; i++) changedVars[i]!.commit();
    changedVars.length = 0;
    let n: Node<any> | undefined;
    while ((n = heap.pop()) !== undefined) recompute(n);
  } finally {
    stabilizing = false;
  }
  for (const o of observers) o.notify();
}

export function hasPendingChanges(): boolean {
  return changedVars.length > 0;
}
