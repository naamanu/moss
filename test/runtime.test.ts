// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as R from "../src/runtime/index.ts";
import { Map1, Map2, Var, observe, stabilize, stats } from "../src/runtime/incr.ts";
import { PMap, compare } from "../src/runtime/pmap.ts";
import { VElem, VText, create, patch } from "../src/runtime/vdom.ts";

describe("incr", () => {
  it("recomputes in height order and cuts off unchanged values", () => {
    const a = new Var(1);
    let parityRuns = 0;
    let outRuns = 0;
    const parity = new Map1(a, (x) => (parityRuns++, x % 2));
    const out = new Map2(parity, a, (p, x) => (outRuns++, `${x}:${p}`));
    const o = observe(out);
    expect(o.value).toBe("1:1");
    a.set(3);
    stabilize();
    expect(o.value).toBe("3:1");
    expect(parityRuns).toBe(2);
    expect(outRuns).toBe(2); // once initially, once for the change (not twice: glitch-free)
    const before = outRuns;
    const p = new Var(0);
    const onlyParity = observe(new Map1(new Map1(p, (x) => x % 2), (q) => (outRuns++, q)));
    p.set(2); // parity unchanged -> downstream node must not run
    stabilize();
    expect(outRuns).toBe(before + 1);
    expect(onlyParity.value).toBe(0);
  });

  it("recovers after a computation throws mid-stabilization", () => {
    const a = new Var(1);
    const b = new Var(10);
    const inv = new Map1(a, (x) => R.idiv(100, x));
    const other = new Map1(b, (x) => x + 1);
    const o1 = observe(inv);
    const o2 = observe(other);
    a.set(0);
    b.set(20);
    expect(() => stabilize()).toThrow("Division_by_zero");
    expect(o1.value).toBe(100); // the failing node keeps its last good value
    a.set(4);
    stabilize(); // later stabilizations proceed normally
    expect(o1.value).toBe(25);
    expect(o2.value).toBe(21);
  });

  it("stops updating nodes once unobserved", () => {
    const a = new Var(1);
    let runs = 0;
    const m = new Map1(a, (x) => (runs++, x * 2));
    const o = observe(m);
    o.dispose();
    a.set(5);
    stabilize();
    expect(runs).toBe(1);
    expect(m.necessary).toBe(false);
  });
});

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

describe("vdom", () => {
  const li = (k: string) => new VElem("li", k, null, null, [new VText(k)]);
  const ul = (ks: string[]) => new VElem("ul", null, null, null, ks.map(li));
  const texts = (n: Node) => [...n.childNodes].map((c) => c.textContent);

  it("reorders keyed children, reusing DOM nodes", () => {
    const a = ul(["a", "b", "c", "d", "e"]);
    const dom = create(a) as HTMLElement;
    const nodeB = dom.childNodes[1];
    const b = ul(["e", "b", "x", "a", "d"]);
    patch(dom, a, b);
    expect(texts(dom)).toEqual(["e", "b", "x", "a", "d"]);
    expect(dom.childNodes[1]).toBe(nodeB);
    const c = ul([]);
    patch(dom, b, c);
    expect(texts(dom)).toEqual([]);
  });

  it("random keyed shuffles produce the right DOM", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = R.Random_next(seed)) % n);
    let prev = ul(["0", "1", "2"]);
    const dom = create(prev) as HTMLElement;
    for (let t = 0; t < 300; t++) {
      const ks = [...new Set(Array.from({ length: rnd(12) }, () => String(rnd(15))))];
      const next = ul(ks);
      patch(dom, prev, next);
      expect(texts(dom)).toEqual(ks);
      prev = next;
    }
  });
});

