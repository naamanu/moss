# Rhizoid

Incremental UIs for [Moss](../README.md), in the style of Jane Street's
[Bonsai](https://github.com/janestreet/bonsai). (Mosses don't have roots; they
anchor themselves with *rhizoids*.)

An app is a **static graph of incremental computations**. State lives inside
the graph, and each frame recomputes only the graph nodes whose inputs
changed. Unchanged parts of the UI produce *the same* virtual-DOM objects, so
the DOM diff skips each of them in O(1). Some steps are still linear in the
size of a list, though; see [Performance](#performance).

```ocaml
open Rhizoid

let counter =
  let* count, set = state 0 in
  let+ c = count and set = set in
  div [class_ "counter"] [
    button [on_click (set (c - 1))] [text "-"];
    span [] [text (show c)];
    button [on_click (set (c + 1))] [text "+"]
  ]

let main = start counter
```

## Quick start

From the repository root:

```sh
node bin/moss.js dev rhizoid/examples/table.moss    # http://localhost:5173  (add ?debug for frame timings)
node bin/moss.js build rhizoid/examples/todo.moss -o dist/todo
```

A Moss project uses Rhizoid by listing it in its `moss.json`:

```json
{ "dependencies": { "rhizoid": "../rhizoid" } }
```

A `foo.css` file next to `foo.moss` is inlined into the generated page.

## Layout

```
moss.json       package manifest: modules in src/, externals implemented by runtime/index.ts
src/            rhizoid.moss (types, binding operators, computations, html), html.moss
runtime/        incr.ts   height-ordered incremental engine with cutoffs and observers
                comp.ts   computations: state, state_machine, assoc, match*, every, resource
                vdom.ts   keyed virtual DOM with identity short-circuit
                html.ts   element and attribute builders
                index.ts  the app loop (one stabilization per animation frame)
examples/       counter, todo (TodoMVC-style), table (10k live rows), search (async)
test/           runtime, typing, and end-to-end example tests (jsdom)
```

## The model

Rhizoid defines two abstract types:

| type      | meaning                                                                    |
|-----------|----------------------------------------------------------------------------|
| `'a val`  | a node in the incremental graph: a value that changes over time            |
| `'a comp` | a *computation*: a description of graph structure (it may allocate state) that yields an `'a val` when instantiated |

There are three binding forms:

These are Moss binding operators (`( let* )`, `( let+ )`, `( and+ )`,
`( and* )`, `( match* )`) defined by Rhizoid, so they're available after
`open Rhizoid`:

- `let* x = c in body` (Bonsai's `let%sub`): instantiate computation
  `c : 'a comp` and bind its result as `x : 'a val`. Tuple patterns project
  into separate vals: `let* count, set = state 0 in ...`
- `let+ x = v1 and y = v2 in e` (Bonsai's `let%arr`): read vals as plain
  values inside pure code. The whole form is a `'b comp`, compiled to a single
  map node with an equality cutoff (a chain of `and+` doesn't create
  intermediate nodes).
- `match* v with | A -> c1 | B x -> c2` switches between computations based
  on a val. Pattern variables are bound as vals. Each branch is instantiated
  once, so **inactive branches keep their state**.

Pure code can never read a `val` directly; the only way in is `let+`.
`'a val` is an abstract type with no function that returns its contents, so
the type checker enforces this, and the graph's shape is static by
construction. Rhizoid's type attributes supply the hints:

```
error: This expression has type int val but an expression was expected of type int
  hint: a 'val' can only be read inside 'let+ x = ... in ...'
```

## Primitives

| name | type |
|---|---|
| `state` | `'a -> ('a * ('a -> unit effect)) comp` |
| `state_machine` | `'m -> ('m -> 'act -> 'm) -> ('m * ('act -> unit effect)) comp` |
| `assoc` | `('k, 'v) map val -> ('k -> 'v val -> 'r comp) -> ('k, 'r) map comp` |
| `return` / `const` | `'a val -> 'a comp` / `'a -> 'a val` |
| `every` | `int -> unit effect val -> unit comp`: a timer that runs only while its part of the app is active |
| `start` | `html comp -> unit effect`: mount the app on `#app` (`let main = start page`) |
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

## Async data

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
- **Tasks** come from the Moss standard library and are inert descriptions,
  like effects:
  - `Task.succeed`, `Task.fail`, `Task.map`, `Task.and_then`
  - `Task.sleep` (cancellable)
  - `Http.get_text` (fails on non-2xx responses)
  - `Task.attempt task k` runs a task from an event handler (e.g. a form
    submit) and passes its outcome to `k`. It is not cancellable.

A sleep before the request debounces typing, because each keystroke cancels
the pending sleep. `examples/search.moss` shows debouncing, out-of-order
responses, errors and cancel-on-hide.

## State lifetime

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
3. The DOM diff scans the children (`patchChildren` in `runtime/vdom.ts`).
   Unchanged rows are skipped by identity, but every row is still visited.

Each step costs a pointer comparison or an allocation per row, so it fits
in the numbers above, but it is linear in the list size, not the change.
Removing it needs a keyed-children vnode that holds the `assoc` output map
directly (see below).

## Not yet done

- Async is minimal. While a new key loads, a resource shows `Loading` rather
  than keeping the previous result visible.
- Large lists are rendered in O(n) per frame (see Performance). A keyed
  vnode that diffs old and new maps directly would make it O(changes · log n).
- `Map.filter`/`Map.map` are O(n). An incremental-map library (like
  `Incr_map`) would make filtered views O(changes) too.
