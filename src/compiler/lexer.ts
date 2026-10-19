import { MossError, type Span } from "./errors.ts";

export type TokKind =
  | "int"
  | "float"
  | "string"
  | "lident" // lowercase identifier, possibly qualified: `x`, `List.map`
  | "uident" // constructor / module: `Some`
  | "tyvar" // 'a
  | "kw"
  | "op"
  | "eof";

export interface Token {
  kind: TokKind;
  text: string;
  span: Span;
}

const KEYWORDS = new Set([
  "let", "let*", "let+", "rec", "in", "and", "and*", "and+", "fun", "match", "match*", "with", "when", "if", "then",
  "else", "type", "of", "component", "app", "external", "open", "true", "false", "mod",
]);

// Longest first.
const OPS = [
  "->", "|>", "::", "&&", "||", "<=", ">=", "<>", "==", "+.", "-.", "*.", "/.",
  "+", "-", "*", "/", "^", "@", "=", "<", ">", "|", ";", ",", ".", ":", "(", ")", "[", "]", "{", "}", "_",
];

const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
const isId = (c: string) => /[A-Za-z0-9_']/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

export function lex(src: string, file: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const span = (start: number): Span => ({ file, start, end: i });
  const push = (kind: TokKind, text: string, start: number) => toks.push({ kind, text, span: span(start) });

  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // (* nested comments *)
    if (c === "(" && src[i + 1] === "*") {
      const start = i;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "(" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === ")") {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      if (depth !== 0) throw new MossError("unterminated comment", span(start));
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      while (i < src.length && (isDigit(src[i]!) || src[i] === "_")) i++;
      let kind: TokKind = "int";
      if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
        kind = "float";
        i++;
        while (i < src.length && isDigit(src[i]!)) i++;
      }
      const text = src.slice(start, i).replaceAll("_", "");
      if (kind === "int" && !Number.isSafeInteger(Number(text))) {
        throw new MossError(`integer literal ${text} is too large (ints are exact up to 2^53 - 1)`, span(start));
      }
      push(kind, text, start);
      continue;
    }
    if (c === '"') {
      i++;
      let s = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          const e = src[i + 1] ?? "";
          const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
          if (!(e in ESC)) throw new MossError(`unknown escape '\\${e}' (use \\n \\t \\r \\" or \\\\)`, { file, start: i, end: i + 2 });
          s += ESC[e];
          i += 2;
        } else s += src[i++];
      }
      if (src[i] !== '"') throw new MossError("unterminated string", span(start));
      i++;
      push("string", s, start);
      continue;
    }
    if (c === "'" && /[a-z]/.test(src[i + 1] ?? "")) {
      i++;
      while (i < src.length && isId(src[i]!)) i++;
      push("tyvar", src.slice(start + 1, i), start);
      continue;
    }
    if (isIdStart(c) && !(c === "_" && !isId(src[i + 1] ?? " "))) {
      while (i < src.length && isId(src[i]!)) i++;
      let text = src.slice(start, i);
      // Qualified names: `List.map` (value or type), `Todo.Add` (constructor)
      if (/^[A-Z]/.test(text) && src[i] === "." && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
        i++;
        while (i < src.length && isId(src[i]!)) i++;
        const name = src.slice(start, i);
        push(/^[A-Z]/.test(name.slice(name.indexOf(".") + 1)) ? "uident" : "lident", name, start);
        continue;
      }
      // `let*`, `let+`, `match*`
      // Binding operators: `let*`, `let+`, `and*`, `and+`, `match*`
      if (
        (text === "let" || text === "and" || text === "match") &&
        (src[i] === "*" || (text !== "match" && src[i] === "+"))
      ) {
        text += src[i++];
      }
      if (KEYWORDS.has(text)) push("kw", text, start);
      else push(/^[A-Z]/.test(text) ? "uident" : "lident", text, start);
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      push("op", op, start);
      continue;
    }
    throw new MossError(`unexpected character '${c}'`, { file, start, end: start + 1 });
  }
  toks.push({ kind: "eof", text: "<eof>", span: { file, start: i, end: i } });
  return toks;
}