describe("computations", () => {
  it("runs a hand-written counter", () => {
    // component counter =
    //   let* count, set = state 0 in
    //   let+ c = count and set = set in
    //   div [] [button [on_click (set (c + 1))] [text "+"]; text (show c)]
    const counter = R.sub(R.state(0), (st) => {
      const count = R.proj<number>(st, 0);
      const set = R.proj<(n: number) => R.Eff>(st, 1);
      return R.arr([count, set], (c: number, set: (n: number) => R.Eff) =>
        R.Html_el(
          "div",
          R.list(),
          R.list(R.Html_el("button", R.list(R.Attr_on_click(set(c + 1))), R.list(R.Html_text("+"))), R.Html_text(R.show(c))),
        ),
      );
    });
    const root = document.createElement("div");
    const app = R.run(counter, root);
    expect(root.textContent).toBe("+0");
    root.querySelector("button")!.click();
    app.flush();
    root.querySelector("button")!.click();
    app.flush();
    expect(root.textContent).toBe("+2");
  });

  it("assoc only recomputes rows whose input changed", () => {
    let m = R.Map_empty as PMap<number, number>;
    for (let i = 0; i < 1000; i++) m = m.set(i, i);
    const input = new Var(m);
    let rowRuns = 0;
    const rows = R.assoc(input, (k: number) => (v) => R.arr([v], (x: number) => (rowRuns++, `${k}=${x}`)));
    const o = observe(rows.inst());
    expect(o.value.size).toBe(1000);
    expect(rowRuns).toBe(1000);

    rowRuns = 0;
    const r0 = stats.recomputed;
    input.set(m.set(10, -1).set(500, -2).delete(999).set(2000, 7));
    stabilize();
    expect(rowRuns).toBe(3); // two updates + one insertion
    expect(stats.recomputed - r0).toBeLessThan(20);
    expect(o.value.get(10)).toBe("10=-1");
    expect(o.value.get(2000)).toBe("2000=7");
    expect(o.value.has(999)).toBe(false);
    expect(o.value.size).toBe(1000);
  });

  it("match* keeps the state of inactive branches", () => {
    const which = new Var<{ $: string }>({ $: "A" });
    const branch = (label: string) =>
      R.sub(R.state(0), (st) => R.arr([st], ([n, set]: [number, (n: number) => R.Eff]) => ({ label, n, set })));
    const c = R.sw(which, [(x) => (x.$ === "A" ? [] : null), (x) => (x.$ === "B" ? [] : null)], [() => branch("A"), () => branch("B")]);
    const o = observe(c.inst());
    o.value.set(5).run();
    stabilize();
    expect(o.value).toMatchObject({ label: "A", n: 5 });
    which.set({ $: "B" });
    stabilize();
    expect(o.value).toMatchObject({ label: "B", n: 0 });
    which.set({ $: "A" });
    stabilize();
    expect(o.value).toMatchObject({ label: "A", n: 5 });
  });
});

describe("every", () => {
  afterEach(() => vi.useRealTimers());

  // A computation that ticks `count` every 10ms while it's active.
  const ticker = (count: { n: number }) =>
    R.sub(R.every(10, R.cnst(new R.Eff(() => void count.n++))), () => R.ret(R.cnst("ticking")));

  it("stops while its match* branch is inactive and resumes when it's selected again", () => {
    vi.useFakeTimers();
    const count = { n: 0 };
    const which = new Var<{ $: string }>({ $: "On" });
    const c = R.sw(
      which,
      [(x) => (x.$ === "On" ? [] : null), (x) => (x.$ === "Off" ? [] : null)],
      [() => ticker(count), () => R.ret(R.cnst("idle"))],
    );
    const root = document.createElement("div");
    const app = R.run(R.sub(c, (v) => R.arr([v], (s: string) => R.Html_text(s))), root);
    vi.advanceTimersByTime(55);
    expect(count.n).toBe(5);

    which.set({ $: "Off" });
    app.flush();
    expect(root.textContent).toBe("idle");
    vi.advanceTimersByTime(100);
    expect(count.n).toBe(5); // timer cleared

    which.set({ $: "On" });
    app.flush();
    vi.advanceTimersByTime(30);
    expect(count.n).toBe(8); // restarted
  });

  it("stops when its assoc key is removed", () => {
    vi.useFakeTimers();
    const counts = new Map<number, { n: number }>([[1, { n: 0 }], [2, { n: 0 }]]);
    const input = new Var((R.Map_empty as PMap<number, number>).set(1, 1).set(2, 2));
    const rows = R.assoc(input, (k: number) => () => ticker(counts.get(k)!));
    observe(R.instScope(rows));
    vi.advanceTimersByTime(25);
    expect([counts.get(1)!.n, counts.get(2)!.n]).toEqual([2, 2]);

    input.set(input.latest().delete(1));
    stabilize();
    vi.advanceTimersByTime(50);
    expect([counts.get(1)!.n, counts.get(2)!.n]).toEqual([2, 7]);
  });
});

