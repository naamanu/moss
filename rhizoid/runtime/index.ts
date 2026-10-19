// Rhizoid runtime: implements the externals of the Rhizoid Moss modules, plus the app loop.

import { frameHooks, instScope, type Comp } from "./comp.ts";
import { Eff, setFrameRequester } from "../../src/runtime/effect.ts";
import { setAsyncPerformer } from "../../src/runtime/task.ts";
import { hasPendingChanges, observe, stabilize, stats } from "./incr.ts";
import { create, patch, patchStats, setDispatcher, type VNode } from "./vdom.ts";

export * from "./comp.ts";
export * from "./html.ts";
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

let current: App | undefined;

/** The app most recently mounted by `start` (for tests and tooling). */
export function currentApp(): App | undefined {
  return current;
}

/** `start page`: an effect that mounts the app on `#app` (created if missing). Add `?debug` to log frame timings. */
export function start(page: Comp<VNode>): Eff {
  return new Eff(() => {
    if (typeof document === "undefined") {
      throw new Error("Rhizoid.start needs a browser: use `moss dev` or `moss build` for UI apps, not `moss run`");
    }
    let root = document.getElementById("app");
    if (!root) {
      root = document.createElement("div");
      root.id = "app";
      document.body.appendChild(root);
    }
    const debug = typeof location !== "undefined" && /[?&]debug\b/.test(location.search);
    current = run(page, root, { debug });
  });
}

export function run(c: Comp<VNode>, root: HTMLElement, opts: RunOptions = {}): App {
  const view = observe(instScope(c));
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
  setAsyncPerformer(perform);

  return {
    root,
    flush() {
      if (pending || hasPendingChanges()) frame();
    },
  };
}
