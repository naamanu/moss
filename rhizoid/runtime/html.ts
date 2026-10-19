// Html builders for Rhizoid's `el`, `text` and attribute externals.
// Children and attributes arrive as Moss lists (cons cells).

import type { Eff } from "../../src/runtime/effect.ts";
import type { List } from "../../src/runtime/prelude.ts";
import { type Handler, VElem, VText, type VNode } from "./vdom.ts";

type F1<A, B> = (a: A) => B;

type Attr =
  | { k: "prop"; n: string; v: string | boolean }
  | { k: "class"; v: string }
  | { k: "on"; ev: string; f: Handler }
  | { k: "key"; v: string };

export function Html_el(tag: string, attrs: List<Attr>, children: List<VNode>): VNode {
  let key: string | null = null;
  let props: Record<string, string | boolean> | null = null;
  let on: Record<string, Handler> | null = null;
  for (let l = attrs; l !== null; l = l.t) {
    const a = l.h;
    switch (a.k) {
      case "prop":
        (props ??= {})[a.n] = a.v;
        break;
      case "class": {
        const p = (props ??= {});
        p.class = p.class ? `${p.class} ${a.v}` : a.v;
        break;
      }
      case "on":
        (on ??= {})[a.ev] = a.f;
        break;
      case "key":
        key = a.v;
        break;
    }
  }
  const cs: VNode[] = [];
  for (let l = children; l !== null; l = l.t) cs.push(l.h);
  return new VElem(tag, key, props, on, cs);
}

export const Html_text = (s: string): VNode => new VText(s);
export const Html_none: VNode = new VText("");

export const Attr_attr = (n: string, v: string): Attr => ({ k: "prop", n, v });
export const Attr_bool = (n: string, v: boolean): Attr => ({ k: "prop", n, v });
export const Attr_class = (v: string): Attr => ({ k: "class", v });
export const Attr_key = (v: string): Attr => ({ k: "key", v });
export const Attr_value = (v: string): Attr => ({ k: "prop", n: "value", v });
export const Attr_checked = (v: boolean): Attr => ({ k: "prop", n: "checked", v });
export const Attr_style = (v: string): Attr => ({ k: "prop", n: "style", v });
export const Attr_on_click = (eff: Eff): Attr => ({ k: "on", ev: "click", f: () => eff });
export const Attr_on_dblclick = (eff: Eff): Attr => ({ k: "on", ev: "dblclick", f: () => eff });
export const Attr_on_input = (f: F1<string, Eff>): Attr => ({
  k: "on",
  ev: "input",
  f: (e) => f((e.target as HTMLInputElement).value),
});
export const Attr_on_check = (f: F1<boolean, Eff>): Attr => ({
  k: "on",
  ev: "change",
  f: (e) => f((e.target as HTMLInputElement).checked),
});
export const Attr_on_keydown = (f: F1<string, Eff>): Attr => ({
  k: "on",
  ev: "keydown",
  f: (e) => f((e as KeyboardEvent).key),
});
export const Attr_on_enter = (eff: Eff): Attr => ({
  k: "on",
  ev: "keydown",
  f: (e) => ((e as KeyboardEvent).key === "Enter" ? eff : undefined),
});

