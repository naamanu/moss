import * as R from "/Users/nana/workspace/projects/ui-lang/src/runtime/index.ts";
import * as R1 from "/Users/nana/workspace/projects/ui-lang/rhizoid/runtime/index.ts";
const C_None = { $: "None", i: 0 };
const C_Loading = { $: "Loading", i: 0 };
const C_All = { $: "All", i: 0 };
const C_Active = { $: "Active", i: 1 };
const C_Completed = { $: "Completed", i: 2 };
const C_Clear_completed = { $: "Clear_completed", i: 5 };
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
function $Todo_update_todo(id_51, f_52, todos_53) {
return R.Map_update(id_51, ((t_54) => {
let m_55;
L_56: {
if (t_54.$ === "Some") {
const t_57 = t_54.v;
m_55 = { $: "Some", i: 1, v: f_52(t_57) };
break L_56;
}
if (t_54.$ === "None") {
m_55 = C_None;
break L_56;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/todo.moss:939");
}
return m_55;
}), todos_53);
}
const $Todo_update_todo$c = (a0) => (a1) => (a2) => $Todo_update_todo(a0, a1, a2);
function $Todo_reduce(m_58, action_59) {
let m_60;
L_61: {
if (action_59.$ === "Add") {
const title_62 = action_59.v;
const title_63 = R.String_trim(title_62);
let if_65;
if (R.String_is_empty(title_63)) {
if_65 = m_58;
} else {
const t_64 = { id: m_58.next_id, title: title_63, completed: false };
if_65 = { next_id: (m_58.next_id + 1), todos: R.Map_add(t_64.id, t_64, m_58.todos) };
}
m_60 = if_65;
break L_61;
}
if (action_59.$ === "Toggle") {
const id_66 = action_59.v;
m_60 = { ...m_58, todos: $Todo_update_todo(id_66, ((t_67) => ({ ...t_67, completed: $not(t_67.completed) })), m_58.todos) };
break L_61;
}
if (action_59.$ === "Rename") {
const id_68 = action_59.v[0];
const title_69 = action_59.v[1];
m_60 = { ...m_58, todos: $Todo_update_todo(id_68, ((t_70) => ({ ...t_70, title: R.String_trim(title_69) })), m_58.todos) };
break L_61;
}
if (action_59.$ === "Remove") {
const id_71 = action_59.v;
m_60 = { ...m_58, todos: R.Map_remove(id_71, m_58.todos) };
break L_61;
}
if (action_59.$ === "Toggle_all") {
const v_72 = action_59.v;
m_60 = { ...m_58, todos: R.Map_map(((t_73) => ({ ...t_73, completed: v_72 })), m_58.todos) };
break L_61;
}
if (action_59.$ === "Clear_completed") {
m_60 = { ...m_58, todos: R.Map_filter(((p_74) => (t_75) => $not(t_75.completed)), m_58.todos) };
break L_61;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/todo.moss:1020");
}
return m_60;
}
const $Todo_reduce$c = (a0) => (a1) => $Todo_reduce(a0, a1);
function $Todo_shows(f_76, t_77) {
let m_78;
L_79: {
if (f_76.$ === "All") {
m_78 = true;
break L_79;
}
if (f_76.$ === "Active") {
m_78 = $not(t_77.completed);
break L_79;
}
if (f_76.$ === "Completed") {
m_78 = t_77.completed;
break L_79;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/todo.moss:1756");
}
return m_78;
}
const $Todo_shows$c = (a0) => (a1) => $Todo_shows(a0, a1);
const $Todo_initial = { next_id: 4, todos: R.Map_of_list(R.list([1, { id: 1, title: "Write a language", completed: true }], [2, { id: 2, title: "Make it incremental", completed: false }], [3, { id: 3, title: "Ship it", completed: false }])) };
function $Todo_todo_row(dispatch_80, t_81) {
return R1.let_star(R1.state(false), ((t29_82) => R1.let_star(R1.let_plus(t29_82, ((p_83) => {
const editing_84 = p_83[0];
return editing_84;
})), ((editing_85) => R1.let_star(R1.let_plus(t29_82, ((p_86) => {
const set_editing_87 = p_86[1];
return set_editing_87;
})), ((set_editing_88) => R1.let_star(R1.state(""), ((t30_89) => R1.let_star(R1.let_plus(t30_89, ((p_90) => {
const draft_91 = p_90[0];
return draft_91;
})), ((draft_92) => R1.let_star(R1.let_plus(t30_89, ((p_93) => {
const set_draft_94 = p_93[1];
return set_draft_94;
})), ((set_draft_95) => R1.let_plus(R1.and_plus(R1.and_plus(R1.and_plus(R1.and_plus(R1.and_plus(t_81, editing_85), set_editing_88), draft_92), set_draft_95), dispatch_80), ((p_96) => {
const t_97 = p_96[0][0][0][0][0];
const editing_98 = p_96[0][0][0][0][1];
const set_editing_99 = p_96[0][0][0][1];
const draft_100 = p_96[0][0][1];
const set_draft_101 = p_96[0][1];
const dispatch_102 = p_96[1];
return [t_97, $Rhizoid_li(R.list(R1.Attr_key(R.show(t_97.id)), R1.Attr_class((t_97.completed ? "completed" : ""))), R.list($Rhizoid_input(R.list($Rhizoid_type_("checkbox"), R1.Attr_checked(t_97.completed), R1.Attr_on_check(((p_103) => dispatch_102({ $: "Toggle", i: 1, v: t_97.id }))))), (editing_98 ? $Rhizoid_input(R.list(R1.Attr_class("edit"), R1.Attr_value(draft_100), R1.Attr_on_input(set_draft_101), R1.Attr_on_enter(R.Effect_seq(R.list(dispatch_102({ $: "Rename", i: 2, v: [t_97.id, draft_100] }), set_editing_99(false)))))) : $Rhizoid_label(R.list(R1.Attr_on_dblclick(R.Effect_seq(R.list(set_draft_101(t_97.title), set_editing_99(true))))), R.list(R1.Html_text(t_97.title)))), $Rhizoid_button(R.list(R1.Attr_class("destroy"), R1.Attr_on_click(dispatch_102({ $: "Remove", i: 3, v: t_97.id }))), R.list(R1.Html_text("×")))))];
}))))))))))))));
}
const $Todo_todo_row$c = (a0) => (a1) => $Todo_todo_row(a0, a1);
function $Todo_filter_link(current_104, set_filter_105, f_106, name_107) {
return $Rhizoid_button(R.list(R1.Attr_class((R.eq(current_104, f_106) ? "selected" : "")), R1.Attr_on_click(set_filter_105(f_106))), R.list(R1.Html_text(name_107)));
}
const $Todo_filter_link$c = (a0) => (a1) => (a2) => (a3) => $Todo_filter_link(a0, a1, a2, a3);
const $Todo_page = R1.let_star(R1.state_machine($Todo_initial, $Todo_reduce$c), ((t31_108) => R1.let_star(R1.let_plus(t31_108, ((p_109) => {
const model_110 = p_109[0];
return model_110;
})), ((model_111) => R1.let_star(R1.let_plus(t31_108, ((p_112) => {
const dispatch_113 = p_112[1];
return dispatch_113;
})), ((dispatch_114) => R1.let_star(R1.state(""), ((t32_115) => R1.let_star(R1.let_plus(t32_115, ((p_116) => {
const draft_117 = p_116[0];
return draft_117;
})), ((draft_118) => R1.let_star(R1.let_plus(t32_115, ((p_119) => {
const set_draft_120 = p_119[1];
return set_draft_120;
})), ((set_draft_121) => R1.let_star(R1.state(C_All), ((t33_122) => R1.let_star(R1.let_plus(t33_122, ((p_123) => {
const filter_124 = p_123[0];
return filter_124;
})), ((filter_125) => R1.let_star(R1.let_plus(t33_122, ((p_126) => {
const set_filter_127 = p_126[1];
return set_filter_127;
})), ((set_filter_128) => R1.let_star(R1.let_plus(model_111, ((m_129) => m_129.todos)), ((todos_130) => R1.let_star(R1.assoc(todos_130, ((p_131) => (t_132) => $Todo_todo_row(dispatch_114, t_132))), ((rows_133) => R1.let_star(R1.let_plus(model_111, ((m_134) => (R.Map_size(m_134.todos) > 0))), ((has_todos_135) => R1.let_star(R1.match_star(has_todos_135, ((x26_136) => {
let m_137;
L_138: {
if (x26_136 === false) {
m_137 = 0;
break L_138;
}
if (x26_136 === true) {
m_137 = 1;
break L_138;
}
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/todo.moss:3452");
}
return m_137;
}), ((i27_139) => (v28_140) => {
let m_141;
L_142: {
if (i27_139 === 0) {
m_141 = R1.ret(R1.cnst($Rhizoid_p(R.list(R1.Attr_class("empty")), R.list(R1.Html_text("Nothing to do. Add something above.")))));
break L_142;
}
m_141 = R1.let_plus(R1.and_plus(rows_133, filter_125), ((p_143) => {
const rows_144 = p_143[0];
const f_145 = p_143[1];
return $Rhizoid_ul(R.list(R1.Attr_class("todo-list")), R.List_map($snd, R.List_filter(((p_146) => {
const t_147 = p_146[0];
return $Todo_shows(f_145, t_147);
}), R.Map_values(rows_144))));
}));
break L_142;
R.matchFail("/Users/nana/workspace/projects/ui-lang/rhizoid/examples/todo.moss:3452");
}
return m_141;
})), ((list_148) => R1.let_plus(R1.and_plus(R1.and_plus(R1.and_plus(R1.and_plus(R1.and_plus(R1.and_plus(list_148, model_111), draft_118), set_draft_121), dispatch_114), filter_125), set_filter_128), ((p_149) => {
const list_150 = p_149[0][0][0][0][0][0];
const m_151 = p_149[0][0][0][0][0][1];
const draft_152 = p_149[0][0][0][0][1];
const set_draft_153 = p_149[0][0][0][1];
const dispatch_154 = p_149[0][0][1];
const f_155 = p_149[0][1];
const set_filter_156 = p_149[1];
const left_157 = R.Map_size(R.Map_filter(((p_158) => (t_159) => $not(t_159.completed)), m_151.todos));
const total_160 = R.Map_size(m_151.todos);
return $Rhizoid_section(R.list(R1.Attr_class("todoapp")), R.list($Rhizoid_header(null, R.list($Rhizoid_h1(null, R.list(R1.Html_text("todos"))), $Rhizoid_input(R.list(R1.Attr_class("new-todo"), $Rhizoid_placeholder("What needs to be done?"), R1.Attr_value(draft_152), R1.Attr_on_input(set_draft_153), R1.Attr_on_enter(R.Effect_seq(R.list(dispatch_154({ $: "Add", i: 0, v: draft_152 }), set_draft_153("")))))))), ((total_160 > 0) ? $Rhizoid_label(R.list(R1.Attr_class("toggle-all")), R.list($Rhizoid_input(R.list($Rhizoid_type_("checkbox"), R1.Attr_checked((left_157 === 0)), R1.Attr_on_check(((v_161) => dispatch_154({ $: "Toggle_all", i: 4, v: v_161 }))))), R1.Html_text("Mark all as complete"))) : R1.Html_none), list_150, $Rhizoid_footer(null, R.list($Rhizoid_span(R.list(R1.Attr_class("count")), R.list(R1.Html_text((R.show(left_157) + ((left_157 === 1) ? " item left" : " items left"))))), $Rhizoid_div(R.list(R1.Attr_class("filters")), R.list($Todo_filter_link(f_155, set_filter_156, C_All, "All"), $Todo_filter_link(f_155, set_filter_156, C_Active, "Active"), $Todo_filter_link(f_155, set_filter_156, C_Completed, "Completed"))), ((total_160 > left_157) ? $Rhizoid_button(R.list(R1.Attr_class("clear"), R1.Attr_on_click(dispatch_154(C_Clear_completed))), R.list(R1.Html_text("Clear completed"))) : R1.Html_none)))));
}))))))))))))))))))))))))))));
const $Todo_main = R1.start($Todo_page);
export const main = $Todo_main;
