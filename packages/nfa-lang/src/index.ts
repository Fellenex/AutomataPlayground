// @automata/nfa-lang — shared parser + expander for the NFA DSL.
//
// This is the package shell. The grammar (see docs/GRAMMAR.md) is intentionally
// NOT implemented yet — `validateProgram` returns a not-implemented result so
// both the web client and the server can already import and wire against it.

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

/**
 * Parse, validate, and expand a DSL program into a concrete node/edge list.
 *
 * TODO: implement per docs/GRAMMAR.md
 *   - recursive-descent parser (+ Pratt sub-parser for arithmetic exprs)
 *   - alphabet/classification validation (strict)
 *   - cartesian-product expansion with dedup + hygiene warnings
 *   - LIMITS enforcement
 */
export function validateProgram(_source: string): ValidationResult {
  return {
    ok: false,
    errors: ["nfa-lang: parser not implemented yet"],
    warnings: [],
  };
}
