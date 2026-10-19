export interface Span {
  file: string;
  start: number;
  end: number;
}

export class MossError extends Error {
  constructor(message: string, readonly span: Span | undefined) {
    super(message);
  }
}

export const sources = new Map<string, string>();

/** Render an error with the offending line and a caret underline. */
export function formatError(e: MossError): string {
  if (!e.span) return `error: ${e.message}`;
  const src = sources.get(e.span.file);
  if (src === undefined) return `${e.span.file}: error: ${e.message}`;
  const before = src.slice(0, e.span.start);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  let lineEnd = src.indexOf("\n", lineStart);
  if (lineEnd < 0) lineEnd = src.length;
  const col = e.span.start - lineStart;
  const width = Math.max(1, Math.min(e.span.end, lineEnd) - e.span.start);
  const gutter = String(line).length;
  return [
    `${e.span.file}:${line}:${col + 1}: error: ${e.message}`,
    `${" ".repeat(gutter)} |`,
    `${line} | ${src.slice(lineStart, lineEnd)}`,
    `${" ".repeat(gutter)} | ${" ".repeat(col)}${"^".repeat(width)}`,
  ].join("\n");
}
