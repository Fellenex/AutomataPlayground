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
import { formatDiagnostic, type Diagnostic } from "./diagnostics";
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

/**
 * Structured counterpart to {@link ValidationResult}: the same pipeline output,
 * but with every error and warning kept as a positioned {@link Diagnostic}
 * (severity + line/col) instead of a pre-formatted string. The UI uses this to
 * drive the editor's linter gutter; {@link validateProgram} formats it to
 * strings for string-only consumers.
 */
export interface AnalysisResult {
  ok: boolean;
  /** Every diagnostic from the pipeline, sorted by source position. */
  diagnostics: Diagnostic[];
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
export { KEYWORDS, EXPR_RESERVED } from "./tokens";
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
 * Parse, validate, and expand a DSL program, keeping structured diagnostics.
 *
 * Runs lexing, recursive-descent parsing, strict validation, then expansion.
 * Any error at a stage short-circuits the rest; warnings already collected are
 * retained. On success `ok` is true and `graph` holds the expanded nodes and
 * edges. Diagnostics are returned as positioned {@link Diagnostic} objects,
 * sorted by source position, so callers (notably the editor's linter) can place
 * them precisely; {@link validateProgram} wraps this and formats them to strings.
 */
export function analyze(source: string): AnalysisResult {
  const warnings: Diagnostic[] = [];

  const sorted = (diags: Diagnostic[]): Diagnostic[] =>
    [...diags].sort((a, b) => a.line - b.line || a.col - b.col);

  // Lexer and parser diagnostics are always errors; they omit `severity`.
  const asErrors = (
    diags: { message: string; line: number; col: number }[],
  ): Diagnostic[] => diags.map((d) => ({ severity: "error" as const, ...d }));

  // Reject oversized source before lexing, so a huge paste fails immediately
  // rather than after building tokens/AST for it.
  if (source.length > LIMITS.maxSourceChars) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          message:
            `Source is too long: ${source.length} characters ` +
            `exceeds the limit of ${LIMITS.maxSourceChars}`,
          line: 1,
          col: 0,
        },
      ],
    };
  }

  const lex = tokenize(source);
  if (lex.errors.length > 0) {
    return { ok: false, diagnostics: sorted(asErrors(lex.errors)) };
  }

  const parsed = parseProgram(lex.tokens, source);
  if (parsed.errors.length > 0) {
    return { ok: false, diagnostics: sorted(asErrors(parsed.errors)) };
  }

  const diags = validate(parsed.program);
  warnings.push(...diags.warnings);
  if (diags.hasErrors) {
    return { ok: false, diagnostics: sorted([...warnings, ...diags.errors]) };
  }

  const { graph, diags: expansion } = expand(parsed.program, LIMITS);
  warnings.push(...expansion.warnings);
  if (expansion.hasErrors) {
    return {
      ok: false,
      diagnostics: sorted([...warnings, ...expansion.errors]),
    };
  }

  return { ok: true, diagnostics: sorted(warnings), graph };
}

/**
 * Parse, validate, and expand a DSL program into a concrete graph.
 *
 * String-formatted view of {@link analyze}: errors and warnings are rendered as
 * `line:col: message`. On success `ok` is true and `graph` holds the expanded
 * nodes and edges; any error at a stage leaves `graph` undefined.
 */
export function validateProgram(source: string): ValidationResult {
  const { ok, diagnostics, graph } = analyze(source);
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const d of diagnostics) {
    (d.severity === "error" ? errors : warnings).push(formatDiagnostic(d));
  }
  return { ok, errors, warnings, graph };
}
