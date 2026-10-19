import type { Span } from "./errors.ts";
import type { Type } from "./types.ts";

// ---------------------------------------------------------------------------
// Type syntax

export type TypeExpr =
  | { t: "var"; name: string; span: Span }
  | { t: "con"; name: string; args: TypeExpr[]; span: Span }
  | { t: "fun"; from: TypeExpr; to: TypeExpr; span: Span }
  | { t: "tuple"; items: TypeExpr[]; span: Span };

// ---------------------------------------------------------------------------
// Patterns

export type Pat =
  | { p: "wild"; span: Span }
  | { p: "var"; name: string; span: Span }
  | { p: "int"; value: number; span: Span }
  | { p: "float"; value: number; span: Span }
  | { p: "string"; value: string; span: Span }
  | { p: "bool"; value: boolean; span: Span }
  | { p: "unit"; span: Span }
  | { p: "tuple"; items: Pat[]; span: Span }
  | { p: "ctor"; name: string; arg: Pat | null; span: Span; resolved?: string }
  | { p: "nil"; span: Span }
  | { p: "cons"; head: Pat; tail: Pat; span: Span }
  | { p: "annot"; pat: Pat; type: TypeExpr; span: Span };

// ---------------------------------------------------------------------------
// Expressions

export interface Case {
  pat: Pat;
  guard: Expr | null;
  body: Expr;
}

/** Names of the binding operators, usable as `( let* )` etc. */
export const BINDING_OPS = ["let*", "let+", "and*", "and+", "match*"] as const;

export interface LetPlusBind {
  pat: Pat;
  value: Expr;
}

interface Base {
  span: Span;
  /** Filled in by the type checker. */
  ty?: Type;
}

export type Expr = Base &
  (
    | { e: "int"; value: number }
    | { e: "float"; value: number }
    | { e: "string"; value: string }
    | { e: "bool"; value: boolean }
    | { e: "unit" }
    | {
        e: "var";
        name: string;
        /** Qualified global name, set by the type checker for module-level references. */
        resolved?: string;
      }
    | { e: "ctor"; name: string; arg: Expr | null; resolved?: string }
    | { e: "app"; fn: Expr; args: Expr[] }
    | { e: "fun"; params: Pat[]; body: Expr }
    | { e: "let"; rec: boolean; pat: Pat; params: Pat[]; value: Expr; body: Expr }
    | {
        e: "letstar";
        pat: Pat;
        value: Expr;
        ands: LetPlusBind[];
        body: Expr;
        /** Desugared except for its tuple pattern, which the type checker resolves (see desugar.ts). */
        deferred?: boolean;
      }
    | { e: "letplus"; binds: LetPlusBind[]; body: Expr }
    | { e: "if"; cond: Expr; then: Expr; else: Expr }
    | {
        e: "match";
        scrut: Expr;
        cases: Case[];
        /** How to name this match in diagnostics (desugared `match*` keeps its name). */
        label?: string;
        /** Compiler-generated: skip exhaustiveness and redundancy checks. */
        generated?: boolean;
      }
    | { e: "matchstar"; scrut: Expr; cases: Case[] }
    | { e: "tuple"; items: Expr[] }
    | { e: "list"; items: Expr[] }
    | { e: "record"; fields: { name: string; value: Expr }[] }
    | { e: "update"; base: Expr; fields: { name: string; value: Expr }[] }
    | { e: "field"; target: Expr; name: string }
    | { e: "binop"; op: string; left: Expr; right: Expr; operandTy?: Type }
    | { e: "neg"; float: boolean; arg: Expr }
    | { e: "annot"; expr: Expr; type: TypeExpr }
  );

// ---------------------------------------------------------------------------
// Declarations

export type TypeDef =
  | { kind: "abstract" }
  | { kind: "alias"; type: TypeExpr }
  | { kind: "variant"; ctors: { name: string; arg: TypeExpr | null; span: Span }[] }
  | { kind: "record"; fields: { name: string; type: TypeExpr; span: Span }[] };

/** Every declaration records the module it belongs to (set by the loader). */
export type Decl = { mod?: string } & (
  | { d: "type"; name: string; params: string[]; def: TypeDef; span: Span }
  | { d: "let"; rec: boolean; name: string; params: Pat[]; body: Expr; component: boolean; span: Span }
  | { d: "external"; name: string; type: TypeExpr; js: string; span: Span }
  | { d: "open"; name: string; span: Span }
  | { d: "app"; expr: Expr; span: Span }
);

/** All modules' declarations, in dependency order (Prelude first, the entry module last). */
export interface Program {
  decls: Decl[];
  /** The entry module's name. */
  entry?: string;
}

/** The implicitly opened module whose names are global (unqualified). */
export const PRELUDE = "Prelude";

/** Global name of `name` defined in module `mod`. */
export const qualify = (mod: string, name: string): string => (mod === PRELUDE ? name : `${mod}.${name}`);
