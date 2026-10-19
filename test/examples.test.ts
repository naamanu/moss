// @vitest-environment jsdom
// Compile each example, mount it in jsdom and drive it through the DOM.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.ts";
import * as R from "../src/runtime/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const runtime = resolve(here, "../src/runtime/index.ts");
const tmp = join(here, ".tmp");

async function mount(example: string) {
  const file = resolve(here, "../examples", example);
  const js = compile(readFileSync(file, "utf8"), file, { runtimeImport: runtime });
  mkdirSync(tmp, { recursive: true });
  const out = join(tmp, example.replace(/\.moss$/, ".mjs"));
  writeFileSync(out, js);
  const mod = await import(/* @vite-ignore */ `${out}?t=${Date.now()}`);
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const app = R.run(mod.main, root);
  return { root, app };
}

function input(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

describe("counter.moss", () => {
  it("counts independently in each instance", async () => {
    const { root, app } = await mount("counter.moss");
    const counters = root.querySelectorAll(".counter");
    expect(counters.length).toBe(2);
    const [minusA, plusA] = [...counters[0]!.querySelectorAll("button")];
    plusA!.click();
    app.flush();
    plusA!.click();
    app.flush();
    minusA!.click();
    app.flush();
    expect(counters[0]!.querySelector("span")!.textContent).toBe("1");
    expect(counters[1]!.querySelector("span")!.textContent).toBe("0");
  });
});

describe("todo.moss", () => {
  it("adds, toggles, filters and clears todos", async () => {
    const { root, app } = await mount("todo.moss");
    const titles = () => [...root.querySelectorAll(".todo-list li label")].map((l) => l.textContent);
    expect(titles()).toEqual(["Write a language", "Make it incremental", "Ship it"]);

    const box = root.querySelector<HTMLInputElement>(".new-todo")!;
    input(box, "Write tests");
    app.flush();
    key(box, "Enter");
    app.flush();
    expect(titles()).toEqual(["Write a language", "Make it incremental", "Ship it", "Write tests"]);
    expect(box.value).toBe("");
    expect(root.querySelector(".count")!.textContent).toBe("3 items left");

    // Toggling one todo must only touch that row's DOM.
    const rows = [...root.querySelectorAll(".todo-list li")];
    const mutated = new Set<Node>();
    const mo = new MutationObserver((ms) => ms.forEach((m) => mutated.add(m.target)));
    mo.observe(root.querySelector(".todo-list")!, { subtree: true, childList: true, attributes: true, characterData: true });
    rows[1]!.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
    app.flush();
    await Promise.resolve();
    mo.disconnect();
    expect([...mutated].every((n) => rows[1]!.contains(n))).toBe(true);
    expect(rows[1]!.className).toBe("completed");
    expect(root.querySelector(".count")!.textContent).toBe("2 items left");

    // Filter to active.
    [...root.querySelectorAll(".filters button")].find((b) => b.textContent === "Active")!.dispatchEvent(new Event("click"));
    app.flush();
    expect(titles()).toEqual(["Ship it", "Write tests"]);

    [...root.querySelectorAll(".filters button")].find((b) => b.textContent === "All")!.dispatchEvent(new Event("click"));
    app.flush();
    root.querySelector<HTMLButtonElement>(".clear")!.click();
    app.flush();
    expect(titles()).toEqual(["Ship it", "Write tests"]);
  });

  it("keeps per-row editing state and renames", async () => {
    const { root, app } = await mount("todo.moss");
    const label = root.querySelectorAll(".todo-list li label")[2]!;
    label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    app.flush();
    const edit = root.querySelector<HTMLInputElement>(".todo-list .edit")!;
    expect(edit.value).toBe("Ship it");
    input(edit, "Ship it today");
    app.flush();
    key(edit, "Enter");
    app.flush();
    expect(root.querySelectorAll(".todo-list li label")[2]!.textContent).toBe("Ship it today");
  });

  it("shows the empty state via match* and restores the list", async () => {
    const { root, app } = await mount("todo.moss");
    for (let i = 0; i < 3; i++) {
      root.querySelector<HTMLButtonElement>(".todo-list .destroy")!.click();
      app.flush();
    }
    expect(root.querySelector(".empty")).not.toBeNull();
    const box = root.querySelector<HTMLInputElement>(".new-todo")!;
    input(box, "Again");
    app.flush();
    key(box, "Enter");
    app.flush();
    expect(root.querySelector(".empty")).toBeNull();
    expect(root.querySelectorAll(".todo-list li").length).toBe(1);
  });
});

describe("table.moss", () => {
  it("renders 10k rows and updates only changed rows per tick", async () => {
    const { root, app } = await mount("table.moss");
    const rows = root.querySelectorAll(".rows .row");
    expect(rows.length).toBe(10000);
    const before = [...rows].map((r) => r.children[2]!.textContent);

    // Drive one tick by clicking through the timer-free path: dispatch via the Faster button
    // is not a tick, so wait for the real 16ms interval.
    await new Promise((r) => setTimeout(r, 40));
    const r0 = R.stats.recomputed;
    const p0 = R.patchStats.patched;
    const t0 = performance.now();
    app.flush();
    const ms = performance.now() - t0;
    const after = [...root.querySelectorAll(".rows .row")].map((r) => r.children[2]!.textContent);
    const changed = after.filter((x, i) => x !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(150); // up to `rate` rows per tick, a few ticks may have fired
    // Work is proportional to the change, not the table size.
    expect(R.stats.recomputed - r0).toBeLessThan(2000);
    expect(R.patchStats.patched - p0).toBeLessThan(2000);
    console.log(`table tick: ${changed} rows changed, ${R.stats.recomputed - r0} nodes, ${ms.toFixed(1)}ms (jsdom)`);

    // Per-row state: expand one row.
    const row = root.querySelectorAll(".rows .row")[42]!;
    (row as HTMLElement).click();
    app.flush();
    expect(row.children[4]!.textContent).toMatch(/^vol \d+$/);
  });
});
