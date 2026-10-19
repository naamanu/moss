// The Moss prelude: builtin types, externals implemented in
// src/runtime/prelude.ts / comp.ts, and small helpers written in Moss.

export const PRELUDE = String.raw`
type html
type attr
type 'a effect
type ('k, 'v) map
type 'a option = None | Some of 'a

(* ---- computations ---- *)
external state : 'a -> ('a * ('a -> unit effect)) comp = "state"
external state_machine : 'm -> ('m -> 'act -> 'm) -> ('m * ('act -> unit effect)) comp = "state_machine"
external assoc : ('k, 'v) map val -> ('k -> 'v val -> 'r comp) -> ('k, 'r) map comp = "assoc"
external return : 'a val -> 'a comp = "ret"
external const : 'a -> 'a val = "cnst"
external every : int -> unit effect val -> unit comp = "every"

(* ---- async ---- *)
type 'a task
type 'a remote = Loading | Loaded of 'a | Failed of string

(* Load data for the current key. A new key aborts the previous request,
   stale responses are dropped, and leaving the enclosing match* branch or
   assoc entry aborts the request in flight. *)
external resource : 'k val -> ('k -> 'a task) -> 'a remote comp = "resource"

external Task.succeed : 'a -> 'a task = "Task_succeed"
external Task.fail : string -> 'a task = "Task_fail"
external Task.map : ('a -> 'b) -> 'a task -> 'b task = "Task_map"
external Task.and_then : ('a -> 'b task) -> 'a task -> 'b task = "Task_and_then"
external Task.sleep : int -> unit task = "Task_sleep"
(* Run a task from an event handler and report its outcome (not cancellable). *)
external Task.attempt : 'a task -> ('a remote -> unit effect) -> unit effect = "Task_attempt"
external Http.get_text : string -> string task = "Http_get_text"

(* ---- effects ---- *)
external Effect.none : unit effect = "Effect_none"
external Effect.seq : unit effect list -> unit effect = "Effect_seq"
external Effect.print : string -> unit effect = "Effect_print"

(* ---- basics ---- *)
external show : int -> string = "show"
external Int.of_float : float -> int = "Int_of_float"
external Int.of_string : string -> int option = "Int_of_string"
external Int.abs : int -> int = "Int_abs"
external Int.min : int -> int -> int = "Int_min"
external Int.max : int -> int -> int = "Int_max"
external Float.of_int : int -> float = "Float_of_int"
external Float.to_string : float -> string = "Float_to_string"
external Float.fixed : int -> float -> string = "Float_fixed"
external String.length : string -> int = "String_length"
external String.trim : string -> string = "String_trim"
external String.is_empty : string -> bool = "String_is_empty"
external String.upper : string -> string = "String_upper"
external String.lower : string -> string = "String_lower"
external String.contains : string -> string -> bool = "String_contains"
external String.concat : string -> string list -> string = "String_concat"
external Random.next : int -> int = "Random_next"

let not b = if b then false else true
let fst p = match p with (a, _) -> a
let snd p = match p with (_, b) -> b
let id x = x

(* ---- lists ---- *)
external List.map : ('a -> 'b) -> 'a list -> 'b list = "List_map"
external List.mapi : (int -> 'a -> 'b) -> 'a list -> 'b list = "List_mapi"
external List.filter : ('a -> bool) -> 'a list -> 'a list = "List_filter"
external List.fold : ('acc -> 'a -> 'acc) -> 'acc -> 'a list -> 'acc = "List_fold"
external List.length : 'a list -> int = "List_length"
external List.rev : 'a list -> 'a list = "List_rev"
external List.range : int -> int -> int list = "List_range"
external List.concat : 'a list list -> 'a list = "List_concat"
external List.concat_map : ('a -> 'b list) -> 'a list -> 'b list = "List_concat_map"
external List.exists : ('a -> bool) -> 'a list -> bool = "List_exists"
external List.for_all : ('a -> bool) -> 'a list -> bool = "List_for_all"
external List.find : ('a -> bool) -> 'a list -> 'a option = "List_find"
external List.take : int -> 'a list -> 'a list = "List_take"
external List.sort : 'a list -> 'a list = "List_sort"
external List.is_empty : 'a list -> bool = "List_is_empty"

(* ---- maps ---- *)
external Map.empty : ('k, 'v) map = "Map_empty"
external Map.add : 'k -> 'v -> ('k, 'v) map -> ('k, 'v) map = "Map_add"
external Map.remove : 'k -> ('k, 'v) map -> ('k, 'v) map = "Map_remove"
external Map.find : 'k -> ('k, 'v) map -> 'v option = "Map_find"
external Map.mem : 'k -> ('k, 'v) map -> bool = "Map_mem"
external Map.size : ('k, 'v) map -> int = "Map_size"
external Map.update : 'k -> ('v option -> 'v option) -> ('k, 'v) map -> ('k, 'v) map = "Map_update"
external Map.values : ('k, 'v) map -> 'v list = "Map_values"
external Map.keys : ('k, 'v) map -> 'k list = "Map_keys"
external Map.to_list : ('k, 'v) map -> ('k * 'v) list = "Map_to_list"
external Map.of_list : ('k * 'v) list -> ('k, 'v) map = "Map_of_list"
external Map.fold : ('k -> 'v -> 'acc -> 'acc) -> ('k, 'v) map -> 'acc -> 'acc = "Map_fold"
external Map.filter : ('k -> 'v -> bool) -> ('k, 'v) map -> ('k, 'v) map = "Map_filter"
external Map.map : ('v -> 'w) -> ('k, 'v) map -> ('k, 'w) map = "Map_map"

(* ---- html ---- *)
external el : string -> attr list -> html list -> html = "Html_el"
external text : string -> html = "Html_text"
external Html.none : html = "Html_none"

external attr : string -> string -> attr = "Attr_attr"
external bool_attr : string -> bool -> attr = "Attr_bool"
external class_ : string -> attr = "Attr_class"
external key : string -> attr = "Attr_key"
external value : string -> attr = "Attr_value"
external checked : bool -> attr = "Attr_checked"
external style : string -> attr = "Attr_style"
external on_click : unit effect -> attr = "Attr_on_click"
external on_dblclick : unit effect -> attr = "Attr_on_dblclick"
external on_input : (string -> unit effect) -> attr = "Attr_on_input"
external on_check : (bool -> unit effect) -> attr = "Attr_on_check"
external on_keydown : (string -> unit effect) -> attr = "Attr_on_keydown"
external on_enter : unit effect -> attr = "Attr_on_enter"

let placeholder s = attr "placeholder" s
let type_ s = attr "type" s
let id_ s = attr "id" s

let div attrs children = el "div" attrs children
let span attrs children = el "span" attrs children
let p attrs children = el "p" attrs children
let h1 attrs children = el "h1" attrs children
let h2 attrs children = el "h2" attrs children
let button attrs children = el "button" attrs children
let input attrs = el "input" attrs []
let label attrs children = el "label" attrs children
let ul attrs children = el "ul" attrs children
let li attrs children = el "li" attrs children
let section attrs children = el "section" attrs children
let header attrs children = el "header" attrs children
let footer attrs children = el "footer" attrs children
let table attrs children = el "table" attrs children
let thead attrs children = el "thead" attrs children
let tbody attrs children = el "tbody" attrs children
let tr attrs children = el "tr" attrs children
let td attrs children = el "td" attrs children
let th attrs children = el "th" attrs children
`;
