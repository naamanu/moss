// Runtime entry point imported by compiled Moss programs.

import { frameHooks, type Comp } from "./comp.ts";
import { type Eff, setFrameRequester } from "./effect.ts";
import { hasPendingChanges, observe, stabilize, stats } from "./incr.ts";
import { create, patch, patchStats, setDispatcher, type VNode } from "./vdom.ts";

export * from "./comp.ts";
export * from "./prelude.ts";
export { Eff } from "./effect.ts";
export { stabilize, stats } from "./incr.ts";
export { patchStats } from "./vdom.ts";

export interface App {
  /** Run any pending frame synchronously (useful in tests). */
  flush(): void;
  readonly root: HTMLElement;
}

export interface RunOptions {
  debug?: boolean;
}

export function run(c: Comp<VNode>, root: HTMLElement, opts: RunOptions = {}): App {
  const view = observe(c.inst());
  stabilize();
  let tree = view.value;
  let dom = create(tree, root.ownerDocument);
  root.replaceChildren(dom);

  let pending = false;
  const frame = (): void => {
    pending = false;
    const t0 = performance.now();
    const r0 = stats.recomputed;
    const p0 = patchStats.patched + patchStats.created;
    stabilize();
    const t1 = performance.now();
    const next = view.value;
    if (next !== tree) {
      dom = patch(dom, tree, next);
      tree = next;
    }
    if (opts.debug) {
      const t2 = performance.now();
      console.log(
        `[moss] stabilize ${(t1 - t0).toFixed(2)}ms (${stats.recomputed - r0} nodes)` +
          ` patch ${(t2 - t1).toFixed(2)}ms (${patchStats.patched + patchStats.created - p0} vnodes)`,
      );
    }
  };

  const raf: (f: () => void) => void =
    typeof requestAnimationFrame === "function" ? (f) => requestAnimationFrame(f) : (f) => setTimeout(f, 0);
  const request = (): void => {
    if (!pending) {
      pending = true;
      raf(() => pending && frame());
    }
  };
  const perform = (eff: Eff): void => {
    eff.run();
    request();
  };
  setFrameRequester(request);
  setDispatcher(perform);
  frameHooks.perform = perform;

  return {
    root,
    flush() {
      if (pending || hasPendingChanges()) frame();
    },
  };
}
