// Recompute heap: nodes bucketed by height, popped lowest-height first.
// Removal and re-bucketing are lazy: stale entries are skipped on pop.

export interface HeapEntry {
  height: number;
  heapHeight: number;
  inHeap: boolean;
}

export class RecomputeHeap<N extends HeapEntry> {
  private buckets: N[][] = [];
  private min = Infinity;
  size = 0;

  push(n: N): void {
    if (n.inHeap) {
      if (n.heapHeight !== n.height) this.rebucket(n);
      return;
    }
    n.inHeap = true;
    this.insert(n);
    this.size++;
  }

  /** Call after a node's height changed while it may be in the heap. */
  rebucket(n: N): void {
    if (!n.inHeap || n.heapHeight === n.height) return;
    this.insert(n);
  }

  remove(n: N): void {
    if (!n.inHeap) return;
    n.inHeap = false;
    this.size--;
  }

  pop(): N | undefined {
    while (this.size > 0) {
      const h = this.min;
      const bucket = this.buckets[h];
      if (bucket === undefined || bucket.length === 0) {
        this.min = h + 1;
        continue;
      }
      const n = bucket.pop()!;
      if (!n.inHeap || n.heapHeight !== h) continue;
      n.inHeap = false;
      this.size--;
      return n;
    }
    // Drop any stale entries left behind by lazy removal.
    this.buckets.length = 0;
    this.min = Infinity;
    return undefined;
  }

  private insert(n: N): void {
    const h = n.height;
    n.heapHeight = h;
    (this.buckets[h] ??= []).push(n);
    if (h < this.min) this.min = h;
  }
}
