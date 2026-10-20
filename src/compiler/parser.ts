import {
  type Attr,
  BINDING_OPS,
  type Case,
  type Decl,
  type Expr,
  type LetPlusBind,
  type Pat,
  type Program,
  type TypeDef,
  type TypeExpr,
} from "./ast.ts";
import { MossError, type Span } from "./errors.ts";
import { lex, type Token } from "./lexer.ts";

const BINOPS: Record<string, [prec: number, right: boolean]> = {
  "|>": [1, false],
  "||": [2, true],
  "&&": [3, true],
  "=": [4, false],
  "<>": [4, false],
  "==": [4, false],
  "<": [4, false],
  ">": [4, false],
  "<=": [4, false],
  ">=": [4, false],
  "::": [5, true],
  "@": [5, true],
  "^": [5, true],
  "+": [6, false],
  "-": [6, false],
  "+.": [6, false],
  "-.": [6, false],
  "*": [7, false],
  "/": [7, false],
  "*.": [7, false],
  "/.": [7, false],
  mod: [7, false],
};

export function parse(src: string, file: string): Program {
  return new Parser(lex(src, file)).program();
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  // -- token helpers --------------------------------------------------------

  private get tok(): Token {
    return this.toks[this.i]!;
  }
  private peek(n = 1): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)]!;
  }
  private is(text: string, kind?: Token["kind"]): boolean {
    const t = this.tok;
    return t.text === text && (kind ? t.kind === kind : t.kind === "op" || t.kind === "kw");
  }
  private eat(text: string): boolean {
    if (this.is(text)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(text: string, what?: string): Token {
    if (!this.is(text)) this.fail(`expected ${what ?? `'${text}'`} but found '${this.tok.text}'`);
    return this.toks[this.i++]!;
  }
  private expectKind(kind: Token["kind"], what: string): Token {
    if (this.tok.kind !== kind) this.fail(`expected ${what} but found '${this.tok.text}'`);
    return this.toks[this.i++]!;
  }
  private fail(msg: string, span: Span = this.tok.span): never {
    throw new MossError(msg, span);
  }
  private from(start: Span): Span {
    const prev = this.toks[this.i - 1]!;
    return { file: start.file, start: start.start, end: prev.span.end };
  }

  // -- declarations ---------------------------------------------------------

  program(): Program {
    const decls: Decl[] = [];
    while (this.tok.kind !== "eof") decls.push(this.decl());
    return { decls };
  }

  private decl(): Decl {
    const start = this.tok.span;
    if (this.eat("type")) return this.typeDecl(start);
    if (this.eat("external")) {
      const name = this.valueName("a name").text;
      this.expect(":");
      const type = this.type();
      this.expect("=");
      const js = this.expectKind("string", "a JS name string").text;
      const span = this.from(start);
      return { d: "external", name, type, js, attrs: this.attrs(), span };
    }
    if (this.eat("open")) {
      const name = this.expectKind("uident", "a module name").text;
      return { d: "open", name, span: this.from(start) };
    }
    if (this.is("let")) {
      this.i++;
      const rec = this.eat("rec");
      const name = this.valueName("a name").text;
      const params: Pat[] = [];
      while (!this.is("=")) params.push(this.patAtom());
      if (rec && params.length === 0) this.fail("'let rec' must define a function", start);
      this.expect("=");
      const body = this.expr();
      return { d: "let", rec, name, params, body, span: this.from(start) };
    }
    this.fail(`expected a declaration (let, type, external, open) but found '${this.tok.text}'`);
  }

  private typeDecl(start: Span): Decl {
    const params: string[] = [];
    if (this.tok.kind === "tyvar") params.push(this.toks[this.i++]!.text);
    else if (this.is("(") && this.peek().kind === "tyvar") {
      this.i++;
      do params.push(this.expectKind("tyvar", "a type variable").text);
      while (this.eat(","));
      this.expect(")");
    }
    const name = this.expectKind("lident", "a type name").text;
    let def: TypeDef = { kind: "abstract" };
    if (this.eat("=")) {
      if (this.is("{")) def = this.recordDef();
      else if (this.tok.kind === "uident" || this.is("|")) def = this.variantDef();
      else def = { kind: "alias", type: this.type() };
    }
    const span = this.from(start);
    return { d: "type", name, params, def, attrs: this.attrs(), span };
  }

  /** `[@@name]` / `[@@name "payload"]`, any number of them. */
  private attrs(): Attr[] {
    const out: Attr[] = [];
    while (this.is("[") && this.peek().text === "@" && this.peek(2).text === "@") {
      const start = this.tok.span;
      this.i += 3;
      const name = this.expectKind("lident", "an attribute name").text;
      const arg = this.tok.kind === "string" ? this.toks[this.i++]!.text : null;
      this.expect("]");
      out.push({ name, arg, span: this.from(start) });
    }
    return out;
  }

  private recordDef(): TypeDef {
    this.expect("{");
    const fields: { name: string; type: TypeExpr; span: Span }[] = [];
    while (!this.is("}")) {
      const t = this.expectKind("lident", "a field name");
      this.expect(":");
      fields.push({ name: t.text, type: this.type(), span: t.span });
      if (!this.eat(";")) break;
    }
    this.expect("}");
    return { kind: "record", fields };
  }

  private variantDef(): TypeDef {
    this.eat("|");
    const ctors: { name: string; arg: TypeExpr | null; span: Span }[] = [];
    do {
      const t = this.expectKind("uident", "a constructor name");
      const arg = this.eat("of") ? this.type() : null;
      ctors.push({ name: t.text, arg, span: t.span });
    } while (this.eat("|"));
    return { kind: "variant", ctors };
  }

  // -- types ----------------------------------------------------------------

  private type(): TypeExpr {
    const start = this.tok.span;
    const from = this.typeTuple();
    if (this.eat("->")) return { t: "fun", from, to: this.type(), span: this.from(start) };
    return from;
  }

  private typeTuple(): TypeExpr {
    const start = this.tok.span;
    const items = [this.typeApp()];
    while (this.eat("*")) items.push(this.typeApp());
    return items.length === 1 ? items[0]! : { t: "tuple", items, span: this.from(start) };
  }

  private typeApp(): TypeExpr {
    const start = this.tok.span;
    let args: TypeExpr[];
    if (this.eat("(")) {
      args = [this.type()];
      while (this.eat(",")) args.push(this.type());
      this.expect(")");
      if (args.length > 1 && this.tok.kind !== "lident") this.fail("expected a type constructor after type arguments");
    } else if (this.tok.kind === "tyvar") {
      const t = this.toks[this.i++]!;
      args = [{ t: "var", name: t.text, span: t.span }];
    } else {
      const t = this.expectKind("lident", "a type");
      args = [{ t: "con", name: t.text, args: [], span: t.span }];
    }
    let ty: TypeExpr = args[0]!;
    if (args.length > 1 || this.tok.kind === "lident") {
      // Postfix application: `int list`, `(k, v) map`, `'a val comp`
      let first = true;
      while (this.tok.kind === "lident") {
        const t = this.toks[this.i++]!;
        ty = { t: "con", name: t.text, args: first ? args : [ty], span: this.from(start) };
        first = false;
      }
    }
    return ty;
  }

  // -- patterns -------------------------------------------------------------

  private pat(): Pat {
    const start = this.tok.span;
    const items = [this.patCons()];
    while (this.eat(",")) items.push(this.patCons());
    return items.length === 1 ? items[0]! : { p: "tuple", items, span: this.from(start) };
  }

  private patCons(): Pat {
    const start = this.tok.span;
    const head = this.patApp();
    if (this.eat("::")) return { p: "cons", head, tail: this.patCons(), span: this.from(start) };
    return head;
  }

  private patApp(): Pat {
    if (this.tok.kind === "uident") {
      const t = this.toks[this.i++]!;
      const arg = this.startsPatAtom() ? this.patAtom() : null;
      return { p: "ctor", name: t.text, arg, span: this.from(t.span) };
    }
    return this.patAtom();
  }

  private startsPatAtom(): boolean {
    const t = this.tok;
    if (t.kind === "lident" || t.kind === "int" || t.kind === "float" || t.kind === "string" || t.kind === "uident") return true;
    if (t.kind === "kw") return t.text === "true" || t.text === "false";
    return t.kind === "op" && (t.text === "_" || t.text === "(" || t.text === "[");
  }

  private patAtom(): Pat {
    const t = this.tok;
    const span = t.span;
    switch (t.kind) {
      case "lident":
        this.i++;
        if (t.text.includes(".")) this.fail("qualified names can't be bound in patterns", span);
        return { p: "var", name: t.text, span };
      case "uident":
        this.i++;
        return { p: "ctor", name: t.text, arg: null, span };
      case "int":
        this.i++;
        return { p: "int", value: Number(t.text), span };
      case "float":
        this.i++;
        return { p: "float", value: Number(t.text), span };
      case "string":
        this.i++;
        return { p: "string", value: t.text, span };
    }
    if (this.eat("true")) return { p: "bool", value: true, span };
    if (this.eat("false")) return { p: "bool", value: false, span };
    if (this.eat("_")) return { p: "wild", span };
    if (this.is("-") && this.peek().kind === "int") {
      this.i++;
      const n = this.toks[this.i++]!;
      return { p: "int", value: -Number(n.text), span: this.from(span) };
    }
    if (this.eat("(")) {
      if (this.eat(")")) return { p: "unit", span: this.from(span) };
      const inner = this.pat();
      if (this.eat(":")) {
        const type = this.type();
        this.expect(")");
        return { p: "annot", pat: inner, type, span: this.from(span) };
      }
      this.expect(")");
      return inner;
    }
    if (this.eat("[")) {
      const items: Pat[] = [];
      while (!this.is("]")) {
        items.push(this.pat());
        if (!this.eat(";")) break;
      }
      this.expect("]");
      let out: Pat = { p: "nil", span: this.from(span) };
      for (let k = items.length - 1; k >= 0; k--) out = { p: "cons", head: items[k]!, tail: out, span: this.from(span) };
      return out;
    }
    this.fail(`expected a pattern but found '${t.text}'`);
  }

  // -- expressions ----------------------------------------------------------

  expr(): Expr {
    const start = this.tok.span;
    const first = this.binary(0);
    if (!this.is(",")) return first;
    const items = [first];
    while (this.eat(",")) items.push(this.binary(0));
    return { e: "tuple", items, span: this.from(start) };
  }

  private binary(minPrec: number): Expr {
    const start = this.tok.span;
    let left = this.unary();
    for (;;) {
      const t = this.tok;
      const info = (t.kind === "op" || (t.kind === "kw" && t.text === "mod")) ? BINOPS[t.text] : undefined;
      if (!info || info[0] < minPrec) return left;
      this.i++;
      const [prec, right] = info;
      const rhs = this.binary(right ? prec : prec + 1);
      const span = this.from(start);
      left =
        t.text === "|>"
          ? { e: "app", fn: rhs, args: [left], span }
          : { e: "binop", op: t.text, left, right: rhs, span };
    }
  }

  private unary(): Expr {
    const start = this.tok.span;
    if (this.is("-") || this.is("-.")) {
      const float = this.tok.text === "-.";
      this.i++;
      const arg = this.unary();
      if (arg.e === "int" && !float) return { ...arg, value: -arg.value, span: this.from(start) };
      if (arg.e === "float") return { ...arg, value: -arg.value, span: this.from(start) };
      return { e: "neg", float, arg, span: this.from(start) };
    }
    if (this.tok.kind === "kw") {
      switch (this.tok.text) {
        case "let":
          return this.letExpr();
        case "let*":
          return this.letStar();
        case "let+":
          return this.letPlus();
        case "fun":
          return this.funExpr();
        case "match":
        case "match*":
          return this.matchExpr();
        case "if":
          return this.ifExpr();
      }
    }
    return this.app();
  }

  private letExpr(): Expr {
    const start = this.expect("let").span;
    const rec = this.eat("rec");
    let pat: Pat;
    const params: Pat[] = [];
    const t = this.tok;
    if (this.isOpName()) {
      const n = this.valueName("a name");
      pat = { p: "var", name: n.text, span: n.span };
      while (!this.is("=")) params.push(this.patAtom());
    } else if (t.kind === "lident" && !this.peekIs(",") && !this.peekIs("::")) {
      this.i++;
      pat = { p: "var", name: t.text, span: t.span };
      while (!this.is("=")) params.push(this.patAtom());
    } else {
      pat = this.pat();
    }
    if (rec && (pat.p !== "var" || params.length === 0)) this.fail("'let rec' must define a function", start);
    this.expect("=");
    const value = this.expr();
    this.expect("in");
    const body = this.expr();
    return { e: "let", rec, pat, params, value, body, span: this.from(start) };
  }

  /** `( let* )`, `( let+ )`, ... used as an ordinary name. */
  private isOpName(): boolean {
    const next = this.peek();
    return this.is("(") && next.kind === "kw" && (BINDING_OPS as readonly string[]).includes(next.text) && this.peek(2).text === ")";
  }

  /** A value name: an identifier or a parenthesized binding operator. */
  private valueName(what: string): Token {
    if (this.isOpName()) {
      const open = this.toks[this.i]!;
      const op = this.toks[this.i + 1]!;
      this.i += 3;
      return { kind: "lident", text: op.text, span: this.from(open.span) };
    }
    return this.expectKind("lident", what);
  }

  private peekIs(text: string): boolean {
    const t = this.peek();
    return t.text === text && t.kind === "op";
  }

  private letStar(): Expr {
    const start = this.expect("let*").span;
    const pat = this.pat();
    this.expect("=");
    const value = this.expr();
    const ands: LetPlusBind[] = [];
    // `and*` (or plain `and`) combines computations with `( and* )`.
    while (this.eat("and*") || this.eat("and")) {
      const p = this.pat();
      this.expect("=");
      ands.push({ pat: p, value: this.expr() });
    }
    this.expect("in");
    const body = this.expr();
    return { e: "letstar", pat, value, ands, body, span: this.from(start) };
  }

  private letPlus(): Expr {
    const start = this.expect("let+").span;
    const binds: LetPlusBind[] = [];
    do {
      const pat = this.pat();
      this.expect("=");
      binds.push({ pat, value: this.expr() });
    } while (this.eat("and+") || this.eat("and"));
    this.expect("in");
    const body = this.expr();
    return { e: "letplus", binds, body, span: this.from(start) };
  }

  private funExpr(): Expr {
    const start = this.expect("fun").span;
    const params: Pat[] = [];
    while (!this.is("->")) params.push(this.patAtom());
    if (params.length === 0) this.fail("'fun' needs at least one parameter");
    this.expect("->");
    const body = this.expr();
    return { e: "fun", params, body, span: this.from(start) };
  }

  private matchExpr(): Expr {
    const start = this.tok.span;
    const star = this.tok.text === "match*";
    this.i++;
    const scrut = this.expr();
    this.expect("with");
    this.eat("|");
    const cases: Case[] = [];
    do {
      const pat = this.pat();
      const guard = this.eat("when") ? this.expr() : null;
      this.expect("->");
      cases.push({ pat, guard, body: this.expr() });
    } while (this.eat("|"));
    if (star && cases.some((c) => c.guard)) this.fail("'match*' cases can't have guards", start);
    return { e: star ? "matchstar" : "match", scrut, cases, span: this.from(start) };
  }

  private ifExpr(): Expr {
    const start = this.expect("if").span;
    const cond = this.expr();
    this.expect("then");
    const then = this.expr();
    this.expect("else", "'else' (every 'if' needs one)");
    const els = this.expr();
    return { e: "if", cond, then, else: els, span: this.from(start) };
  }

  private startsAtom(): boolean {
    const t = this.tok;
    switch (t.kind) {
      case "int":
      case "float":
      case "string":
      case "lident":
      case "uident":
        return true;
      case "kw":
        return t.text === "true" || t.text === "false";
      case "op":
        return t.text === "(" || t.text === "[" || t.text === "{";
      default:
        return false;
    }
  }

  private app(): Expr {
    const start = this.tok.span;
    const fn = this.postfix(true);
    const args: Expr[] = [];
    // In argument position a constructor doesn't take an argument: `f None 1`.
    while (this.startsAtom()) args.push(this.postfix(false));
    if (args.length === 0) return fn;
    return { e: "app", fn, args, span: this.from(start) };
  }

  private postfix(ctorArg = true): Expr {
    const start = this.tok.span;
    let e = this.atom(ctorArg);
    while (this.is(".") && this.peek().kind === "lident") {
      this.i++;
      const name = this.toks[this.i++]!.text;
      e = { e: "field", target: e, name, span: this.from(start) };
    }
    return e;
  }

  private atom(ctorArg = true): Expr {
    const t = this.tok;
    const span = t.span;
    // A qualified binding operator: `Rhizoid.( let* )`
    if (t.kind === "uident" && this.peekIs(".") && this.peek(2).text === "(") {
      const op = this.peek(3);
      if (op.kind === "kw" && (BINDING_OPS as readonly string[]).includes(op.text) && this.peek(4).text === ")") {
        this.i += 5;
        return { e: "var", name: `${t.text}.${op.text}`, span: this.from(span) };
      }
    }
    switch (t.kind) {
      case "int":
        this.i++;
        return { e: "int", value: Number(t.text), span };
      case "float":
        this.i++;
        return { e: "float", value: Number(t.text), span };
      case "string":
        this.i++;
        return { e: "string", value: t.text, span };
      case "lident":
        this.i++;
        return { e: "var", name: t.text, span };
      case "uident": {
        this.i++;
        const arg = ctorArg && this.startsAtom() ? this.postfix(false) : null;
        return { e: "ctor", name: t.text, arg, span: this.from(span) };
      }
    }
    if (this.eat("true")) return { e: "bool", value: true, span };
    if (this.eat("false")) return { e: "bool", value: false, span };
    if (this.isOpName()) {
      const n = this.valueName("a name");
      return { e: "var", name: n.text, span: n.span };
    }
    if (this.eat("(")) {
      if (this.eat(")")) return { e: "unit", span: this.from(span) };
      // Operator section: `(+)` is `fun a b -> a + b`
      const op = this.tok;
      if ((op.kind === "op" || op.text === "mod") && BINOPS[op.text] && op.text !== "|>" && this.peekIs(")")) {
        this.i += 2;
        const s = this.from(span);
        const v = (name: string): Expr => ({ e: "var", name, span: s });
        return {
          e: "fun",
          params: [{ p: "var", name: "$a", span: s }, { p: "var", name: "$b", span: s }],
          body: { e: "binop", op: op.text, left: v("$a"), right: v("$b"), span: s },
          span: s,
        };
      }
      const inner = this.expr();
      if (this.eat(":")) {
        const type = this.type();
        this.expect(")");
        return { e: "annot", expr: inner, type, span: this.from(span) };
      }
      this.expect(")");
      return inner;
    }
    if (this.eat("[")) {
      const items: Expr[] = [];
      while (!this.is("]")) {
        items.push(this.expr());
        if (!this.eat(";")) break;
      }
      this.expect("]");
      return { e: "list", items, span: this.from(span) };
    }
    if (this.eat("{")) {
      const isField = this.tok.kind === "lident" && this.peekIs("=");
      let base: Expr | null = null;
      if (!isField) {
        base = this.expr();
        this.expect("with", "'with' in record update");
      }
      const fields: { name: string; value: Expr }[] = [];
      while (!this.is("}")) {
        const name = this.expectKind("lident", "a field name").text;
        this.expect("=");
        fields.push({ name, value: this.binary(0) });
        if (!this.eat(";")) break;
      }
      this.expect("}");
      const s = this.from(span);
      return base ? { e: "update", base, fields, span: s } : { e: "record", fields, span: s };
    }
    this.fail(`expected an expression but found '${t.text}'`);
  }
}
