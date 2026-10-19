import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Loader, MossError, check, compile, formatError } from "../src/compiler/compile.ts";
import { STDLIB } from "../src/compiler/stdlib.generated.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** An in-memory project: module name -> source. */
const project = (files: Record<string, string>): Loader => (m) => {
  const f = `${m.charAt(0).toLowerCase()}${m.slice(1)}.moss`;
  return files[m] === undefined ? undefined : { file: f, source: files[m]! };
};

function errorOf(src: string, files: Record<string, string> = {}): string {
  try {
    check(src, "main.moss", "library", project(files));
  } catch (e) {
    if (e instanceof MossError) return formatError(e);
    throw e;
  }
  throw new Error("expected an error");
}

/** Compile and evaluate; return the entry module's values by name. */
async function evalMoss(src: string, files: Record<string, string>, names: string[]): Promise<any[]> {
  const R = await import("../src/runtime/index.ts");
  const js = compile(`${src}\napp (return (const (text "")))`, "main.moss", { loader: project(files) });
  const body = js.replace(/^import .*$/m, "").replace(/^export /gm, "");
  return new Function("R", `${body}\nreturn [${names.map((n) => `$Main_${n}`).join(", ")}];`)(R);
}

const SHAPES = `
type shape = Circle of float | Rect of float * float
type point = { x : int; y : int }
let origin = { x = 0; y = 0 }
let area s = match s with Circle r -> r *. r | Rect (w, h) -> w *. h
`;

describe("modules", () => {
  it("resolves qualified values, constructors, types and fields across modules", async () => {
    const [a, n, moved] = await evalMoss(
      `
let a = Shapes.area (Shapes.Rect (2.0, 3.0))
let n = match Shapes.Circle 1.0 with Shapes.Circle _ -> 1 | Shapes.Rect _ -> 2
let move (p : Shapes.point) = { p with x = p.x + 1 }
let moved = (move Shapes.origin).x
`,
      { Shapes: SHAPES },
      ["a", "n", "moved"],
    );
    expect([a, n, moved]).toEqual([6, 1, 1]);
  });

  it("open brings a module's names into scope", async () => {
    const [p] = await evalMoss(`open Shapes\nlet p = { x = 3; y = 4 }`, { Shapes: SHAPES }, ["p"]);
    expect(p).toEqual({ x: 3, y: 4 });
  });

  it("loads dependencies transitively and in order", async () => {
    const [v] = await evalMoss("let v = B.twice 5", { A: "let inc x = x + 1", B: "let twice x = A.inc (A.inc x)" }, ["v"]);
    expect(v).toBe(7);
  });

  it("checks exhaustiveness with constructors from another module", () => {
    const err = errorOf("let f s = match s with Shapes.Circle _ -> 1", { Shapes: SHAPES });
    expect(err).toContain("not exhaustive");
    expect(err).toContain("Shapes.Rect _");
  });

  it("reports unknown modules, unknown members and cycles", () => {
    expect(errorOf("let x = Nope.x")).toContain("unknown module 'Nope' (no nope.moss found)");
    expect(errorOf("let x = Shapes.nope", { Shapes: SHAPES })).toContain("module 'Shapes' has no value 'nope'");
    expect(errorOf("let x = A.a", { A: "let a = B.b", B: "let b = A.a" })).toContain("cycle: A -> B -> A");
  });

  it("lets a project module shadow a standard library module", async () => {
    const [v] = await evalMoss("let v = List.answer", { List: "let answer = 42" }, ["v"]);
    expect(v).toBe(42);
  });

  it("requires main to be a unit effect", () => {
    expect(errorOf('let main = "hello"')).toContain("'main' has type string but an expression was expected of type unit effect");
  });

  it("prints types from the current module unqualified and others qualified", () => {
    const err = errorOf("type t = A\nlet x = (Shapes.origin : t)", { Shapes: SHAPES });
    expect(err).toContain("has type Shapes.point but an expression was expected of type t");
  });
});

describe("standard library", () => {
  it("embeds every stdlib/*.moss file (run scripts/gen-stdlib.mjs after editing)", () => {
    const dir = join(root, "stdlib");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".moss"))) {
      const name = f.charAt(0).toUpperCase() + f.slice(1, -5);
      expect(STDLIB[name], f).toBe(readFileSync(join(dir, f), "utf8"));
    }
    expect(Object.keys(STDLIB).length).toBe(readdirSync(dir).filter((f) => f.endsWith(".moss")).length);
  });
});

describe("moss run", () => {
  it("runs a multi-module program's main and waits for its tasks", () => {
    const out = execFileSync("node", [join(root, "bin/moss.js"), "run", "examples/hello/hello.moss"], { cwd: root, encoding: "utf8" });
    expect(out).toBe(
      [
        "circle of radius 1: area 3.14",
        "2 x 3 rectangle: area 6.00",
        "circle of radius 0.5: area 0.79",
        "total area: 9.93",
        "fib 20 = 6765",
        "done waiting",
        "",
      ].join("\n"),
    );
  });
});
