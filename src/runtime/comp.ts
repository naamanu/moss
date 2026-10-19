// Computations (Bonsai's `Computation.t`): descriptions of a piece of the
// incremental graph, possibly allocating state. Instantiating a computation
// builds its nodes once; afterwards only values flow through the graph.

import { Eff } from "./effect.ts";
import {
  Bind,
  Const,
  Map1,
  Map2,
  MapN,
  Node,
  Proj,
  Var,
  link,
  observe,
  schedule,
  unlink,
} from "./incr.ts";
import { PMap } from "./pmap.ts";

export type Val<T> = Node<T>;

export interface Comp<T> {
  inst(): Val<T>;
}

const comp = <T>(inst: () => Val<T>): Comp<T> => ({ inst });

/** `return v`: a computation that just yields an existing value. */
export function ret<T>(v: Val<T>): Comp<T> {
  return comp(() => v);
}

export function cnst<T>(x: T): Val<T> {
  return new Const(x);
}

/** `let* x = c in body`: instantiate `c`, then the computation built from its result. */
export function sub<A, T>(c: Comp<A>, body: (x: Val<A>) => Comp<T>): Comp<T> {
  return comp(() => body(c.inst()).inst());
}

/** `let+ x = a and y = b in f x y`: one map node over the inputs. */
export function arr<T>(inputs: Val<any>[], f: (...xs: any[]) => T): Comp<T> {
  switch (inputs.length) {
    case 1:
      return comp(() => new Map1(inputs[0]!, f));
    case 2:
      return comp(() => new Map2(inputs[0]!, inputs[1]!, f));
    default:
      return comp(() => new MapN(inputs, f));
  }
}

/** Projection of a tuple component; cuts off when the component is unchanged. */
export function proj<T>(v: Val<any[]>, i: number): Val<T> {
  return new Proj(v, (t) => t[i]);
}

export function state<T>(init: T): Comp<[T, (v: T) => Eff<void>]> {
  return comp(() => {
    const v = new Var(init);
    const set = (x: T) => new Eff(() => v.set(x));
    return new Map1(v, (x) => [x, set] as [T, typeof set]);
  });
}

export function state_machine<M, A>(init: M, reduce: (m: M) => (a: A) => M): Comp<[M, (a: A) => Eff<void>]> {
  return comp(() => {
    const v = new Var(init);
    // Reduce against the latest written model so several actions in one frame compose.
    const dispatch = (a: A) => new Eff(() => v.set(reduce(v.latest())(a)));
    return new Map1(v, (m) => [m, dispatch] as [M, typeof dispatch]);
  });
}

// ---------------------------------------------------------------------------
// Lifecycles. Some nodes (timers) have no consumers but must run while the
// part of the app that created them is on screen. Each dynamic boundary (the
// app root, a match* branch, an assoc key) instantiates its computation in a
// scope; lifecycle nodes created inside are kept alive by that scope's result,
// so they activate and deactivate together with it.

let lifecycles: Node<any>[] | null = null;

/** Keeps `extra` necessary whenever `result` is. */
class Keep<T> extends Node<T> {
  constructor(readonly result: Node<T>, readonly extra: Node<any>[]) {
    super();
  }
  children(): Node<any>[] {
    return [this.result, ...this.extra];
  }
  compute(): T {
    return this.result.value;
  }
  override cutoff(a: T, b: T): boolean {
    return a === b;
  }
}

/** Instantiate `c` as a unit whose lifecycle nodes live exactly as long as its result. */
export function instScope<T>(c: Comp<T>): Val<T> {
  const saved = lifecycles;
  const mine: Node<any>[] = [];
  lifecycles = mine;
  try {
    const r = c.inst();
    return mine.length > 0 ? new Keep(r, mine) : r;
  } finally {
    lifecycles = saved;
  }
}

/** Runs the current effect every `ms` while active; the interval is cleared on deactivation. */
class EveryNode extends Node<undefined> {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(readonly ms: number, readonly eff: Val<Eff>) {
    super();
  }
  children(): Node<any>[] {
    return [this.eff];
  }
  compute(): undefined {
    return undefined;
  }
  override activate(): void {
    super.activate();
    this.timer = setInterval(() => frameHooks.perform(this.eff.value), this.ms);
  }
  override deactivate(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    super.deactivate();
  }
  get running(): boolean {
    return this.timer !== undefined;
  }
}

/** `every ms eff`: run the (current) effect on an interval while this part of the app is active. */
export function every(ms: number, eff: Val<Eff>): Comp<undefined> {
  return comp(() => {
    const n = new EveryNode(ms, eff);
    // Outside any scope (instantiated by hand), keep the timer for good.
    if (lifecycles) lifecycles.push(n);
    else observe(n);
    return new Const(undefined);
  });
}

/** Set by the app loop so timers can schedule frames without an import cycle. */
export const frameHooks: { perform: (e: Eff) => void } = { perform: (e) => void e.run() };

// ---------------------------------------------------------------------------
// assoc: one sub-graph per key of an incremental map. Diffing the input map
// is O(changes) thanks to PMap.symmetricDiff, and only the sub-graphs of keys
// that changed are scheduled.

interface Instance<K, V, R> {
  key: K;
  input: KeyInput<K, V>;
  out: Val<R>;
}

/** Reads the current value for one key; scheduled only when that key changes. */
class KeyInput<K, V> extends Node<V> {
  constructor(readonly src: AssocIn<K, V, any>, readonly key: K) {
    super();
  }
  children(): Node<any>[] {
    return [this.src];
  }
  compute(): V {
    const v = this.src.current!.get(this.key);
    return v === undefined ? this.value : v;
  }
  override cutoff(a: V, b: V): boolean {
    return a === b;
  }
}

