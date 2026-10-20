// Regression tests for four bugs found in review: each was a program the
// compiler accepted (or rejected) inconsistently with the language's rules.
import { describe, expect, it } from "vitest";
import { type Loader, MossError, check, compile, formatError } from "../src/compiler/compile.ts";

const project = (files: Record<string, string>): Loader => (m) =>
  files[m] === undefined ? undefined : { file: `${m.toLowerCase()}.moss`, source: files[m]! };

async function evalMoss(src: string, names: string[], files: Record<string, string> = {}): Promise<unknown[]> {
  const R = await import("../src/runtime/index.ts");
  const js = compile(src, "t.moss", { loader: project(files) });
  const body = js.replace(/^import .*$/m, "").replace(/^export /gm, "");
  return new Function("R", `${body}\nreturn [${names.map((n) => `$T_${n}`).join(", ")}];`)(R);
}

function errorOf(src: string, files: Record<string, string> = {}): string {
  try {
    compile(src, "t.moss", { loader: project(files) });
  } catch (e) {
    if (e instanceof MossError) return formatError(e);
    throw e;
  }
  throw new Error("expected an error");
}

describe("externals use the arity of their resolved type", () => {
  it("calls an external whose type is an alias", async () => {
    expect(await evalMoss('type f = int -> int -> int\nexternal max : f = "Int_max"\nlet x = max 1 2', ["x"])).toEqual([2]);
  });

  it("checks the arity of an aliased external against the runtime", () => {
    expect(errorOf('type f = int -> int -> int -> int\nexternal m : f = "Int_max"')).toContain("type takes 3 argument(s) but runtime");
  });
});

describe("let* means ( let* ) value (fun pattern -> body) unless the operator declares a projection", () => {
  it("checks the pattern against what the continuation really receives", () => {
    const err = errorOf("let ( let* ) o f = match o with Some x -> f (x + 1) | None -> None\nlet x = let* () = Some 1 in Some 2");
    expect(err).toContain("This pattern has type unit but an expression was expected of type int");
  });

  it("matches any pattern for an operator without [@@project_with], whatever its types", async () => {
    const src = `
type pair = P of int * int
let ( let* ) (p : pair) (f : pair -> int) = f p
let r = let* P (a, b) = P (1, 2) in a + b`;
    expect(await evalMoss(src, ["r"])).toEqual([3]);
  });

  it("projects tuple patterns only for an operator that declares it", () => {
    const lib = (attr: string) => `
type 'a w [@@opaque]
type 'a m [@@opaque]
external ( let* ) : 'a m -> ('a w -> 'b m) -> 'b m = "x" ${attr}
external ( let+ ) : 'a w -> ('a -> 'b) -> 'b m = "y"
external ( and+ ) : 'a w -> 'b w -> ('a * 'b) w = "z"
external pair : (int * string) m = "p"
let c = let* (n, s) = pair in let+ n = n and+ s = s in (n, s)`;
    expect(() => check(lib('[@@project_with "let+"]'), "t.moss")).not.toThrow();
    // Without the declaration the tuple pattern is matched against `(int * string) w`: a type error.
    expect(() => check(lib(""), "t.moss")).toThrow("This pattern has type");
  });

  it("rejects a [@@project_with] that doesn't name a binding operator", () => {
    expect(() =>
      check('type \'a m\nexternal ( let* ) : \'a m -> (\'a -> \'b m) -> \'b m = "x" [@@project_with "map"]\nexternal p : (int * int) m = "y"\nlet c = let* (a, b) = p in p', "t.moss"),
    ).toThrow("[@@project_with] must name a binding operator");
  });
});

describe("type definitions keep the names of the module that declared them", () => {
  const A = "type item = int\ntype items = item list";

  it("expands an alias from another module", async () => {
    expect(await evalMoss("let x = ([1] : A.items)", ["x"], { A })).toEqual([{ h: 1, t: null }]);
  });

  it("resolves constructor payloads and record fields written with an opened module's types", async () => {
    const B = "open A\ntype box = Box of item\ntype r = { v : items }\nlet mk xs = { v = xs }";
    // `(B.mk [2]).v` is typed through the field's declared type, `items`.
    const [n, total] = await evalMoss("let n = match B.Box 1 with B.Box k -> k + 1\nlet total = List.fold (+) 0 (B.mk [2; 3]).v", ["n", "total"], {
      A,
      B,
    });
    expect([n, total]).toEqual([2, 5]);
  });

  it("still rejects cyclic abbreviations", () => {
    expect(errorOf("type t = t list")).toContain("type abbreviation 't' is cyclic");
  });
});

