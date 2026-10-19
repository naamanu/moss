// Minimal virtual DOM. The important property for speed: if an old and new
// vnode are the same object, the whole subtree is skipped in O(1). Because
// incremental nodes cut off on unchanged values, unchanged parts of the UI
// produce *the same* vnode objects frame after frame.

export type Handler = (e: Event) => { run(): unknown } | undefined;

export class VElem {
  constructor(
    readonly tag: string,
    readonly key: string | null,
    readonly props: Record<string, string | boolean> | null,
    readonly on: Record<string, Handler> | null,
    readonly children: VNode[],
  ) {}
}

export class VText {
  constructor(readonly text: string) {}
}

export type VNode = VElem | VText;

/** Installed by the app loop: runs an effect produced by an event handler. */
let dispatch: (eff: { run(): unknown }) => void = (eff) => void eff.run();
export function setDispatcher(d: typeof dispatch): void {
  dispatch = d;
}

export const patchStats = { created: 0, patched: 0 };

interface MossElement extends HTMLElement {
  __mh?: Record<string, Handler>;
  /** Child DOM nodes aligned with the vnode children; rebuilt lazily after structural changes. */
  __kids?: ChildNode[] | undefined;
}

function listener(this: MossElement, e: Event): void {
  const h = this.__mh?.[e.type];
  if (h === undefined) return;
  const eff = h(e);
  if (eff !== undefined) dispatch(eff);
}

function setProp(el: HTMLElement, name: string, v: string | boolean): void {
  switch (name) {
    case "value":
      if ((el as HTMLInputElement).value !== v) (el as HTMLInputElement).value = String(v);
      return;
    case "checked":
      (el as HTMLInputElement).checked = Boolean(v);
      return;
    case "class":
      el.className = String(v);
      return;
    case "style":
      el.style.cssText = String(v);
      return;
    default:
      if (v === false) el.removeAttribute(name);
      else el.setAttribute(name, v === true ? "" : v);
  }
}

function removeProp(el: HTMLElement, name: string): void {
  switch (name) {
    case "value":
      (el as HTMLInputElement).value = "";
      return;
    case "checked":
      (el as HTMLInputElement).checked = false;
      return;
    case "class":
      el.className = "";
      return;
    default:
      el.removeAttribute(name);
  }
}

export function create(v: VNode, doc: Document = document): Node {
  patchStats.created++;
  if (v instanceof VText) return doc.createTextNode(v.text);
  const el = doc.createElement(v.tag) as MossElement;
  if (v.props) for (const k in v.props) setProp(el, k, v.props[k]!);
  if (v.on) {
    el.__mh = v.on;
    for (const ev in v.on) el.addEventListener(ev, listener);
  }
  const cs = v.children;
  for (let i = 0; i < cs.length; i++) el.appendChild(create(cs[i]!, doc));
  return el;
}

/** Bring `dom` (rendered from `old`) in line with `next`. Returns the DOM node now in its place. */
export function patch(dom: Node, old: VNode, next: VNode): Node {
  if (old === next) return dom;
  patchStats.patched++;
  if (old instanceof VText && next instanceof VText) {
    if (old.text !== next.text) (dom as Text).data = next.text;
    return dom;
  }
  if (old instanceof VElem && next instanceof VElem && old.tag === next.tag && old.key === next.key) {
    const el = dom as MossElement;
    patchProps(el, old.props, next.props);
    patchHandlers(el, old.on, next.on);
    patchChildren(el, old.children, next.children);
    return el;
  }
  const fresh = create(next, dom.ownerDocument!);
  dom.parentNode!.replaceChild(fresh, dom);
  return fresh;
}

function patchProps(el: HTMLElement, a: VElem["props"], b: VElem["props"]): void {
  if (a === b) return;
  if (a) for (const k in a) if (!b || !(k in b)) removeProp(el, k);
  if (b) for (const k in b) if (!a || a[k] !== b[k] || k === "value") setProp(el, k, b[k]!);
}

