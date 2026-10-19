// Rhizoid's typing discipline, checked against the real package: its types,
// binding operators and the hints its type attributes provide.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MossError, check, formatError } from "../../src/compiler/compile.ts";
import { projectLoader } from "../../src/node.ts";

// A (virtual) file in the examples directory: its project is rhizoid/.
const file = resolve(dirname(fileURLToPath(import.meta.url)), "../examples/t.moss");

function errorOf(src: string): string {
  try {
    check(`open Rhizoid ${src}`, file, projectLoader(file));
  } catch (e) {
    if (e instanceof MossError) return formatError(e);
    throw e;
  }
  throw new Error("expected an error");
}

describe("Rhizoid typing", () => {
  it("accepts the canonical counter", () => {
    expect(() =>
      check(
        `open Rhizoid
let counter =
  let* count, set = state 0 in
  let+ c = count and set = set in
  button [on_click (set (c + 1))] [text (show c)]
let main = start counter`,
        file,
        projectLoader(file),
      ),
    ).not.toThrow();
  });

  it("won't let pure code read a val, and says how to", () => {
    const err = errorOf("let bad = let* n, set = state 0 in let+ s = set in text (show n)");
    expect(err).toContain("has type int val but an expression was expected of type int");
    expect(err).toContain("hint: a 'val' can only be read inside 'let+ x = ... in ...'");
  });

  it("suggests let* when a computation is used as a val", () => {
    expect(errorOf('let bad = let+ n = state 0 in text "x"')).toContain("hint: bind the computation first with 'let* x = ... in ...'");
  });

  it("suggests let+ when a plain value is used as a computation", () => {
    expect(errorOf('let main = start (text "hi")')).toContain("hint: wrap a pure result with 'let+'");
  });

  it("doesn't allow comparing vals or html", () => {
    expect(errorOf("let f (a : int val) (b : int val) = a = b")).toContain("can't compare values of type int val");
    expect(errorOf('let same = text "a" = text "a"')).toContain("can't compare values of type html");
  });

  it("checks match* exhaustiveness", () => {
    expect(errorOf("type m = A | B\nlet f (v : m val) = match* v with A -> return (const 1)")).toContain("This 'match*' is not exhaustive");
  });

  it("needs `open Rhizoid` (or qualified names) to use its operators", () => {
    expect(() => check("let c = let* x = Rhizoid.state 0 in Rhizoid.return x", file, projectLoader(file))).toThrow("unbound binding operator");
    expect(() => check("let c = Rhizoid.( let* ) (Rhizoid.state 0) Rhizoid.return", file, projectLoader(file))).not.toThrow();
  });
});
