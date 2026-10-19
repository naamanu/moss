# Moss

A small, statically typed functional language for fast browser UIs, modeled on
Jane Street's [Bonsai](https://github.com/janestreet/bonsai).

An app is a **static graph of incremental computations**. State lives inside
the graph, and each frame recomputes only the nodes whose inputs changed.
Unchanged parts of the UI produce *the same* virtual-DOM objects, so the DOM
diff skips them in O(1).

```ocaml
component counter =
  let* count, set = state 0 in
  let+ c = count and set = set in
  div [class_ "counter"] [
    button [on_click (set (c - 1))] [text "-"];
    span [] [text (show c)];
    button [on_click (set (c + 1))] [text "+"]
  ]

app counter
```

## Quick start

```sh
npm install
node bin/moss.js dev examples/table.moss      # http://localhost:5173  (add ?debug for frame timings)
node bin/moss.js build examples/todo.moss -o dist/todo
node bin/moss.js check examples/counter.moss
npm test
```

A `foo.css` file next to `foo.moss` is inlined into the generated page.

## The model

There are two special type constructors:

| type      | meaning                                                                    |
|-----------|----------------------------------------------------------------------------|
| `'a val`  | a node in the incremental graph: a value that changes over time            |
| `'a comp` | a *computation*: a description of graph structure (it may allocate state) that yields an `'a val` when instantiated |

There are three binding forms:

- `let* x = c in body` (Bonsai's `let%sub`): instantiate computation
  `c : 'a comp` and bind its result as `x : 'a val`. Tuple patterns project
  into separate vals: `let* count, set = state 0 in ...`
- `let+ x = v1 and y = v2 in e` (Bonsai's `let%arr`): read vals as plain
  values inside pure code. The whole form is a `'b comp`, compiled to a single
  map node with an equality cutoff.
- `match* v with | A -> c1 | B x -> c2` switches between computations based
  on a val. Pattern variables are bound as vals. Each branch is instantiated
  once, so **inactive branches keep their state**.

Pure code can never read a `val` directly; the only way in is `let+`. This
is enforced by the type checker, so the graph's shape is static by
construction:

```
error: This expression has type int val but an expression was expected of type int
  hint: a 'val' can only be read inside 'let+ x = ... in ...'
```

### Primitives

| name | type |
|---|---|
| `state` | `'a -> ('a * ('a -> unit effect)) comp` |
| `state_machine` | `'m -> ('m -> 'act -> 'm) -> ('m * ('act -> unit effect)) comp` |
| `assoc` | `('k, 'v) map val -> ('k -> 'v val -> 'r comp) -> ('k, 'r) map comp` |
| `return` / `const` | `'a val -> 'a comp` / `'a -> 'a val` |
| `every` | `int -> unit effect val -> unit comp` (a timer) |

`assoc` is the key to large lists. It instantiates one sub-graph per key, and
it diffs its input map in O(changes · log n) because Moss maps are persistent
AVL trees whose `symmetricDiff` skips shared subtrees. Each key's sub-graph can
have its own local state (see the "expanded" toggle in `examples/table.moss`).

Effects (`unit effect`) are inert values. Setters and dispatchers return them,
and event attributes (`on_click`, `on_input`, `on_enter`, …) take them. All
writes made during a frame are batched into one stabilization per
`requestAnimationFrame`.

> Handlers capture the values from the render that created them, as in
> Bonsai. Two events that arrive before the next frame both see the
> same (old) values. Use `state_machine`, whose actions are applied to the
> latest model, when that matters.

## The language

The syntax is ML-style: `let`/`let rec`/`in`, `fun x -> e`, `match ... with`,
`if ... then ... else`, tuples, lists `[a; b]`, `::`, `@`, `|>`, records
`{ a = 1; b = "x" }`, `{ r with a = 2 }`, `r.a`, and variants
`type t = A | B of int * string`. Integers and floats use separate operators
(`+` vs `+.`), as in OCaml. `^` concatenates strings. `=` is structural
equality.

Typing is Hindley–Milner with let-polymorphism, records, variants and
parameterized types (`'a option`, `('k, 'v) map`). Type annotations are
optional: `(x : todo val)`.

Pattern matching is checked for exhaustiveness: a `match` or `match*` that can
miss a value is a compile error that shows an example of the missing value.
Patterns in `let`, `fun` and `let+` must match every value of their type, and
a case that can never be reached is a warning.

Top-level declarations are `type`, `let`, `component` (a `let` whose body must
be a `comp`), `external` (binds a JS runtime function to a type), and `app`.
The prelude is in `src/compiler/prelude.ts`.

## Layout

```
src/compiler/   lexer, parser (Pratt), typecheck (HM, levels), codegen (typed AST -> ES module)
src/runtime/    incr.ts      height-ordered incremental engine with cutoffs and observers
                pmap.ts      persistent AVL map with symmetric diff
                comp.ts      computations: sub/arr/state/state_machine/assoc/match*/every
                vdom.ts      keyed virtual DOM with identity short-circuit
                prelude.ts   builtins (List, Map, String, Html, Attr, Effect)
src/cli.ts      check / build (esbuild bundle) / dev (live reload)
examples/       counter, todo (TodoMVC-style), table (10k live rows)
```

## Performance

`examples/table.moss` has 10,000 rows, and a timer moves 50 random prices on
every frame. Measured in Chrome on the dev build, per frame:

- About 109 graph nodes recomputed (each row owns several nodes, so the graph has tens of thousands).
- Stabilize ≈ 0.5 ms and patch ≈ 0.2 ms (p50). Total JS ≈ 0.7 ms at p50 and
  ≈ 0.9 ms at p90.
- The page holds 60 fps.

The rows are CSS-grid `div`s with `content-visibility: auto`. A real `<table>`
forced Chrome to lay out all 10k rows on every change (~60 ms), which was far
more than the cost of Moss itself.

## Not yet done

- `every` timers are never cleared, even inside an inactive `match*` branch.
- There is no IR/optimizer pass yet. Codegen works directly from the typed AST.
- `Map.filter`/`Map.map` are O(n). An incremental-map library (like
  `Incr_map`) would make filtered views O(changes) too.
