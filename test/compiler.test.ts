import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { type Loader, MossError, check, compile, formatError } from "../src/compiler/compile.ts";
import { parse } from "../src/compiler/parser.ts";
import { showType } from "../src/compiler/types.ts";

const UI = readFileSync(new URL("./fixtures/ui.moss", import.meta.url), "utf8");
/** Makes the test-double UI library (fixtures/ui.moss) available as module `Ui`. */
const withUi: Loader = (m) => (m === "Ui" ? { file: "ui.moss", source: UI } : undefined);

/** Type of a top-level binding, as printed by the checker. */
function typeOf(src: string, name: string): string {
  const c = check(src, "t.moss", withUi);
  const d = c.program.decls.find((d) => d.d === "let" && d.name === name);
  if (!d || d.d !== "let") throw new Error("no decl");
  return showType(d.body.ty!);
}

function errorOf(src: string): string {
  try {
    check(src, "t.moss", withUi);
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
    expect(typeOf("open Ui let c = let* n, set = state 0 in let+ n = n in n + 1", "c")).toBe("int comp");
    expect(typeOf("open Ui let c = let* s = state \"x\" in return s", "c")).toBe("(string * (string -> unit effect)) comp");
  });

  it("rejects reading a val in pure code", () => {
    const err = errorOf(`open Ui
let bad =
  let* n, set = state 0 in
  let+ s = set in
  text (show n)
`);
    expect(err).toContain("has type int val but an expression was expected of type int");
    expect(err).toContain("hint: a 'val' can only be read inside 'let+");
    expect(err).toContain("t.moss:5:14");
  });

  it("rejects using a computation where a val is needed", () => {
    const err = errorOf(`open Ui
let bad =
  let+ n = state 0 in
  text "x"
`);
    expect(err).toContain("let*");
  });

  it("takes error hints from type attributes", () => {
    // `start` expects an `html comp`; the hint comes from `comp`'s [@@hint_expected].
    expect(errorOf('open Ui let main = start (text "hi")')).toContain(
      "hint: wrap a pure result with 'let+' (or 'return (const x)') to make a computation",
    );
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
    const js = compile(`${src}`, "t.moss", { runtimeImport: "../src/runtime/index.ts" });
    // Evaluate the module body with the runtime injected.
    const R = await import("../src/runtime/index.ts");
    const body = js.replace(/^import .*$/m, "").replace(/^export /gm, "");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("R", `${body}\nreturn { ${[...src.matchAll(/^let (?:rec )?(\w+)/gm)].map((m) => `${m[1]}: $T_${m[1]}`).join(", ")} };`)(R);
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
    const err = errorOf(`open Ui
type mode = View | Edit | Hidden
let c (m : mode val) =
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

describe("accepted programs behave consistently", () => {
  /** Compile `src`, evaluate it, and return top-level values by name (or the thrown message). */
  async function evalMoss(src: string, names: string[]): Promise<any[] | string> {
    const R = await import("../src/runtime/index.ts");
    const js = compile(`${src}`, "t.moss");
    const body = js.replace(/^import .*$/m, "").replace(/^export /gm, "");
    try {
      return new Function("R", `${body}\nreturn [${names.map((n) => `$T_${n}`).join(", ")}];`)(R);
    } catch (e) {
      return (e as Error).message;
    }
  }

  it("lets a user type reuse prelude constructor names", async () => {
    expect(await evalMoss("type t = None | Some of int\nlet x = match Some 3 with None -> 0 | Some n -> n", ["x"])).toEqual([3]);
  });

  it("orders variants and records by declaration, not by name", async () => {
    const [lt, keys, rec] = (await evalMoss(
      `type size = Small | Medium | Large
type r = { b : int; a : int }
let lt = Small < Large
let keys = Map.keys (Map.of_list [(Large, 1); (Small, 2); (Medium, 3)])
let rec_lt = { a = 2; b = 1 } < { a = 1; b = 2 }`,
      ["lt", "keys", "rec_lt"],
    )) as any[];
    expect(lt).toBe(true);
    expect([keys.h.$, keys.t.h.$, keys.t.t.h.$]).toEqual(["Small", "Medium", "Large"]);
    expect(rec).toBe(true);
  });

  it("treats nan the same in primitive and structural equality", async () => {
    expect(await evalMoss("let nan = 0.0 /. 0.0\nlet a = nan = nan\nlet b = (nan, 1) = (nan, 1)", ["a", "b"])).toEqual([false, false]);
  });

  it("raises Division_by_zero instead of producing a non-integer", async () => {
    expect(await evalMoss("let d = 7 / 0", ["d"])).toBe("Division_by_zero");
    expect(await evalMoss("let d = 7 mod (3 - 3)", ["d"])).toBe("Division_by_zero");
    expect(await evalMoss("let d = (-7) / 2\nlet m = (-7) mod 2", ["d", "m"])).toEqual([-3, -1]);
  });

  it("rejects comparing functions and opaque values at compile time", () => {
    expect(errorOf("let f x = x + 1\nlet same = f = f")).toContain("'=' can't compare values of type int -> int: it contains functions");
    expect(errorOf("type r = { e : unit effect }\nlet same = { e = Effect.none } = { e = Effect.none }")).toContain(
      "contains values of type 'effect' (inside 'r')",
    );
    expect(errorOf("let x = (fun a -> a) < (fun a -> a)")).toContain("'<' can't compare");
    // Physical equality is allowed on anything.
    expect(() => check("let f x = x\nlet same = f == f", "t.moss")).not.toThrow();
  });

  it("raises at runtime when polymorphic code compares functions", async () => {
    expect(await evalMoss("let eq a b = a = b\nlet f x = x\nlet same = eq f f", ["same"])).toBe("equal: functional value");
  });

  it("rejects programs that used to crash the compiler or generate broken code", () => {
    expect(errorOf("let rec xs = 1 :: xs")).toContain("'let rec' must define a function");
    expect(errorOf("type t = t list")).toContain("type abbreviation 't' is cyclic");
    expect(errorOf('let s = "a\\qb"')).toContain("unknown escape '\\q'");
    expect(errorOf("let n = 9007199254740993")).toContain("too large");
  });

  it("checks externals against the runtime", () => {
    const err = (src: string) => {
      try {
        compile(src, "t.moss");
      } catch (e) {
        return (e as Error).message;
      }
      return "no error";
    };
    expect(err('external nope : int -> int = "does_not_exist"')).toContain('no export named "does_not_exist"');
    expect(err('external add3 : int -> int -> int -> int = "Int_max"')).toContain("takes 3 argument(s) but runtime");
  });

  it("builds runtime variants with the prelude's constructor indices", async () => {
    const R = await import("../src/runtime/index.ts");
    const prelude = check("", "t.moss").program.decls;
    const index = (ctor: string) => {
      for (const d of prelude) {
        if (d.d === "type" && d.def.kind === "variant") {
          const i = d.def.ctors.findIndex((c) => c.name === ctor);
          if (i >= 0) return i;
        }
      }
      throw new Error(ctor);
    };
    const built: [string, { $: string; i: number }][] = [
      ["None", R.None],
      ["Some", R.Some(1)],
      ["Loading", R.Loading],
      ["Loaded", R.Loaded(1)],
      ["Failed", R.Failed("x")],
    ];
    for (const [name, v] of built) {
      expect(v.$).toBe(name);
      expect(v.i).toBe(index(name));
    }
  });
});

describe("binding operators", () => {
  async function evalMoss(src: string, names: string[]): Promise<any[]> {
    const R = await import("../src/runtime/index.ts");
    const js = compile(`${src}`, "t.moss");
    const body = js.replace(/^import .*$/m, "").replace(/^export /gm, "");
    return new Function("R", `${body}\nreturn [${names.map((n) => `$T_${n}`).join(", ")}];`)(R);
  }

  it("lets user code define let*/and*/let+/and+ (an option monad)", async () => {
    const [r1, r2, prod, ap] = await evalMoss(
      `
let ( let* ) o f = match o with Some x -> f x | None -> None
let ( and* ) a b = match (a, b) with (Some x, Some y) -> Some (x, y) | _ -> None
let ( let+ ) o f = match o with Some x -> Some (f x) | None -> None
let ( and+ ) a b = ( and* ) a b
let sum a b = let* x = a and* y = b in Some (x + y)
let r1 = sum (Some 1) (Some 2)
let r2 = sum (Some 1) None
let prod = let+ x = Some 4 and+ y = Some 5 and+ z = Some 2 in x * y * z
let ap = ( let+ ) (Some 20) (fun x -> x + 1)
`,
      ["r1", "r2", "prod", "ap"],
    );
    expect(r1).toMatchObject({ $: "Some", v: 3 });
    expect(r2).toMatchObject({ $: "None" });
    expect(prod).toMatchObject({ $: "Some", v: 40 });
    expect(ap).toMatchObject({ $: "Some", v: 21 });
  });

  it("types and* over computations", () => {
    expect(
      typeOf(
        "open Ui let c = let* a = state 1 and* b = state \"x\" in let+ (n, _) = a and+ (s, _) = b in show n ^ s",
        "c",
      ),
    ).toBe("string comp");
  });

  it("reports match* diagnostics once, under its own name", () => {
    expect(errorOf("open Ui type m = A | B | C\nlet f (v : m val) = match* v with A -> return (const 1) | B -> return (const 2)")).toContain(
      "This 'match*' is not exhaustive",
    );
    const ws = check("open Ui type m = A | B\nlet f (v : m val) = match* v with _ -> return (const 1) | A -> return (const 2)", "t.moss", withUi).warnings;
    expect(ws).toHaveLength(1);
  });

});
