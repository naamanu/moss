import * as R from "/Users/nana/workspace/projects/ui-lang/src/runtime/index.ts";
import * as R1 from "/Users/nana/workspace/projects/ui-lang/rhizoid/runtime/index.ts";
const C_None = { $: "None", i: 0 };
const C_Loading = { $: "Loading", i: 0 };
function $not(b_1) {
return (b_1 ? false : true);
}
function $fst(p_2) {
let m_3;
L_4: {
const a_5 = p_2[0];
m_3 = a_5;
break L_4;
R.matchFail("<stdlib>/prelude.moss:376");
}
return m_3;
}
function $snd(p_6) {
let m_7;
L_8: {
const b_9 = p_6[1];
m_7 = b_9;
break L_8;
R.matchFail("<stdlib>/prelude.moss:413");
}
return m_7;
}
function $id(x_10) {
return x_10;
}
function $Rhizoid_placeholder(s_11) {
return R1.Attr_attr("placeholder", s_11);
}
function $Rhizoid_type_(s_12) {
return R1.Attr_attr("type", s_12);
}
function $Rhizoid_id_(s_13) {
return R1.Attr_attr("id", s_13);
}
function $Rhizoid_div(attrs_14, children_15) {
return R1.Html_el("div", attrs_14, children_15);
}
const $Rhizoid_div$c = (a0) => (a1) => $Rhizoid_div(a0, a1);
function $Rhizoid_span(attrs_16, children_17) {
return R1.Html_el("span", attrs_16, children_17);
}
const $Rhizoid_span$c = (a0) => (a1) => $Rhizoid_span(a0, a1);
function $Rhizoid_p(attrs_18, children_19) {
return R1.Html_el("p", attrs_18, children_19);
}
const $Rhizoid_p$c = (a0) => (a1) => $Rhizoid_p(a0, a1);
function $Rhizoid_h1(attrs_20, children_21) {
return R1.Html_el("h1", attrs_20, children_21);
}
const $Rhizoid_h1$c = (a0) => (a1) => $Rhizoid_h1(a0, a1);
function $Rhizoid_h2(attrs_22, children_23) {
return R1.Html_el("h2", attrs_22, children_23);
}
const $Rhizoid_h2$c = (a0) => (a1) => $Rhizoid_h2(a0, a1);
function $Rhizoid_button(attrs_24, children_25) {
return R1.Html_el("button", attrs_24, children_25);
}
const $Rhizoid_button$c = (a0) => (a1) => $Rhizoid_button(a0, a1);
function $Rhizoid_input(attrs_26) {
return R1.Html_el("input", attrs_26, null);
}
function $Rhizoid_label(attrs_27, children_28) {
return R1.Html_el("label", attrs_27, children_28);
}
const $Rhizoid_label$c = (a0) => (a1) => $Rhizoid_label(a0, a1);
function $Rhizoid_ul(attrs_29, children_30) {
return R1.Html_el("ul", attrs_29, children_30);
}
const $Rhizoid_ul$c = (a0) => (a1) => $Rhizoid_ul(a0, a1);
function $Rhizoid_li(attrs_31, children_32) {
return R1.Html_el("li", attrs_31, children_32);
}
const $Rhizoid_li$c = (a0) => (a1) => $Rhizoid_li(a0, a1);
function $Rhizoid_section(attrs_33, children_34) {
return R1.Html_el("section", attrs_33, children_34);
}
const $Rhizoid_section$c = (a0) => (a1) => $Rhizoid_section(a0, a1);
function $Rhizoid_header(attrs_35, children_36) {
return R1.Html_el("header", attrs_35, children_36);
}
const $Rhizoid_header$c = (a0) => (a1) => $Rhizoid_header(a0, a1);
function $Rhizoid_footer(attrs_37, children_38) {
return R1.Html_el("footer", attrs_37, children_38);
}
const $Rhizoid_footer$c = (a0) => (a1) => $Rhizoid_footer(a0, a1);
function $Rhizoid_table(attrs_39, children_40) {
return R1.Html_el("table", attrs_39, children_40);
}
const $Rhizoid_table$c = (a0) => (a1) => $Rhizoid_table(a0, a1);
function $Rhizoid_thead(attrs_41, children_42) {
return R1.Html_el("thead", attrs_41, children_42);
}
const $Rhizoid_thead$c = (a0) => (a1) => $Rhizoid_thead(a0, a1);
function $Rhizoid_tbody(attrs_43, children_44) {
return R1.Html_el("tbody", attrs_43, children_44);
}
const $Rhizoid_tbody$c = (a0) => (a1) => $Rhizoid_tbody(a0, a1);
function $Rhizoid_tr(attrs_45, children_46) {
return R1.Html_el("tr", attrs_45, children_46);
}
const $Rhizoid_tr$c = (a0) => (a1) => $Rhizoid_tr(a0, a1);
function $Rhizoid_td(attrs_47, children_48) {
return R1.Html_el("td", attrs_47, children_48);
}
const $Rhizoid_td$c = (a0) => (a1) => $Rhizoid_td(a0, a1);
function $Rhizoid_th(attrs_49, children_50) {
return R1.Html_el("th", attrs_49, children_50);
}
const $Rhizoid_th$c = (a0) => (a1) => $Rhizoid_th(a0, a1);
const $Search_fruit = R.list("apple", "apricot", "avocado", "banana", "blackberry", "blueberry", "cherry", "clementine", "coconut", "cranberry", "date", "dragonfruit", "elderberry", "fig", "gooseberry", "grape", "grapefruit", "guava", "honeydew", "jackfruit", "kiwi", "kumquat", "lemon", "lime", "lychee", "mango", "melon", "mulberry", "nectarine", "olive", "orange", "papaya", "passionfruit", "peach", "pear", "persimmon", "pineapple", "plum", "pomegranate", "quince", "raspberry", "starfruit", "strawberry", "tangerine", "watermelon");
function $Search_latency(q_51) {
return (150 + ((R.String_length(q_51) * 173) % 400));
}
function $Search_backend(q_52) {
return ((q_52 === "error") ? R.Task_and_then(((p_53) => R.Task_fail("the server refused that query")), R.Task_sleep(300)) : R.Task_map(((p_54) => R.List_filter(((w_55) => R.String_contains(q_52, w_55)), $Search_fruit)), R.Task_sleep($Search_latency(q_52))));
}
function $Search_search(q_56) {
return (R.String_is_empty(q_56) ? R.Task_succeed(null) : R.Task_and_then(((p_57) => $Search_backend(q_56)), R.Task_sleep(200)));
}
function $Search_results_view(q_58, r_59) {
let if_65;
if (R.String_is_empty(q_58)) {
if_65 = $Rhizoid_p(R.list(R1.Attr_class("status")), R.list(R1.Html_text("Type to search.")));
} else {
let m_60;
L_61: {
if (r_59.$ === "Loading") {
m_60 = $Rhizoid_p(R.list(R1.Attr_class("status")), R.list(R1.Html_text(("Searching for \"" + (q_58 + "\"…")))));
break L_61;
}
if (r_59.$ === "Failed") {
const msg_62 = r_59.v;
m_60 = $Rhizoid_p(R.list(R1.Attr_class("status error")), R.list(R1.Html_text(("Error: " + msg_62))));
break L_61;
}
if (r_59.$ === "Loaded" && r_59.v === null) {
m_60 = $Rhizoid_p(R.list(R1.Attr_class("status")), R.list(R1.Html_text("No matches.")));
break L_61;
}
if (r_59.$ === "Loaded") {
const ws_63 = r_59.v;
m_60 = $Rhizoid_ul(R.list(R1.Attr_class("results")), R.List_map(((w_64) => $Rhizoid_li(R.list(R1.Attr_key(w_64)), R.list(R1.Html_text(w_64)))), ws_63));
break L_61;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/search.moss:1815");
}
if_65 = m_60;
}
return if_65;
}
const $Search_results_view$c = (a0) => (a1) => $Search_results_view(a0, a1);
const $Search_search_panel = R1.let_star(R1.state(""), ((t49_66) => R1.let_star(R1.let_plus(t49_66, ((p_67) => {
const query_68 = p_67[0];
return query_68;
})), ((query_69) => R1.let_star(R1.let_plus(t49_66, ((p_70) => {
const set_query_71 = p_70[1];
return set_query_71;
})), ((set_query_72) => R1.let_star(R1.let_plus(query_69, ((q_73) => R.String_lower(R.String_trim(q_73)))), ((key_74) => R1.let_star(R1.resource(key_74, $Search_search), ((results_75) => R1.let_plus(R1.and_plus(R1.and_plus(R1.and_plus(query_69, key_74), set_query_72), results_75), ((p_76) => {
const q_77 = p_76[0][0][0];
const k_78 = p_76[0][0][1];
const set_query_79 = p_76[0][1];
const r_80 = p_76[1];
return $Rhizoid_div(R.list(R1.Attr_class("panel")), R.list($Rhizoid_input(R.list(R1.Attr_class("query"), $Rhizoid_placeholder("Search fruit (try \"error\")"), R1.Attr_value(q_77), R1.Attr_on_input(set_query_79))), $Search_results_view(k_78, r_80)));
}))))))))))));
const $Search_page = R1.let_star(R1.state(true), ((t50_81) => R1.let_star(R1.let_plus(t50_81, ((p_82) => {
const visible_83 = p_82[0];
return visible_83;
})), ((visible_84) => R1.let_star(R1.let_plus(t50_81, ((p_85) => {
const set_visible_86 = p_85[1];
return set_visible_86;
})), ((set_visible_87) => R1.let_star(R1.match_star(visible_84, ((x46_88) => {
let m_89;
L_90: {
if (x46_88 === true) {
m_89 = 0;
break L_90;
}
if (x46_88 === false) {
m_89 = 1;
break L_90;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/search.moss:2583");
}
return m_89;
}), ((i47_91) => (v48_92) => {
let m_93;
L_94: {
if (i47_91 === 0) {
m_93 = $Search_search_panel;
break L_94;
}
m_93 = R1.ret(R1.cnst($Rhizoid_p(R.list(R1.Attr_class("status")), R.list(R1.Html_text("Hidden. A request in flight was cancelled; showing the panel resumes it.")))));
break L_94;
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/search.moss:2583");
}
return m_93;
})), ((panel_95) => R1.let_plus(R1.and_plus(R1.and_plus(panel_95, visible_84), set_visible_87), ((p_96) => {
const panel_97 = p_96[0][0];
const v_98 = p_96[0][1];
const set_visible_99 = p_96[1];
return $Rhizoid_section(null, R.list($Rhizoid_h1(null, R.list(R1.Html_text("Search"))), $Rhizoid_label(R.list(R1.Attr_class("toggle")), R.list($Rhizoid_input(R.list($Rhizoid_type_("checkbox"), R1.Attr_checked(v_98), R1.Attr_on_check(set_visible_99))), R1.Html_text(" Show search panel"))), panel_97));
}))))))))));
const $Search_main = R1.start($Search_page);
export const main = $Search_main;
