# Moss

A small, statically typed functional language for fast browser UIs, modeled on
Jane Street's [Bonsai](https://github.com/janestreet/bonsai).

An app is a **static graph of incremental computations**. State lives inside
the graph, and each frame recomputes only the graph nodes whose inputs
changed. Unchanged parts of the UI produce *the same* virtual-DOM objects, so
the DOM diff skips each of them in O(1). Some steps are still linear in the
size of a list, though; see [Performance](#performance).

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
| `every` | `int -> unit effect val -> unit comp`: a timer that runs only while its part of the app is active |
| `resource` | `'k val -> ('k -> 'a task) -> 'a remote comp`: async data for the current key (see below) |

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

### Async data

`resource key task` loads data for the current value of `key` and yields a
`'a remote` val:

```ocaml
type 'a remote = Loading | Loaded of 'a | Failed of string

let* results = resource query (fun q -> Http.get_text ("/search?q=" ^ q)) in
let+ r = results in
match r with
| Loading -> text "Searching…"
| Failed msg -> text ("Error: " ^ msg)
| Loaded body -> text body
```

- **Cancellation.** When `key` changes, the request for the old key is aborted
  (via `AbortSignal`) and a new one starts. The result switches to `Loading`
  in the same frame.
- **Stale responses.** A response that arrives after a newer request started
  is dropped, even if the old task ignored the abort.
- **Cleanup.** A resource follows the same lifetime rules as state (below).
  Leaving its `match*` branch or removing its `assoc` key aborts the request
  in flight. Coming back restarts it, unless it had already finished for the
  same key, in which case the result is reused.
- **Tasks** are inert descriptions, like effects:
  - `Task.succeed`, `Task.fail`, `Task.map`, `Task.and_then`
  - `Task.sleep` (cancellable)
  - `Http.get_text` (fails on non-2xx responses)
  - `Task.attempt task k` runs a task from an event handler (e.g. a form
    submit) and passes its outcome to `k`. It is not cancellable.

A sleep before the request debounces typing, because each keystroke cancels
the pending sleep. `examples/search.moss` shows debouncing, out-of-order
responses, errors and cancel-on-hide.

### State lifetime

Where a computation is instantiated decides how long its state lives:

| where the state is | it lives while | when it goes away |
|---|---|---|
| top level of the app | the app runs | never |
| a `match*` branch | the app runs; the branch is created the first time it's selected | never: an inactive branch **keeps** its state and gets it back when selected again |
| an `assoc` entry | its key is in assoc's **input map** | the key is removed; coming back later starts from fresh state |

Timers created with `every` and requests made by `resource` follow the same
scopes. They run only while their branch is selected or their key is present.

The `assoc` rule has a practical consequence. **Filter after `assoc`, not
before it**, if hidden items should keep their state. In
`examples/todo.moss` the filter is applied to the rendered rows, so a row
you're editing keeps its draft when the "Active" filter hides it. Filtering
the map before `assoc` would remove the key and discard that state.

## The language

The syntax is ML-style: `let`/`let rec`/`in`, `fun x -> e`, `match ... with`,
`if ... then ... else`, tuples, lists `[a; b]`, `::`, `@`, `|>`, records
`{ a = 1; b = "x" }`, `{ r with a = 2 }`, `r.a`, and variants
`type t = A | B of int * string`. Integers and floats use separate operators
(`+` vs `+.`), as in OCaml. `^` concatenates strings.

### Values and their semantics

- **Integers** are JavaScript numbers, exact up to 2^53 − 1. A larger
  literal is a compile error, and arithmetic beyond that range loses
  precision instead of wrapping. `/` truncates toward zero, and `mod` takes
  the sign of the dividend. Dividing by zero (`/` or `mod`) raises
  `Division_by_zero`.
- **Equality.** `=` and `<>` are structural. `==` is physical (identity).
  - Comparing values that contain functions or opaque values (`effect`,
    `val`, `comp`, `task`, `html`, `attr`) with `=` or `<` is a compile
    error when the type is known. When it's only known at runtime (inside
    polymorphic code), it raises `equal: functional value` (or
    `abstract value`, or `compare: …` for ordering).
  - `nan = nan` is `false`, and so is `(nan, 1) = (nan, 1)`.
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
  code) are thrown as JavaScript exceptions and abandon the current frame.
  The failing node keeps its last good value. Later frames run normally,
  and the failing node is recomputed when its inputs next change.
- **`external`** declarations are checked at compile time. The JS name must
  be a runtime export, and a function's arity must match its type.

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
                comp.ts      computations: sub/arr/state/state_machine/assoc/match*/every/resource
                task.ts      async tasks (sleep, HTTP) with AbortSignal cancellation
                vdom.ts      keyed virtual DOM with identity short-circuit
                prelude.ts   builtins (List, Map, String, Html, Attr, Effect)
src/cli.ts      check / build (esbuild bundle) / dev (live reload)
examples/       counter, todo (TodoMVC-style), table (10k live rows), search (async)
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

**What scales with the change, and what doesn't.** Graph work is proportional
to what changed: `assoc` diffs its input in O(changes · log n) and only
recomputes changed rows. Turning the rows into DOM children is still O(n) per
frame, in three cheap passes over all 10k rows:

1. `Map.values` builds the list of row views.
2. `el` copies that list into the vnode's children array.
3. The DOM diff scans the children (`patchChildren` in `src/runtime/vdom.ts`).
   Unchanged rows are skipped by identity, but every row is still visited.

Each step costs a pointer comparison or an allocation per row, so it fits
in the numbers above, but it is linear in the list size, not the change.
Removing it needs a keyed-children vnode that holds the `assoc` output map
directly (see below).

## Not yet done

- Async is minimal. While a new key loads, a resource shows `Loading` rather
  than keeping the previous result visible. There is no JSON decoding (only
  `Http.get_text`), only GET requests, and `Task.attempt` can't be
  cancelled.
- There is no IR/optimizer pass yet. Codegen works directly from the typed AST.
- Large lists are rendered in O(n) per frame (see Performance). A keyed
  vnode that diffs old and new maps directly would make it O(changes · log n).
- `Map.filter`/`Map.map` are O(n). An incremental-map library (like
  `Incr_map`) would make filtered views O(changes) too.
