// AST produced by the recursive-descent parser (see docs/GRAMMAR.md).
//
// Arithmetic is NOT parsed here. Every position where the grammar allows an
// arithmetic expression — range bounds, set members, `let` right-hand sides,
// instantiation arguments, and comprehension guards — is captured as a
// {@link RawExpr}: the verbatim token slice. The Pratt sub-parser (#6) turns a
// RawExpr into a real expression tree; the expander (#7) then evaluates it.

import type { Token } from "./tokens";

/** Source location, carried on every node for diagnostics. */
export interface Pos {
  line: number;
  col: number;
  offset: number;
}

/**
 * An un-parsed arithmetic expression: the exact tokens between two structural
 * delimiters, plus the source text they span. Free-variable analysis reads
 * {@link RawExpr.tokens}; #6 replaces this node with a parsed tree.
 */
export interface RawExpr {
  kind: "rawExpr";
  tokens: Token[];
  /** Verbatim source substring, for diagnostics and (later) re-parsing. */
  text: string;
  pos: Pos;
}

/** A source position of node ids: a single value, a set, or an inclusive range. */
export type NodeSet =
  | { kind: "single"; value: RawExpr; pos: Pos }
  | { kind: "set"; items: RawExpr[]; pos: Pos }
  | { kind: "range"; lo: RawExpr; hi: RawExpr; pos: Pos };

/** An edge label: symbols only (identifiers drawn from the `symbols` alphabet). */
export type LabelSpec =
  | { kind: "single"; sym: string; pos: Pos }
  | { kind: "set"; syms: string[]; pos: Pos }
  | { kind: "range"; lo: string; hi: string; pos: Pos };

export interface SymbolsDecl {
  kind: "symbols";
  /** Declaration order is significant (label ranges use it). */
  symbols: string[];
  pos: Pos;
}

export interface NodeTypesDecl {
  kind: "nodeTypes";
  types: string[];
  pos: Pos;
}

export interface NodeDecl {
  kind: "nodes";
  /** `[]` for a bare (untyped-mode) declaration; otherwise ≥1 classification. */
  types: string[];
  /** True when the source wrote a `[ ... ]` bracket, even if empty. */
  bracketed: boolean;
  nodes: NodeSet;
  pos: Pos;
}

export interface LetDecl {
  kind: "let";
  name: string;
  value: RawExpr;
  pos: Pos;
}

export interface ForBinding {
  name: string;
  range: NodeSet;
  pos: Pos;
}

export interface EdgeStmt {
  kind: "edge";
  src: NodeSet;
  label: LabelSpec;
  tgt: NodeSet;
  /** Present for a comprehension: `(...) for b in r, ... [if guard]`. */
  comprehension?: {
    bindings: ForBinding[];
    guard?: RawExpr;
  };
  pos: Pos;
}

export type BodyStmt =
  | SymbolsDecl
  | NodeTypesDecl
  | NodeDecl
  | LetDecl
  | EdgeStmt;

export interface GraphDef {
  kind: "graph";
  name: string;
  params: string[];
  body: BodyStmt[];
  pos: Pos;
}

export interface Instantiation {
  kind: "instantiate";
  name: string;
  args: RawExpr[];
  pos: Pos;
}

export type Item = GraphDef | Instantiation;

export interface Program {
  items: Item[];
}
