// Strict static validation for nfa-lang (see docs/GRAMMAR.md §Static semantics).
//
// Runs on the AST from parser.ts and reports errors + warnings. Scope covers
// everything checkable without evaluating arithmetic (that is #6) or expanding
// the product (that is #7): alphabet membership, the two node modes,
// declared-before-use ordering, all-free-variables-bound, the let-overrides-
// param warning, and structural dedup/hygiene warnings.

import type {
  EdgeStmt,
  GraphDef,
  Instantiation,
  LabelSpec,
  NodeDecl,
  NodeSet,
  Program,
  RawExpr,
} from "./ast";
import { Diagnostics } from "./diagnostics";
import type { Token } from "./tokens";
import { EXPR_RESERVED, KEYWORDS } from "./tokens";

export function validate(program: Program): Diagnostics {
  const diags = new Diagnostics();

  // Graphs are usable only after their definition (declared-before-use).
  const defined = new Map<string, GraphDef>();

  for (const item of program.items) {
    if (item.kind === "graph") {
      if (defined.has(item.name)) {
        diags.error(`Duplicate graph '${item.name}'`, item);
      } else {
        validateGraph(item, diags);
        defined.set(item.name, item);
      }
    } else {
      validateInstantiation(item, defined, diags);
    }
  }

  return diags;
}

// ---- graphs ----------------------------------------------------------------

function validateGraph(g: GraphDef, diags: Diagnostics): void {
  // Union the declared alphabets up front (they must precede use, checked
  // below). Symbols and node types are constants available inside guards.
  const symbols = new Set<string>();
  const nodeTypes = new Set<string>();
  let nodeTypesDeclared = false;
  let sawSymbolsDecl = false;
  let sawNodeTypesDecl = false;
  let sawNodeOrEdge = false;

  for (const stmt of g.body) {
    if (stmt.kind === "symbols") {
      if (sawNodeOrEdge) {
        diags.error("'symbols' must be declared before any nodes or edges", stmt);
      }
      if (sawSymbolsDecl) {
        diags.warning("Duplicate 'symbols' declaration", stmt);
      }
      sawSymbolsDecl = true;
      for (const s of stmt.symbols) {
        if (symbols.has(s)) {
          diags.warning(`Duplicate symbol '${s}'`, stmt);
        }
        symbols.add(s);
      }
    } else if (stmt.kind === "nodeTypes") {
      if (sawNodeOrEdge) {
        diags.error(
          "'nodeTypes' must be declared before any nodes or edges",
          stmt,
        );
      }
      if (sawNodeTypesDecl) {
        diags.warning("Duplicate 'nodeTypes' declaration", stmt);
      }
      sawNodeTypesDecl = true;
      nodeTypesDeclared = true;
      for (const t of stmt.types) {
        if (nodeTypes.has(t)) {
          diags.warning(`Duplicate node type '${t}'`, stmt);
        }
        nodeTypes.add(t);
      }
    } else if (stmt.kind === "nodes" || stmt.kind === "edge") {
      sawNodeOrEdge = true;
    }
  }

  // Typed mode iff a non-empty nodeTypes alphabet was declared.
  const typedMode = nodeTypesDeclared && nodeTypes.size > 0;
  const constants = new Set<string>([...symbols, ...nodeTypes]);

  // Scope accumulates as `let`s appear; params seed it.
  const paramSet = new Set(g.params);
  const bound = new Set(g.params);
  const seenParams = new Set<string>();
  for (const name of g.params) {
    if (seenParams.has(name)) {
      diags.warning(`Duplicate parameter '${name}'`, g);
    }
    seenParams.add(name);
  }

  for (const stmt of g.body) {
    switch (stmt.kind) {
      case "symbols":
      case "nodeTypes":
        break;

      case "nodes": {
        validateNodeMode(stmt, typedMode, nodeTypes, diags);
        checkNodeSetVars(stmt.nodes, bound, constants, diags);
        break;
      }

      case "let": {
        checkExprVars(stmt.value, bound, constants, diags);
        if (paramSet.has(stmt.name)) {
          diags.warning(
            `'let ${stmt.name}' overrides parameter '${stmt.name}' (dead parameter)`,
            stmt,
          );
        }
        bound.add(stmt.name);
        break;
      }

      case "edge": {
        validateEdge(stmt, bound, constants, symbols, diags);
        break;
      }
    }
  }
}

// ---- node declarations -----------------------------------------------------