describe("structural equality doesn't depend on sharing", () => {
  it("compares a shared value containing nan like a copy", async () => {
    const src = "let nan = 0.0 /. 0.0\nlet p = (nan, 1)\nlet same = p = p\nlet copy = p = (nan, 1)\nlet m = Map.add 1 nan Map.empty\nlet map_same = m = m";
    expect(await evalMoss(src, ["same", "copy", "map_same"])).toEqual([false, false, false]);
  });

  it("raises for a shared value containing a function, for = and for compare", async () => {
    const eq = "let eq a b = a = b\nlet f y = y\nlet p = (f, 1)\nlet x = eq p p";
    await expect(evalMoss(eq, ["x"])).rejects.toThrow("equal: functional value");
    const lt = "let lt a b = a < b\nlet f y = y\nlet p = [(f, 1)]\nlet x = lt p p";
    await expect(evalMoss(lt, ["x"])).rejects.toThrow("compare: functional value");
  });

  it("keeps ordinary equality working", async () => {
    expect(await evalMoss("let p = (1, \"a\")\nlet x = (p = p, [1; 2] = [1; 2], Some 3 <> Some 4)", ["x"])).toEqual([[true, true, true]]);
  });
});

describe("binding metadata belongs to each declaration, not to its name", () => {
  it("keeps an external's arity when a later binding shadows its name", async () => {
    const src = 'external max : int -> int -> int = "Int_max"\nlet x = max 1 2\nlet max = 0\nlet y = max + 1';
    expect(await evalMoss(src, ["x", "y"])).toEqual([2, 1]);
  });

  it("checks each external against its own arity, even when shadowed by another external", () => {
    const src = 'external f : int -> int -> int -> int = "Int_max"\nexternal f : int -> int -> int = "Int_max"';
    expect(errorOf(src)).toContain("external 'f': type takes 3 argument(s)");
  });

  it("drops [@@project_with] when a plain definition replaces the operator", async () => {
    const src = `
type 'a m
external ( let* ) : 'a m -> ('a -> 'b m) -> 'b m = "Int_max" [@@project_with "let+"]
let ( let* ) o f = match o with Some x -> f x | None -> None
let r = let* (a, b) = Some (1, 2) in Some (a + b)`;
    // (The external is never called; "Int_max" just has the right arity.)
    expect(await evalMoss(src, ["r"])).toMatchObject([{ $: "Some", v: 3 }]);
  });
});

describe("structural equality and comparison on long values", () => {
  const LONG = "let p = List.range 0 20000\nlet q = List.range 0 20000";

  it("compares 20,000-element lists without overflowing the stack", async () => {
    const src = `${LONG}\nlet same = p = p\nlet copies = p = q\nlet le = p <= p\nlet lt = p < (List.range 0 20001)\nlet found = Map.mem p (Map.add q 1 Map.empty)`;
    expect(await evalMoss(src, ["same", "copies", "le", "lt", "found"])).toEqual([true, true, true, true, true]);
  });

  it("still finds nan and functions at the end of a long list", async () => {
    const nan = "let xs = List.map Float.of_int (List.range 0 20000) @ [0.0 /. 0.0]\nlet same = xs = xs";
    expect(await evalMoss(nan, ["same"])).toEqual([false]);
    const fn = "let eq a b = a = b\nlet f y = y\nlet fs = List.map (fun _ -> 1) (List.range 0 20000)\nlet x = eq (fs, f) (fs, f)";
    await expect(evalMoss(fn, ["x"])).rejects.toThrow("equal: functional value");
  });

  it("stops at the first difference, before values it doesn't need to inspect", async () => {
    // The lists differ at the first element, so the function after them is never reached.
    expect(await evalMoss("let eq a b = a = b\nlet f y = y\nlet x = eq ([1; 2], f) ([9; 2], f)", ["x"])).toEqual([false]);
  });
});
