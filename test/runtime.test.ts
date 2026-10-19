import { describe, expect, it } from "vitest";
import * as R from "../src/runtime/index.ts";
import { PMap, compare } from "../src/runtime/pmap.ts";

describe("pmap", () => {
  const naiveDiff = (a: PMap<number, number>, b: PMap<number, number>) => {
    const out: string[] = [];
    const keys = new Set<number>();
    a.forEach((_, k) => keys.add(k));
    b.forEach((_, k) => keys.add(k));
    for (const k of [...keys].sort((x, y) => x - y)) {
      const x = a.get(k);
      const y = b.get(k);
      if (x === undefined) out.push(`+${k}`);
      else if (y === undefined) out.push(`-${k}`);
      else if (x !== y) out.push(`~${k}`);
    }
    return out;
  };

  it("symmetricDiff matches a naive diff on random edits", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = R.Random_next(seed)) % n);
    for (let trial = 0; trial < 200; trial++) {
      let a = PMap.empty<number, number>(compare);
      for (let i = 0; i < rnd(200); i++) a = a.set(rnd(300), rnd(5));
      let b = a;
      for (let i = 0; i < rnd(20); i++) {
        const op = rnd(3);
        if (op === 0) b = b.delete(rnd(300));
        else b = b.set(rnd(300), rnd(5));
      }
      const got: string[] = [];
      a.symmetricDiff(b, (d) => got.push(`${d.kind === "add" ? "+" : d.kind === "remove" ? "-" : "~"}${d.key}`));
      expect(got).toEqual(naiveDiff(a, b));
    }
  });

  it("skips shared subtrees", () => {
    let a = PMap.empty<number, number>(compare);
    for (let i = 0; i < 100_000; i++) a = a.set(i, i);
    const b = a.set(5000, -1);
    let calls = 0;
    const cmp = (x: number, y: number) => (calls++, x - y);
    const a2 = Object.assign(Object.create(PMap.prototype), a, { cmp });
    a2.symmetricDiff(b, () => {});
    expect(calls).toBeLessThan(200);
  });
});
