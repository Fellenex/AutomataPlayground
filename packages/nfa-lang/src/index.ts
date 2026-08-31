// @automata/nfa-lang — shared parser + expander for the NFA DSL.
//
// This issue (#5) implements the structural front-end: lexer -> recursive-
// descent parser (AST, with arithmetic captured verbatim for the Pratt
// sub-parser in #6) -> strict validation. Arithmetic parsing (#6), product
// expansion (#7), and LIMITS enforcement (#8) land in follow-ups, so a
// structurally valid program reports "expansion not implemented yet" rather
// than returning a concrete graph.

import { tokenize } from "./lexer";
import { parseProgram } from "./parser";
import { validate } from "./validate";
import { formatDiagnostic } from "./diagnostics";

/** A node after expansion: a numeric id plus its merged classification set. */
export interface ExpandedNode {
  id: number;
  types: string[];
}

/** An edge after expansion: a concrete (src, label, tgt) triple. */
export interface ExpandedEdge {
  src: number;
  label: string;
  tgt: number;
}

export interface ExpandedGraph {
  nodes: ExpandedNode[];
  edges: ExpandedEdge[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Present only when `ok` is true. */
  graph?: ExpandedGraph;
}

/** Hard ceilings enforced during expansion to prevent blowup (e.g. `G(1000000)`). */
export const LIMITS = {
  maxSourceChars: 20_000,
  maxNodes: 5_000,
  maxEdges: 50_000,
} as const;

// Re-export the front-end building blocks so consumers (and tests) can use them
// directly, and so the follow-up issues can compose against a stable surface.
export { tokenize } from "./lexer";
export { parseProgram } from "./parser";
export { validate } from "./validate";
export type { Token, TokenKind } from "./tokens";
export type * from "./ast";
export type { Diagnostic, Severity } from "./diagnostics";

/**
 * Parse and validate a DSL program's structure.
 *
 * Runs lexing, recursive-descent parsing, and strict validation, surfacing all
 * errors and warnings. Expansion into a concrete `graph` is not implemented yet
 * (see #6/#7), so even a fully valid program currently reports `ok: false` with
 * a single "expansion not implemented" error.
 */
export function validateProgram(source: string): ValidationResult {
  const warnings: string[] = [];

  const lex = tokenize(source);
  if (lex.errors.length > 0) {
    return { ok: false, errors: lex.errors.map(formatDiagnostic), warnings };
  }

  const parsed = parseProgram(lex.tokens, source);
  if (parsed.errors.length > 0) {
    return { ok: false, errors: parsed.errors.map(formatDiagnostic), warnings };
  }

  const diags = validate(parsed.program);
  warnings.push(...diags.warnings.map(formatDiagnostic));
  if (diags.hasErrors) {
    return { ok: false, errors: diags.errors.map(formatDiagnostic), warnings };
  }

  // Front-end is clean; the expander (#7) is not wired up yet.
  return {
    ok: false,
    errors: ["nfa-lang: expansion not implemented yet (see #7)"],
    warnings,
  };
}
