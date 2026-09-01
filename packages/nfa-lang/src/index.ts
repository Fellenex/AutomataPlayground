// @automata/nfa-lang — shared parser + expander for the NFA DSL.
//
// Pipeline: lexer -> recursive-descent parser (AST, with arithmetic expressions
// parsed by the Pratt sub-parser) -> strict validation -> expansion into a
// concrete `ExpandedGraph` (cartesian product, comprehensions, instantiation).
// Expansion is bounded by the shared `LIMITS` ceilings (see `./limits`).

import { tokenize } from "./lexer";
import { parseProgram } from "./parser";
import { validate } from "./validate";
import { expand } from "./expand";
import { formatDiagnostic } from "./diagnostics";
import { LIMITS } from "./limits";

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

// Re-export the front-end building blocks so consumers (and tests) can use them
// directly, and so the follow-up issues can compose against a stable surface.
export { tokenize } from "./lexer";
export { parseProgram } from "./parser";
export { validate } from "./validate";
export { expand } from "./expand";
export type { ExpandResult } from "./expand";
export { LIMITS } from "./limits";
export type { Limits } from "./limits";
export { parseExpr, evaluate, evaluateGuard, EvalError } from "./expr";
export type {
  Expr,
  NumLit,
  VarRef,
  UnaryExpr,
  BinaryExpr,
  CallExpr,
  UnaryOp,
  BinaryOp,
  Env,
  ClassEnv,
  ParseExprResult,
} from "./expr";
export type { Token, TokenKind } from "./tokens";
export type * from "./ast";
export type { Diagnostic, Severity } from "./diagnostics";

/**
 * Parse, validate, and expand a DSL program into a concrete graph.
 *
 * Runs lexing, recursive-descent parsing, strict validation, then expansion,
 * surfacing every error and warning. On success `ok` is true and `graph` holds
 * the expanded nodes and edges; any error at a stage short-circuits the rest and
 * leaves `graph` undefined.
 */
export function validateProgram(source: string): ValidationResult {
  const warnings: string[] = [];

  // Reject oversized source before lexing, so a huge paste fails immediately
  // rather than after building tokens/AST for it.
  if (source.length > LIMITS.maxSourceChars) {
    return {
      ok: false,
      errors: [
        `Source is too long: ${source.length} characters ` +
          `exceeds the limit of ${LIMITS.maxSourceChars}`,
      ],
      warnings,
    };
  }

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

  const { graph, diags: expansion } = expand(parsed.program, LIMITS);
  warnings.push(...expansion.warnings.map(formatDiagnostic));
  if (expansion.hasErrors) {
    return {
      ok: false,
      errors: expansion.errors.map(formatDiagnostic),
      warnings,
    };
  }

  return { ok: true, errors: [], warnings, graph };
}