function patchHandlers(el: MossElement, a: VElem["on"], b: VElem["on"]): void {
  if (a === b) return;
  if (a) for (const ev in a) if (!b || !(ev in b)) el.removeEventListener(ev, listener);
  if (b) for (const ev in b) if (!a || !(ev in a)) el.addEventListener(ev, listener);
  // Handlers are looked up at event time, so swapping them never re-binds listeners.
  el.__mh = b ?? undefined;
}

const keyOf = (v: VNode): string | null => (v instanceof VElem ? v.key : null);

function sameSlot(a: VNode, b: VNode): boolean {
  return keyOf(a) === keyOf(b);
}

function patchChildren(el: MossElement, old: VNode[], next: VNode[]): void {
  if (old === next) return;
  const doc = el.ownerDocument;
  // Fast path: same length and same keys in place (the common case for a list
  // whose items changed but didn't move). Unchanged children are skipped by
  // identity without touching the DOM at all.
  if (old.length === next.length) {
    let i = 0;
    const n = old.length;
    for (; i < n; i++) {
      const a = old[i]!;
      const b = next[i]!;
      if (a !== b && !sameSlot(a, b)) break;
    }
    if (i === n) {
      // Indexing the live NodeList can be O(distance); keep our own array.
      const kids = (el.__kids ??= Array.from(el.childNodes));
      for (let j = 0; j < n; j++) {
        const a = old[j]!;
        const b = next[j]!;
        if (a !== b) kids[j] = patch(kids[j]!, a, b) as ChildNode;
      }
      return;
    }
  }
  el.__kids = undefined;
  let oStart = 0;
  let nStart = 0;
  let oEnd = old.length - 1;
  let nEnd = next.length - 1;

  // Common prefix.
  let dom = el.firstChild;
  while (oStart <= oEnd && nStart <= nEnd && sameSlot(old[oStart]!, next[nStart]!)) {
    const after: ChildNode | null = dom!.nextSibling;
    patch(dom!, old[oStart]!, next[nStart]!);
    dom = after;
    oStart++;
    nStart++;
  }
  // Common suffix.
  let tail = el.lastChild;
  while (oStart <= oEnd && nStart <= nEnd && sameSlot(old[oEnd]!, next[nEnd]!)) {
    const before: ChildNode | null = tail!.previousSibling;
    patch(tail!, old[oEnd]!, next[nEnd]!);
    tail = before;
    oEnd--;
    nEnd--;
  }
  // `dom` is the first unprocessed old node; `anchor` is where the suffix begins.
  const anchor: ChildNode | null = tail ? tail.nextSibling : el.firstChild;
  if (oStart > oEnd) {
    for (let i = nStart; i <= nEnd; i++) el.insertBefore(create(next[i]!, doc), anchor);
    return;
  }
  if (nStart > nEnd) {
    for (let i = oStart; i <= oEnd; i++) {
      const after: ChildNode | null = dom!.nextSibling;
      el.removeChild(dom!);
      dom = after;
    }
    return;
  }

  // General case: match the middle section by key (positional for unkeyed).
  const beforeMiddle = dom!.previousSibling;
  const byKey = new Map<string, { v: VNode; dom: ChildNode }>();
  let unkeyed = 0;
  for (let i = oStart; i <= oEnd; i++) {
    const v = old[i]!;
    const k = keyOf(v) ?? `\u0000${unkeyed++}`;
    byKey.set(k, { v, dom: dom! });
    dom = dom!.nextSibling;
  }
  unkeyed = 0;
  const placed: ChildNode[] = [];
  for (let i = nStart; i <= nEnd; i++) {
    const v = next[i]!;
    const k = keyOf(v) ?? `\u0000${unkeyed++}`;
    const hit = byKey.get(k);
    if (hit) {
      byKey.delete(k);
      placed.push(patch(hit.dom, hit.v, v) as ChildNode);
    } else {
      placed.push(create(v, doc) as ChildNode);
    }
  }
  for (const { dom: d } of byKey.values()) el.removeChild(d);
  // Order the middle: walk forward, moving nodes only when out of place.
  let cursor: ChildNode | null = beforeMiddle ? beforeMiddle.nextSibling : el.firstChild;
  for (const n of placed) {
    if (n === cursor) cursor = cursor.nextSibling;
    else el.insertBefore(n, cursor);
  }
}
