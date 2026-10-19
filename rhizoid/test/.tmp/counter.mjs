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
const $Counter_counter = R1.let_star(R1.state(0), ((t1_51) => R1.let_star(R1.let_plus(t1_51, ((p_52) => {
const count_53 = p_52[0];
return count_53;
})), ((count_54) => R1.let_star(R1.let_plus(t1_51, ((p_55) => {
const set_56 = p_55[1];
return set_56;
})), ((set_57) => R1.let_plus(R1.and_plus(count_54, set_57), ((p_58) => {
const c_59 = p_58[0];
const set_60 = p_58[1];
return $Rhizoid_div(R.list(R1.Attr_class("counter")), R.list($Rhizoid_button(R.list(R1.Attr_on_click(set_60((c_59 - 1)))), R.list(R1.Html_text("-"))), $Rhizoid_span(null, R.list(R1.Html_text(R.show(c_59)))), $Rhizoid_button(R.list(R1.Attr_on_click(set_60((c_59 + 1)))), R.list(R1.Html_text("+")))));
}))))))));
const $Counter_page = R1.let_star($Counter_counter, ((a_61) => R1.let_star($Counter_counter, ((b_62) => R1.let_plus(R1.and_plus(a_61, b_62), ((p_63) => {
const a_64 = p_63[0];
const b_65 = p_63[1];
return $Rhizoid_div(null, R.list($Rhizoid_h1(null, R.list(R1.Html_text("Two counters"))), a_64, b_65));
}))))));
const $Counter_main = R1.start($Counter_page);
export const main = $Counter_main;
