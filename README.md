# Moss

A small, statically typed functional language in the ML family that compiles
to JavaScript. It has Hindley–Milner type inference, variants and records
with exhaustive pattern matching, modules, user-definable binding operators,
and effects and tasks as values.

```ocaml
type shape = Circle of float | Rect of float * float

let area s =
  match s with
  | Circle r -> 3.14159 *. r *. r
  | Rect (w, h) -> w *. h

let main =
  Effect.seq (List.map (fun s -> Effect.print (Float.fixed 2 (area s))) [Circle 1.0; Rect (2.0, 3.0)])
```

[Rhizoid](https://github.com/naamanu/rhizoid) is a library for incremental browser UIs written
for Moss, in the style of Jane Street's Bonsai.

## Quick start

```sh
npm install
node bin/moss.js run examples/hello/hello.moss      # run a program's `main` with Node
node bin/moss.js check examples/hello/hello.moss    # type-check only
npm test
```

## The language

The syntax is ML-style: `let`/`let rec`/`in`, `fun x -> e`, `match ... with`,
`if ... then ... else`, tuples, lists `[a; b]`, `::`, `@`, `|>`, records
`{ a = 1; b = "x" }`, `{ r with a = 2 }`, `r.a`, and variants
`type t = A | B of int * string`. Integers and floats use separate operators
(`+` vs `+.`), as in OCaml. `^` concatenates strings.

### Modules and programs

Each file is a module named after it: `todo_utils.moss` is `Todo_utils`.
A module's top-level values, types, constructors and record fields are
available to other modules by qualified name (`Geometry.area`,
`Geometry.shape`, `Geometry.Circle`), or unqualified after `open Geometry`.
A record's fields can always be read and updated when its type is known
(`p.x`, `{ p with x = 1 }`). Building a record literal needs its fields in
scope, through `open` or by being in the same module.

The compiler finds a module next to the file being compiled, then in the
project's packages (below), then in the standard library, so a project module
can shadow a library module. Modules are loaded in dependency order, and a
cycle between modules is an error.

The standard library lives in `stdlib/`:

- `Prelude` is opened implicitly in every module. It has the core types
  (`option`, `map`, `effect`, `task`, `remote`) and `show`, `not`, `fst`,
  `snd`, `id`.
- `List`, `Map`, `String`, `Int`, `Float`, `Random`, `Effect`, `Task` and
  `Http` are modules you use by name.

The compiler embeds the library (`scripts/gen-stdlib.mjs`, run by
`npm test`), so it needs no filesystem and can run in a browser.

A **program** is a module with `main : unit effect`. `moss run file.moss`
runs `main` with Node and waits for any tasks it started:

```ocaml
let main =
  Effect.seq [ Effect.print ("fib 20 = " ^ show (fib 20));
               Effect.print (Geometry.describe (Geometry.Circle 1.0)) ]
```

`moss build` and `moss dev` bundle a program for the browser instead
(`dev` serves it with live reload). A
[Rhizoid](https://github.com/naamanu/rhizoid) app is a program whose `main` mounts the UI:
`let main = start page`.

### Packages

A **package** is a directory with a `moss.json`:

```json
{
  "name": "rhizoid",
  "src": "src",
  "runtime": "runtime/index.ts",
  "dependencies": { "other": "../other" }
}
```

- `src`: where the package's modules are.
- `runtime`: the JavaScript module implementing the package's `external`s.
  Externals are checked against it at compile time (name and arity).
- `dependencies`: other packages, by path. Their modules become available to
  this one, transitively.

A file belongs to the project of the nearest `moss.json` above it.

### Binding operators

`let*`, `let+`, `and*`, `and+` and `match*` are not built into the compiler.
They call whatever `( let* )`, `( let+ )`, `( and* )`, `( and+ )` and
`( match* )` are in scope, as in OCaml (4.08 and later):

```ocaml
let+ p1 = e1 and+ p2 = e2 in body   (* ( let+ ) (( and+ ) e1 e2) (fun (p1, p2) -> body) *)
let* p = c in body                  (* ( let* ) c (fun p -> body) *)
let* p1 = c1 and* p2 = c2 in body   (* let* (p1, p2) = ( and* ) c1 c2 in body *)
```

Libraries define them: [Rhizoid](https://github.com/naamanu/rhizoid) defines them for
incremental UIs. Any code can define its own, for example an option monad:

```ocaml
let ( let* ) o f = match o with Some x -> f x | None -> None
let ( and* ) a b = match (a, b) with (Some x, Some y) -> Some (x, y) | _ -> None
let sum a b = let* x = a and* y = b in Some (x + y)
```

Two forms do more than a single call:

- **A tuple pattern on `let*`, for an operator that declares a projection.**
  A `( let* )` whose continuation receives a *wrapped* value (Rhizoid's
  `'a comp -> ('a val -> 'b comp) -> 'b comp`) can't have its argument taken
  apart by a pattern. Such an operator declares how to project instead:

  ```ocaml
  external ( let* ) : 'a comp -> ('a val -> 'b comp) -> 'b comp = "let_star" [@@project_with "let+"]
  ```

  Then `let* (a, b) = c in body` projects each variable into its own wrapped
  value with `let+`, which is what Bonsai's `let%sub` does. Without the
  declaration, every pattern is matched as in OCaml. The compiler never
  infers this from types.
- **`match* v with ...`** becomes a call to `( match* ) v index branch`.
  `index` maps a value to its case number. `branch i view` builds case `i`,
  and each of its pattern variables is projected out of `view` with `let+`
  and bound with `let*`.

A binding operator can also be named with a module: `Rhizoid.( let* )`.

### Values and their semantics

- **Integers** are JavaScript numbers, exact up to 2^53 − 1. A larger
  literal is a compile error, and arithmetic beyond that range loses
  precision instead of wrapping. `/` truncates toward zero, and `mod` takes
  the sign of the dividend. Dividing by zero (`/` or `mod`) raises
  `Division_by_zero`.
- **Equality.** `=` and `<>` are structural. `==` is physical (identity).
  - Comparing values that contain functions or values of an `[@@opaque]`
    type (`effect`, `task`, and library types such as Rhizoid's `val` or
    `html`) with `=` or `<` is a compile error when the type is known. When it's only known at runtime (inside
    polymorphic code), it raises `equal: functional value` (or
    `abstract value`, or `compare: …` for ordering).
  - `nan = nan` is `false`, and so is `(nan, 1) = (nan, 1)`.
  - The result never depends on whether two values are the same object:
    `let p = (nan, 1)` gives `p = p` → `false`, like a copy would.
- **Ordering.** `<`, `>`, `<=`, `>=` on numbers, strings and booleans are the
  usual ones. On other types, and for map keys, a total structural order is
  used:
  - variants by declaration order of their constructors, then payload;
  - records by their fields in declaration order;
  - tuples and lists element by element, with `[]` first;
  - `nan` before every other number.
- **Strings** support the escapes `\n`, `\t`, `\r`, `\"` and `\\`. Any other
  escape is a compile error.
- **Runtime errors** (`Division_by_zero`, comparing functions in polymorphic
  code) are thrown as JavaScript exceptions. (In a Rhizoid app this abandons
  the current frame; see its README.)
- **`external`** declarations are checked at compile time. The JS name must
  be an export of the runtime that implements the module (the core runtime,
  or the package's), and a function's arity must match its type.

Typing is Hindley–Milner with let-polymorphism, records, variants and
parameterized types (`'a option`, `('k, 'v) map`). Type annotations are
optional: `(x : int list)`.

Pattern matching is checked for exhaustiveness: a `match` or `match*` that can
miss a value is a compile error that shows an example of the missing value.
Patterns in `let`, `fun` and `let+` must match every value of their type, and
a case that can never be reached is a warning.

Top-level declarations are `type`, `let`, `external` (binds a runtime
function to a type) and `open`. The prelude is `stdlib/prelude.moss`.

### Type attributes

A type declaration can carry attributes, which is how libraries tell the
compiler things it doesn't know about their abstract types:

```ocaml
type 'a val [@@opaque] [@@hint_found "a 'val' can only be read inside 'let+ x = ... in ...'"]
```

- `[@@opaque]`: values of this type can't be compared with `=` or `<`.
- `[@@hint_found "..."]`: a hint added to type errors where a value of this
  type was used but a different type was expected.
- `[@@hint_expected "..."]`: a hint added when a different type was used
  where this one was expected. It takes precedence over `hint_found`.

An `external` can carry attributes too. The one the compiler knows is
`[@@project_with "let+"]` on a `( let* )`, described under
[Binding operators](#binding-operators).


## Layout

```
src/compiler/   lexer, parser (Pratt), desugar (binding operators), typecheck (HM, levels,
                modules, exhaustiveness), codegen (typed AST -> ES module), compile (module loading)
src/runtime/    the core runtime: stdlib externals (lists, maps, strings, ...), equality and
                comparison, effects, tasks (sleep, HTTP, AbortSignal cancellation)
src/node.ts     moss.json projects and packages for the CLI
src/cli.ts      run / check / build (esbuild bundle) / dev (live reload)
stdlib/         the standard library (Prelude, List, Map, String, ...), embedded into the compiler
examples/       hello/: a plain multi-module program
```

## Not yet done

- Async is minimal: no JSON decoding (only `Http.get_text`), only GET
  requests, and `Task.attempt` can't be cancelled.
- There is no IR/optimizer pass yet. Codegen works directly from the typed AST.
- Modules have no interfaces (everything at the top level is exported), and
  there are no nested modules or functors.