function validateNodeMode(
  stmt: NodeDecl,
  typedMode: boolean,
  nodeTypes: Set<string>,
  diags: Diagnostics,
): void {
  if (typedMode) {
    if (!stmt.bracketed || stmt.types.length === 0) {
      diags.error(
        "Typed mode: every 'nodes' declaration needs a bracketed classification with at least one type",
        stmt,
      );
    }
    const seen = new Set<string>();
    for (const t of stmt.types) {
      if (!nodeTypes.has(t)) {
        diags.error(`Unknown node type '${t}' (not in nodeTypes)`, stmt);
      }
      if (seen.has(t)) {
        diags.warning(`Redundant node type '${t}' in classification`, stmt);
      }
      seen.add(t);
    }
  } else {
    if (stmt.bracketed) {
      if (stmt.types.length > 0) {
        diags.error(
          `Untyped mode: cannot classify nodes as '${stmt.types[0]}' (no nodeTypes declared)`,
          stmt,
        );
      } else {
        diags.error(
          "Untyped mode: empty '[]' classification is not allowed; use a bare 'nodes' declaration",
          stmt,
        );
      }
    }
  }
}

// ---- edges -----------------------------------------------------------------

function validateEdge(
  stmt: EdgeStmt,
  baseBound: Set<string>,
  constants: Set<string>,
  symbols: Set<string>,
  diags: Diagnostics,
): void {
  validateLabel(stmt.label, symbols, diags);

  // Comprehension bindings extend scope left-to-right; a later range may read an
  // earlier binding. The guard and triple positions see every binding.
  const bound = new Set(baseBound);
  if (stmt.comprehension) {
    for (const b of stmt.comprehension.bindings) {
      checkNodeSetVars(b.range, bound, constants, diags);
      bound.add(b.name);
    }
  }

  checkNodeSetVars(stmt.src, bound, constants, diags);
  checkNodeSetVars(stmt.tgt, bound, constants, diags);
  if (stmt.comprehension?.guard) {
    checkExprVars(stmt.comprehension.guard, bound, constants, diags);
  }
}

function validateLabel(
  label: LabelSpec,
  symbols: Set<string>,
  diags: Diagnostics,
): void {
  const check = (sym: string): void => {
    if (!symbols.has(sym)) {
      diags.error(`Unknown symbol '${sym}' (not in symbols)`, label);
    }
  };
  if (label.kind === "single") {
    check(label.sym);
  } else if (label.kind === "set") {
    const seen = new Set<string>();
    for (const s of label.syms) {
      check(s);
      if (seen.has(s)) diags.warning(`Redundant label '${s}' in set`, label);
      seen.add(s);
    }
  } else {
    check(label.lo);
    check(label.hi);
  }
}

// ---- instantiation ---------------------------------------------------------

function validateInstantiation(
  inst: Instantiation,
  defined: Map<string, GraphDef>,
  diags: Diagnostics,
): void {
  const g = defined.get(inst.name);
  if (!g) {
    diags.error(
      `Unknown graph '${inst.name}' (not defined before use)`,
      inst,
    );
  } else if (inst.args.length !== g.params.length) {
    diags.error(
      `Graph '${inst.name}' expects ${g.params.length} argument(s) but got ${inst.args.length}`,
      inst,
    );
  }
  // Top-level arguments have no binding environment: only literals/arithmetic.
  const empty = new Set<string>();
  for (const arg of inst.args) {
    checkExprVars(arg, empty, empty, diags);
  }
}

// ---- free-variable analysis ------------------------------------------------

function checkNodeSetVars(
  set: NodeSet,
  bound: Set<string>,
  constants: Set<string>,
  diags: Diagnostics,
): void {
  if (set.kind === "single") {
    checkExprVars(set.value, bound, constants, diags);
  } else if (set.kind === "set") {
    for (const item of set.items) checkExprVars(item, bound, constants, diags);
  } else {
    checkExprVars(set.lo, bound, constants, diags);
    checkExprVars(set.hi, bound, constants, diags);
  }
}

/**
 * Every identifier in `expr` must be a bound variable, a declared constant
 * (symbol/node type, for guards), a reserved word, or a keyword. Anything else
 * is an unbound free variable (e.g. the classic unbound `m`).
 */
function checkExprVars(
  expr: RawExpr,
  bound: Set<string>,
  constants: Set<string>,
  diags: Diagnostics,
): void {
  for (const tok of expr.tokens) {
    if (tok.kind !== "ident") continue;
    const name = tok.text;
    if (
      bound.has(name) ||
      constants.has(name) ||
      EXPR_RESERVED.has(name) ||
      KEYWORDS.has(name)
    ) {
      continue;
    }
    diags.error(`Unbound variable '${name}'`, tokenPos(tok));
  }
}

// ---- helpers ---------------------------------------------------------------

function tokenPos(tok: Token): { pos: { line: number; col: number } } {
  return { pos: { line: tok.line, col: tok.col } };
}
