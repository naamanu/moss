import { describe, expect, it } from "vitest";
import { MossError, check, compile, formatError } from "../src/compiler/compile.ts";
import { parse } from "../src/compiler/parser.ts";
import { showType } from "../src/compiler/types.ts";

/** Type of a top-level binding, as printed by the checker. */
function typeOf(src: string, name: string): string {
  const c = check(src, "t.moss");
  const d = c.program.decls.find((d) => d.d === "let" && d.name === name);
  if (!d || d.d !== "let") throw new Error("no decl");
  return showType(d.body.ty!);
}

function errorOf(src: string): string {
  try {
    check(src, "t.moss");
  } catch (e) {
    if (e instanceof MossError) return formatError(e);
    throw e;
  }
  throw new Error("expected a type error");
}

describe("parser", () => {
  it("parses precedence like OCaml", () => {
    const p = parse("let x = 1 + 2 * 3 :: [] |> List.length", "t");
    const d = p.decls[0]!;
    expect(d.d).toBe("let");
    if (d.d !== "let") return;
    // `|>` binds loosest and becomes an application.
    expect(d.body.e).toBe("app");
  });

  it("parses constructors as arguments without consuming the next argument", () => {
    const p = parse("let x = f None 1", "t");
    const d = p.decls[0]!;
    if (d.d !== "let" || d.body.e !== "app") throw new Error("bad parse");
    expect(d.body.args.length).toBe(2);
  });

  it("reports syntax errors with a caret", () => {
    try {
      parse("let x = (1 + \n", "t.moss");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MossError);
    }
  });
});

describe("type checker", () => {
  it("infers polymorphic types with let-generalization", () => {
    expect(typeOf("let pair = let id = fun x -> x in (id 1, id true)", "pair")).toBe("int * bool");
    expect(typeOf("let xs = List.map (fun x -> x + 1) [1; 2]", "xs")).toBe("int list");
  });

  it("types let+ and let* in the Bonsai discipline", () => {
    expect(typeOf("let c = let* n, set = state 0 in let+ n = n in n + 1", "c")).toBe("int comp");
    expect(typeOf("let c = let* s = state \"x\" in return s", "c")).toBe("(string * (string -> unit effect)) comp");
  });

  it("rejects reading a val in pure code", () => {
    const err = errorOf(`
component bad =
  let* n, set = state 0 in
  let+ s = set in
  text (show n)
`);
    expect(err).toContain("has type int val but an expression was expected of type int");
    expect(err).toContain("hint: a 'val' can only be read inside 'let+");
    expect(err).toContain("t.moss:5:14");
  });

  it("rejects using a computation where a val is needed", () => {
    const err = errorOf(`
component bad =
  let+ n = state 0 in
  text "x"
`);
    expect(err).toContain("let*");
  });

  it("requires components to be computations", () => {
    expect(errorOf("component c = text \"hi\"")).toContain("A component has type html");
  });

  it("checks records, variants and exhaustive fields", () => {
    expect(errorOf("type r = { a : int; b : string }\nlet x = { a = 1 }")).toContain("missing field(s) b");
    expect(errorOf("type t = A | B of int\nlet x = B")).toContain("expects an argument");
    expect(typeOf("type t = A | B of int\nlet f x = match x with A -> 0 | B n -> n\nlet y = f (B 2)", "y")).toBe("int");
  });

  it("rejects unbound names", () => {
    expect(errorOf("let x = y + 1")).toContain("unbound variable 'y'");
  });
});

