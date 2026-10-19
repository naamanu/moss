import * as R from "/Users/nana/workspace/projects/ui-lang/src/runtime/index.ts";
import * as R1 from "/Users/nana/workspace/projects/ui-lang/rhizoid/runtime/index.ts";
const C_None = { $: "None", i: 0 };
const C_Loading = { $: "Loading", i: 0 };
const C_Tick = { $: "Tick", i: 0 };
const C_Faster = { $: "Faster", i: 1 };
const C_Slower = { $: "Slower", i: 2 };
const C_Toggle_running = { $: "Toggle_running", i: 3 };
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
const $Table_n_rows = 10000;
function $Table_make_row(i_51) {
return { id: i_51, name: ("SYM" + R.show(i_51)), price: (100 + R.Float_of_int((i_51 % 97))), change: 0, volume: ((i_51 * 7919) % 10000) };
}
const $Table_initial = { seed: 12345, rows: R.List_fold(((m_52) => (i_53) => R.Map_add(i_53, $Table_make_row(i_53), m_52)), R.Map_empty, R.List_range(0, $Table_n_rows)), ticks: 0, rate: 50, running: true };
function $Table_bump(k_54, seed_55, rows_56) {
let if_66;
if ((k_54 === 0)) {
if_66 = [seed_55, rows_56];
} else {
const s1_57 = R.Random_next(seed_55);
const s2_58 = R.Random_next(s1_57);
const id_59 = R.imod(s1_57, $Table_n_rows);
const delta_60 = (R.Float_of_int(((s2_58 % 201) - 100)) / 100);
const rows_61 = R.Map_update(id_59, ((r_62) => {
let m_63;
L_64: {
if (r_62.$ === "Some") {
const r_65 = r_62.v;
m_63 = { $: "Some", i: 1, v: { ...r_65, price: (r_65.price + delta_60), change: delta_60, volume: (r_65.volume + 1) } };
break L_64;
}
if (r_62.$ === "None") {
m_63 = C_None;
break L_64;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/table.moss:1441");
}
return m_63;
}), rows_56);
if_66 = $Table_bump((k_54 - 1), s2_58, rows_61);
}
return if_66;
}
const $Table_bump$c = (a0) => (a1) => (a2) => $Table_bump(a0, a1, a2);
function $Table_reduce(m_67, action_68) {
let m_69;
L_70: {
if (action_68.$ === "Tick") {
if (m_67.running) {
const m_71 = $Table_bump(m_67.rate, m_67.seed, m_67.rows);
const seed_72 = m_71[0];
const rows_73 = m_71[1];
m_69 = { ...m_67, seed: seed_72, rows: rows_73, ticks: (m_67.ticks + 1) };
break L_70;
}
}
if (action_68.$ === "Tick") {
m_69 = m_67;
break L_70;
}
if (action_68.$ === "Faster") {
m_69 = { ...m_67, rate: R.Int_min(5000, (m_67.rate * 2)) };
break L_70;
}
if (action_68.$ === "Slower") {
m_69 = { ...m_67, rate: R.Int_max(1, Math.trunc(m_67.rate / 2)) };
break L_70;
}
if (action_68.$ === "Toggle_running") {
m_69 = { ...m_67, running: $not(m_67.running) };
break L_70;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/table.moss:1648");
}
return m_69;
}
const $Table_reduce$c = (a0) => (a1) => $Table_reduce(a0, a1);
function $Table_row_view(r_74) {
return R1.let_star(R1.state(false), ((t34_75) => R1.let_star(R1.let_plus(t34_75, ((p_76) => {
const expanded_77 = p_76[0];
return expanded_77;
})), ((expanded_78) => R1.let_star(R1.let_plus(t34_75, ((p_79) => {
const set_expanded_80 = p_79[1];
return set_expanded_80;
})), ((set_expanded_81) => R1.let_plus(R1.and_plus(R1.and_plus(r_74, expanded_78), set_expanded_81), ((p_82) => {
const r_83 = p_82[0][0];
const expanded_84 = p_82[0][1];
const set_expanded_85 = p_82[1];
return $Rhizoid_div(R.list(R1.Attr_key(R.show(r_83.id)), R1.Attr_class(((r_83.change >= 0) ? "row up" : "row down")), R1.Attr_on_click(set_expanded_85($not(expanded_84)))), R.list($Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text(R.show(r_83.id)))), $Rhizoid_span(null, R.list(R1.Html_text(r_83.name))), $Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text(R.Float_fixed(2, r_83.price)))), $Rhizoid_span(R.list(R1.Attr_class("num change")), R.list(R1.Html_text((((r_83.change >= 0) ? "+" : "") + R.Float_fixed(2, r_83.change))))), $Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text((expanded_84 ? ("vol " + R.show(r_83.volume)) : "…"))))));
}))))))));
}
const $Table_page = R1.let_star(R1.state_machine($Table_initial, $Table_reduce$c), ((t35_86) => R1.let_star(R1.let_plus(t35_86, ((p_87) => {
const model_88 = p_87[0];
return model_88;
})), ((model_89) => R1.let_star(R1.let_plus(t35_86, ((p_90) => {
const dispatch_91 = p_90[1];
return dispatch_91;
})), ((dispatch_92) => R1.let_star(R1.let_plus(dispatch_92, ((dispatch_93) => dispatch_93(C_Tick))), ((tick_94) => R1.let_star(R1.every(16, tick_94), ((p_95) => R1.let_star(R1.let_plus(model_89, ((m_96) => m_96.rows)), ((rows_97) => R1.let_star(R1.assoc(rows_97, ((p_98) => (r_99) => $Table_row_view(r_99))), ((views_100) => R1.let_star(R1.let_plus(views_100, ((views_101) => $Rhizoid_div(R.list(R1.Attr_class("rows")), R.Map_values(views_101)))), ((body_102) => R1.let_plus(R1.and_plus(R1.and_plus(body_102, model_89), dispatch_92), ((p_103) => {
const body_104 = p_103[0][0];
const m_105 = p_103[0][1];
const dispatch_106 = p_103[1];
return $Rhizoid_div(R.list(R1.Attr_class("page")), R.list($Rhizoid_header(null, R.list($Rhizoid_h1(null, R.list(R1.Html_text("Moss: 10,000 live rows"))), $Rhizoid_div(R.list(R1.Attr_class("controls")), R.list($Rhizoid_button(R.list(R1.Attr_on_click(dispatch_106(C_Toggle_running))), R.list(R1.Html_text((m_105.running ? "Pause" : "Resume")))), $Rhizoid_button(R.list(R1.Attr_on_click(dispatch_106(C_Slower))), R.list(R1.Html_text("Slower"))), $Rhizoid_span(R.list(R1.Attr_class("rate")), R.list(R1.Html_text((R.show(m_105.rate) + " updates / frame")))), $Rhizoid_button(R.list(R1.Attr_on_click(dispatch_106(C_Faster))), R.list(R1.Html_text("Faster"))), $Rhizoid_span(R.list(R1.Attr_class("ticks")), R.list(R1.Html_text(("tick " + R.show(m_105.ticks))))))))), $Rhizoid_div(R.list(R1.Attr_class("row head")), R.list($Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text("#"))), $Rhizoid_span(null, R.list(R1.Html_text("Symbol"))), $Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text("Price"))), $Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text("Change"))), $Rhizoid_span(R.list(R1.Attr_class("num")), R.list(R1.Html_text("Detail"))))), body_104));
}))))))))))))))))));
const $Table_main = R1.start($Table_page);
export const main = $Table_main;
