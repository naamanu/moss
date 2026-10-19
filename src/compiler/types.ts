// Type representation, unification (with levels for let-generalization),
// and pretty-printing.

export type Type = TVar | TCon | TFun | TTuple;

export interface TVar {
  k: "var";
  id: number;
  level: number;
  link: Type | null;
}
export interface TCon {
  k: "con";
  name: string;
  args: Type[];
}
export interface TFun {
  k: "fun";
  from: Type;
  to: Type;
}
export interface TTuple {
  k: "tuple";
  items: Type[];
}

let nextId = 0;
export const tvar = (level: number): TVar => ({ k: "var", id: nextId++, level, link: null });
export const tcon = (name: string, ...args: Type[]): TCon => ({ k: "con", name, args });
export const tfun = (from: Type, to: Type): TFun => ({ k: "fun", from, to });
export const ttuple = (items: Type[]): TTuple => ({ k: "tuple", items });

export const tInt = tcon("int");
export const tFloat = tcon("float");
export const tString = tcon("string");
export const tBool = tcon("bool");
export const tUnit = tcon("unit");
export const tList = (t: Type) => tcon("list", t);
export const tVal = (t: Type) => tcon("val", t);
export const tComp = (t: Type) => tcon("comp", t);
export const tHtml = tcon("html");

/** Follow links to the representative type. */
export function prune(t: Type): Type {
  while (t.k === "var" && t.link !== null) {
    // Path compression.
    const next: Type = t.link;
    if (next.k === "var" && next.link !== null) t.link = next.link;
    t = next;
  }
  return t;
}

export class UnifyError extends Error {
  constructor(readonly a: Type, readonly b: Type, readonly reason?: string) {
    super("unify");
  }
}

function occursAdjust(v: TVar, t: Type): void {
  t = prune(t);
  switch (t.k) {
    case "var":
      if (t === v) throw new UnifyError(v, t, "recursive type");
      if (t.level > v.level) t.level = v.level;
      return;
    case "con":
      for (const a of t.args) occursAdjust(v, a);
      return;
    case "fun":
      occursAdjust(v, t.from);
      occursAdjust(v, t.to);
      return;
    case "tuple":
      for (const a of t.items) occursAdjust(v, a);
  }
}

export function unify(a: Type, b: Type): void {
  a = prune(a);
  b = prune(b);
  if (a === b) return;
  if (a.k === "var") {
    occursAdjust(a, b);
    a.link = b;
    return;
  }
  if (b.k === "var") return unify(b, a);
  if (a.k === "con" && b.k === "con") {
    if (a.name !== b.name || a.args.length !== b.args.length) throw new UnifyError(a, b);
    for (let i = 0; i < a.args.length; i++) unify(a.args[i]!, b.args[i]!);
    return;
  }
  if (a.k === "fun" && b.k === "fun") {
    unify(a.from, b.from);
    unify(a.to, b.to);
    return;
  }
  if (a.k === "tuple" && b.k === "tuple" && a.items.length === b.items.length) {
    for (let i = 0; i < a.items.length; i++) unify(a.items[i]!, b.items[i]!);
    return;
  }
  throw new UnifyError(a, b);
}

// ---------------------------------------------------------------------------
// Schemes

export interface Scheme {
  vars: TVar[];
  type: Type;
}

export const mono = (type: Type): Scheme => ({ vars: [], type });

export function generalize(t: Type, level: number): Scheme {
  const vars: TVar[] = [];
  const go = (t: Type): void => {
    t = prune(t);
    switch (t.k) {
      case "var":
        if (t.level > level && !vars.includes(t)) vars.push(t);
        return;
      case "con":
        t.args.forEach(go);
        return;
      case "fun":
        go(t.from);
        go(t.to);
        return;
      case "tuple":
        t.items.forEach(go);
    }
  };
  go(t);
  return { vars, type: t };
}

export function instantiate(s: Scheme, level: number): Type {
  if (s.vars.length === 0) return s.type;
  const sub = new Map<TVar, Type>(s.vars.map((v) => [v, tvar(level)]));
  const go = (t: Type): Type => {
    t = prune(t);
    switch (t.k) {
      case "var":
        return sub.get(t) ?? t;
      case "con":
        return t.args.length === 0 ? t : tcon(t.name, ...t.args.map(go));
      case "fun":
        return tfun(go(t.from), go(t.to));
      case "tuple":
        return ttuple(t.items.map(go));
    }
  };
  return go(s.type);
}

/** Number of arrows at the top of a type (its "natural" arity). */
export function arity(t: Type): number {
  let n = 0;
  t = prune(t);
  while (t.k === "fun") {
    n++;
    t = prune(t.to);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Printing

/**
 * Types print by the shortest name that refers to them where the message is
 * reported: unqualified if defined in or opened into that module.
 */
export const printContext: { module: string; types?: Map<string, string> } = { module: "" };

export const typeName = (q: string): string => {
  const short = q.slice(q.lastIndexOf(".") + 1);
  if (printContext.types?.get(short) === q) return short;
  const m = printContext.module;
  return m && q.startsWith(`${m}.`) ? short : q;
};

export class TypePrinter {
  private names = new Map<TVar, string>();

  print(t: Type): string {
    return this.go(t, 0);
  }

  private name(v: TVar): string {
    let n = this.names.get(v);
    if (n === undefined) {
      const i = this.names.size;
      n = "'" + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
      this.names.set(v, n);
    }
    return n;
  }

  // prec: 0 = top, 1 = inside arrow lhs / tuple item, 2 = type argument
  private go(t: Type, prec: number): string {
    t = prune(t);
    switch (t.k) {
      case "var":
        return this.name(t);
      case "con": {
        const name = typeName(t.name);
        if (t.args.length === 0) return name;
        if (t.args.length === 1) return `${this.go(t.args[0]!, 2)} ${name}`;
        return `(${t.args.map((a) => this.go(a, 0)).join(", ")}) ${name}`;
      }
      case "fun": {
        const s = `${this.go(t.from, 1)} -> ${this.go(t.to, 0)}`;
        return prec > 0 ? `(${s})` : s;
      }
      case "tuple": {
        const s = t.items.map((a) => this.go(a, 2)).join(" * ");
        return prec > 1 ? `(${s})` : s;
      }
    }
  }
}

export const showType = (t: Type): string => new TypePrinter().print(t);
