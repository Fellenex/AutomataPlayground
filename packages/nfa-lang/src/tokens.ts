// Token definitions for the nfa-lang lexer (see docs/GRAMMAR.md).

/**
 * All token kinds produced by {@link tokenize}. Structural punctuation and the
 * arithmetic/comparison operators are separate kinds so the Pratt sub-parser
 * can consume the operator tokens that the structural parser only captures
 * verbatim inside raw expression spans.
 */
export type TokenKind =
  | "ident"
  | "number"
  | "lbrace" // {
  | "rbrace" // }
  | "lbracket" // [
  | "rbracket" // ]
  | "lparen" // (
  | "rparen" // )
  | "comma" // ,
  | "colon" // :
  | "dotdot" // ..
  | "eq" // =
  | "plus" // +
  | "minus" // -
  | "star" // *
  | "percent" // %
  | "lt" // <
  | "gt" // >
  | "le" // <=
  | "ge" // >=
  | "eqeq" // ==
  | "ne" // !=
  | "newline"
  | "eof";

export interface Token {
  kind: TokenKind;
  /** Exact source lexeme (empty for synthetic `newline`/`eof`). */
  text: string;
  /** 1-based line number of the first character. */
  line: number;
  /** 0-based column of the first character on its line. */
  col: number;
  /** 0-based byte offset of the first character in the source. */
  offset: number;
}

/** Structural keywords — reserved idents the parser dispatches on. */
export const KEYWORDS = new Set([
  "graph",
  "symbols",
  "nodeTypes",
  "nodes",
  "let",
  "for",
  "if",
  "in",
]);

/**
 * Words that read as identifiers but are *not* free variables: guard/expression
 * operators and the `class(...)` membership function. Free-variable analysis
 * (see validate.ts) skips these so a guard like `u in class(i)` is not mistaken
 * for a reference to unbound variables `in`/`class`.
 */
export const EXPR_RESERVED = new Set(["and", "or", "not", "in", "class"]);