describe("codegen", () => {
  async function run(src: string): Promise<any> {
    const js = compile(`${src}\napp (return (const (text "")))`, "t.moss", { runtimeImport: "../src/runtime/index.ts" });
    // Evaluate the module body with the runtime injected.
    const R = await import("../src/runtime/index.ts");
    const body = js.replace(/^import .*$/m, "").replace(/^export const main = .*$/m, "");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("R", `${body}\nreturn { ${[...src.matchAll(/^let (?:rec )?(\w+)/gm)].map((m) => `${m[1]}: $${m[1]}`).join(", ")} };`)(R);
  }

  it("compiles pure functions, matches and recursion", async () => {
    const m = await run(`
let rec fact n = if n <= 1 then 1 else n * fact (n - 1)
let rec sum xs = match xs with [] -> 0 | x :: rest -> x + sum rest
let add a b = a + b
let inc = add 1
let total = List.fold add 0 [1; 2; 3]
let classify n = match n with 0 -> "zero" | n when n < 0 -> "neg" | _ -> "pos"
let tup = let (a, b) = (1, 2) in a * 10 + b
let s = String.concat ", " (List.map show (List.range 0 4))
let eqs = ([1; 2] = [1; 2], (1, "a") <> (1, "b"), Some 3 = Some 3)
`);
    expect(m.fact(5)).toBe(120);
    expect(m.sum({ h: 1, t: { h: 2, t: null } })).toBe(3);
    expect(m.inc(41)).toBe(42);
    expect(m.total).toBe(6);
    expect([m.classify(0), m.classify(-3), m.classify(9)]).toEqual(["zero", "neg", "pos"]);
    expect(m.tup).toBe(12);
    expect(m.s).toBe("0, 1, 2, 3");
    expect(m.eqs).toEqual([true, true, true]);
  });

  it("integer division truncates and float ops are separate", async () => {
    const m = await run(`let a = 7 / 2\nlet b = 7.0 /. 2.0\nlet c = -7 / 2`);
    expect([m.a, m.b, m.c]).toEqual([3, 3.5, -3]);
  });
});

describe("exhaustiveness", () => {
  const warnings = (src: string) => check(src, "t.moss").warnings.map((w) => formatError(w, "warning"));
  const ok = (src: string) => expect(() => check(src, "t.moss")).not.toThrow();
  const T = "type shape = Circle of float | Rect of float * float | Empty\n";

  it("reports a missing constructor with an example", () => {
    const err = errorOf(T + "let area s = match s with Circle r -> r | Rect (w, h) -> w *. h");
    expect(err).toContain("This match is not exhaustive");
    expect(err).toContain("\n  Empty");
  });

  it("accepts complete matches, including nested and wildcard ones", () => {
    ok(T + "let f s = match s with Circle _ -> 1 | Rect _ -> 2 | Empty -> 3");
    ok(T + "let f s = match s with Empty -> 0 | _ -> 1");
    ok("let f o = match o with (Some true, _) -> 1 | (Some false, _) -> 2 | (None, x) -> x");
    ok("let rec len xs = match xs with [] -> 0 | _ :: t -> 1 + len t");
    ok("let f b = match b with true -> 1 | false -> 0");
    ok("let f u = match u with () -> 1");
  });

  it("finds missing cases in nested patterns", () => {
    expect(errorOf("let f o = match o with Some (Some x) -> x | None -> 0")).toContain("Some None");
    expect(errorOf("let f xs = match xs with [] -> 0 | [x] -> x")).toContain("_ :: _ :: _");
    expect(errorOf("let f p = match p with (true, _) -> 1 | (_, false) -> 2")).toContain("(false, true)");
  });

  it("needs a catch-all for literals", () => {
    expect(errorOf("let f n = match n with 0 -> \"zero\" | 1 -> \"one\"")).toContain("\n  2");
    expect(errorOf("let f s = match s with \"a\" -> 1")).toContain("\n  _");
    ok("let f n = match n with 0 -> \"zero\" | _ -> \"many\"");
  });

  it("ignores guarded cases when deciding coverage", () => {
    expect(errorOf("let f n = match n with x when x > 0 -> 1")).toContain("not exhaustive");
    ok("let f n = match n with x when x > 0 -> 1 | _ -> 0");
  });

  it("warns about unused cases", () => {
    const ws = warnings(T + "let f s = match s with _ -> 0 | Empty -> 1");
    expect(ws).toHaveLength(1);
    expect(ws[0]).toContain("warning: this case is unused");
    expect(warnings("let f o = match o with Some _ -> 1 | None -> 2 | Some 3 -> 3")).toHaveLength(1);
    expect(warnings(T + "let f s = match s with Circle _ -> 1 | Rect _ -> 2 | Empty -> 3")).toHaveLength(0);
  });

  it("checks match* too", () => {
    const err = errorOf(`
type mode = View | Edit | Hidden
component c (m : mode val) =
  match* m with
  | View -> return (const (text "v"))
  | Edit -> return (const (text "e"))
`);
    expect(err).toContain("This 'match*' is not exhaustive");
    expect(err).toContain("Hidden");
  });

  it("rejects refutable patterns in let, fun and let+", () => {
    expect(errorOf("let f o = let (Some x) = o in x")).toContain("can fail to match (e.g. None)");
    expect(errorOf("let f = fun [x] -> x")).toContain("can fail to match");
    expect(errorOf("let g (Some x) = x")).toContain("can fail to match");
    ok("let f p = let (a, (b, _)) = p in a + b");
  });
});