class AssocIn<K, V, R> extends Node<PMap<K, V>> {
  /** The input map as of the last diff. */
  current: PMap<K, V> | undefined;
  instances: PMap<K, Instance<K, V, R>> | undefined;
  out!: AssocOut<K, V, R>;

  constructor(readonly input: Val<PMap<K, V>>, readonly make: (k: K, v: Val<V>) => Comp<R>) {
    super();
  }

  children(): Node<any>[] {
    return [this.input];
  }

  compute(): PMap<K, V> {
    const cur = this.input.value;
    const prev = this.current ?? PMap.empty<K, V>(cur.cmp);
    if (prev === cur) return cur;
    this.current = cur;
    let insts = (this.instances ??= PMap.empty(cur.cmp));
    const added: Instance<K, V, R>[] = [];
    const removed: Instance<K, V, R>[] = [];
    prev.symmetricDiff(cur, (d) => {
      switch (d.kind) {
        case "add": {
          const inst: Instance<K, V, R> = { key: d.key, input: new KeyInput<K, V>(this, d.key), out: undefined! };
          insts = insts.set(d.key, inst);
          added.push(inst);
          break;
        }
        case "remove":
          removed.push(insts.get(d.key)!);
          insts = insts.delete(d.key);
          break;
        case "update":
          schedule(insts.get(d.key)!.input);
          break;
      }
    });
    this.instances = insts;
    for (const inst of added) inst.out = instScope(this.make(inst.key, inst.input));
    if (added.length > 0 || removed.length > 0) this.out.applyStructural(added, removed);
    return cur;
  }

  override cutoff(a: PMap<K, V>, b: PMap<K, V>): boolean {
    return a === b;
  }

  // Parents are notified selectively: changed keys via `schedule`, and the
  // output node via `applyStructural`. Never fan out to every key.
  override propagate(): void {}
}

class AssocOut<K, V, R> extends Node<PMap<K, R>> {
  private result: PMap<K, R> | undefined;
  private dirty: Instance<K, V, R>[] = [];
  /** Output node -> instances producing it (usually exactly one). */
  private byOut = new Map<Node<any>, Instance<K, V, R>[]>();
  private active = false;

  constructor(readonly src: AssocIn<K, V, R>) {
    super();
    src.out = this;
  }

  children(): Node<any>[] {
    return [this.src];
  }

  override activate(): void {
    this.active = true;
    this.result = undefined;
    // Linking the input runs its diff, which reports new keys via applyStructural.
    link(this.src, this);
    this.src.instances?.forEach((inst) => this.attach(inst));
  }

  override deactivate(): void {
    this.active = false;
    for (const out of this.byOut.keys()) unlink(out, this);
    this.byOut.clear();
    this.dirty = [];
    unlink(this.src, this);
  }

  private attach(inst: Instance<K, V, R>): void {
    const list = this.byOut.get(inst.out);
    if (list?.includes(inst)) return;
    if (list) list.push(inst);
    else {
      this.byOut.set(inst.out, [inst]);
      link(inst.out, this);
    }
    this.dirty.push(inst);
  }

  private detach(inst: Instance<K, V, R>): void {
    const list = this.byOut.get(inst.out);
    if (list === undefined) return;
    const i = list.indexOf(inst);
    if (i < 0) return;
    list.splice(i, 1);
    if (list.length === 0) {
      this.byOut.delete(inst.out);
      unlink(inst.out, this);
    }
  }

  applyStructural(added: Instance<K, V, R>[], removed: Instance<K, V, R>[]): void {
    if (!this.active) return;
    for (const inst of removed) {
      this.detach(inst);
      this.result = this.result?.delete(inst.key);
    }
    for (const inst of added) this.attach(inst);
    schedule(this);
  }

  override childChanged(child: Node<any>): void {
    const list = this.byOut.get(child);
    if (list) for (const inst of list) this.dirty.push(inst);
  }

  compute(): PMap<K, R> {
    let r = this.result ?? PMap.empty<K, R>(this.src.value.cmp);
    for (const inst of this.dirty) if (this.byOut.get(inst.out)?.includes(inst)) r = r.set(inst.key, inst.out.value);
    this.dirty = [];
    this.result = r;
    return r;
  }

  override cutoff(a: PMap<K, R>, b: PMap<K, R>): boolean {
    return a === b;
  }
}

export function assoc<K, V, R>(input: Val<PMap<K, V>>, f: (k: K) => (v: Val<V>) => Comp<R>): Comp<PMap<K, R>> {
  return comp(() => new AssocOut(new AssocIn(input, (k, v) => f(k)(v))));
}

// ---------------------------------------------------------------------------
// match*: switch between sub-computations based on a value. Each branch is
// instantiated at most once, so an inactive branch keeps its state.

export type Matcher = (x: any) => any[] | null;

export function sw<T>(v: Val<any>, matchers: Matcher[], branches: ((binds: Val<any>[]) => Comp<T>)[]): Comp<T> {
  return comp(() => {
    const which = new Map1(v, (x) => {
      for (let i = 0; i < matchers.length; i++) if (matchers[i]!(x) !== null) return i;
      throw new Error("match*: no case matched");
    });
    const cache: Val<T>[] = [];
    return new Bind(which, (i) => {
      let n = cache[i];
      if (n === undefined) {
        const m = matchers[i]!;
        const arity = m(v.value)?.length ?? 0;
        const binds: Val<any>[] = [];
        for (let j = 0; j < arity; j++) {
          // Keep the last good value while another branch is selected.
          binds.push(new Proj(v, function (this: Proj<any, any>, x) {
            const r = m(x);
            return r === null ? this.value : r[j];
          }));
        }
        n = cache[i] = instScope(branches[i]!(binds));
      }
      return n;
    });
  });
}