describe("resource", () => {
  afterEach(() => vi.useRealTimers());

  /** Tasks whose completion the test controls; records each run's key and signal. */
  function controlled() {
    const runs: { key: string; signal: AbortSignal; resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
    const f = (key: string) =>
      new R.Task<string>(
        (signal) =>
          new Promise((resolve, reject) => {
            runs.push({ key, signal, resolve, reject });
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
    return { runs, f };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const show = (r: R.Remote<string>) => (r.$ === "Loaded" ? `Loaded ${r.v}` : r.$ === "Failed" ? `Failed ${r.v}` : "Loading");

  it("aborts the previous request when the key changes and drops stale responses", async () => {
    const { runs, f } = controlled();
    const key = new Var("a");
    const o = observe(R.instScope(R.resource(key, f)));
    expect(show(o.value)).toBe("Loading");
    expect(runs.map((r) => r.key)).toEqual(["a"]);

    key.set("b");
    stabilize();
    expect(show(o.value)).toBe("Loading");
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(runs.map((r) => r.key)).toEqual(["a", "b"]);

    runs[0]!.resolve("stale A"); // ignored: superseded (and aborted)
    runs[1]!.resolve("fresh B");
    await settle();
    stabilize();
    expect(show(o.value)).toBe("Loaded fresh B");
  });

  it("drops a late response even if the old task ignores the abort signal", async () => {
    const pending: ((v: string) => void)[] = [];
    const f = (k: string) => new R.Task<string>(() => new Promise((res) => pending.push((v) => res(`${k}:${v}`))));
    const key = new Var("x");
    const o = observe(R.instScope(R.resource(key, f)));
    key.set("y");
    stabilize();
    pending[1]!("1");
    await settle();
    stabilize();
    pending[0]!("late");
    await settle();
    stabilize();
    expect(show(o.value)).toBe("Loaded y:1");
  });

  it("reports failures, and keeps Loading until the current key answers", async () => {
    const { runs, f } = controlled();
    const key = new Var("a");
    const o = observe(R.instScope(R.resource(key, f)));
    runs[0]!.reject(new Error("boom"));
    await settle();
    stabilize();
    expect(show(o.value)).toBe("Failed boom");
    // Switching key shows Loading in the same stabilization, not the old failure.
    key.set("b");
    stabilize();
    expect(show(o.value)).toBe("Loading");
  });

  it("aborts when its match* branch deactivates, restarts when reselected, and keeps finished results", async () => {
    const { runs, f } = controlled();
    const which = new Var<{ $: string }>({ $: "On" });
    const key = new Var("q");
    const c = R.sw(
      which,
      [(x) => (x.$ === "On" ? [] : null), (x) => (x.$ === "Off" ? [] : null)],
      [() => R.resource(key, f), () => R.ret(R.cnst<R.Remote<string>>(R.Loading))],
    );
    const o = observe(R.instScope(c));
    expect(runs.length).toBe(1);

    which.set({ $: "Off" });
    stabilize();
    expect(runs[0]!.signal.aborted).toBe(true);

    which.set({ $: "On" });
    stabilize();
    expect(runs.length).toBe(2); // restarted for the same key
    runs[1]!.resolve("done");
    await settle();
    stabilize();
    expect(show(o.value)).toBe("Loaded done");

    which.set({ $: "Off" });
    stabilize();
    which.set({ $: "On" });
    stabilize();
    expect(runs.length).toBe(2); // finished result for the same key is reused
    expect(show(o.value)).toBe("Loaded done");
  });

  it("aborts sleeps and cancels timers", async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    let outcome = "pending";
    R.Task_sleep(1000)
      .run(ctrl.signal)
      .then(
        () => (outcome = "slept"),
        (e) => (outcome = R.isAbort(e) ? "aborted" : "error"),
      );
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(2000);
    expect(outcome).toBe("aborted");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Http.get_text passes the signal and turns HTTP errors into failures", async () => {
    const calls: { url: string; signal: AbortSignal }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { signal: AbortSignal }) => {
      calls.push({ url, signal: init.signal });
      return url === "/ok"
        ? { ok: true, status: 200, statusText: "OK", text: async () => "hello" }
        : { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
    });
    try {
      const ctrl = new AbortController();
      await expect(R.Http_get_text("/ok").run(ctrl.signal)).resolves.toBe("hello");
      expect(calls[0]!.signal).toBe(ctrl.signal);
      await expect(R.Http_get_text("/missing").run(ctrl.signal)).rejects.toThrow("HTTP 404 Not Found");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Task.attempt reports the outcome through an effect", async () => {
    const seen: string[] = [];
    const k = (r: R.Remote<string>) => new R.Eff(() => void seen.push(show(r)));
    R.Task_attempt(R.Task_map((x: number) => `n=${x}`, R.Task_succeed(1)), k).run();
    R.Task_attempt(R.Task_fail("nope"), k).run();
    await settle();
    expect(seen.sort()).toEqual(["Failed nope", "Loaded n=1"]);
  });
});
