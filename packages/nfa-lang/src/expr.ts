// Precedence-climbing (Pratt) sub-parser + evaluator for nfa-lang expressions
// (see docs/GRAMMAR.md). This is the "expression half" of the grammar; the
// recursive-descent parser (parser.ts) captures the verbatim token slice of
// every expression as a RawExpr, and this module turns that slice into a real
// {@link Expr} tree.
//
// Grammar (lowest to highest binding power):
//   or          left       a or b
//   and         left       a and b
//   not         prefix     not a
//   comparison  left       < <= > >= == != in
//   additive    left       + -
//   multiplic.  left       * %
//   unary       prefix     -
//   primary                number | var | class(args) | ( expr )
//
// Arithmetic (`+ - * %`, unary `-`, parens) is the core the issue asks for;
// comparisons, boolean connectives, and `in class(...)` are here so that
// comprehension *guards* parse into the same tree. Evaluation (see {@link
// evaluate}) covers arithmetic, comparison, and boolean logic under a numeric
// binding environment; `in`/`class(...)` membership is deferred to the expander
// (#7), which owns the classification environment.

import type { Pos } from "./ast";
import type { Token } from "./tokens";

// ---- expression AST --------------------------------------------------------

export type UnaryOp = "-" | "not";
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "%"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "and"
  | "or"
  | "in";

export interface NumLit {
  kind: "num";
  value: number;
  pos: Pos;
}

export interface VarRef {
  kind: "var";
  name: string;
  pos: Pos;
}

export interface UnaryExpr {
  kind: "unary";
  op: UnaryOp;
  operand: Expr;
  pos: Pos;
}

export interface BinaryExpr {
  kind: "binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
  pos: Pos;
}

/** A function-style application; today only `class(node)` is meaningful. */
export interface CallExpr {
  kind: "call";
  callee: string;
  args: Expr[];
  pos: Pos;
}

export type Expr = NumLit | VarRef | UnaryExpr | BinaryExpr | CallExpr;

export interface ExprDiagnostic {
  message: string;
  line: number;
  col: number;
}

export interface ParseExprResult {
  /** The parsed tree, or null when parsing failed (see `errors`). */
  expr: Expr | null;
  errors: ExprDiagnostic[];
}

// ---- operator tables -------------------------------------------------------

/**
 * Map an infix token to its {@link BinaryOp} spelling and left binding power, or
 * undefined if the token is not an infix operator. Tiers, lowest to highest:
 * or(1) < and(2) < comparison(3) < additive(4) < multiplicative(5).
 */
function infixOp(tok: Token): { op: BinaryOp; lbp: number } | undefined {
  switch (tok.kind) {
    case "lt":
      return { op: "<", lbp: 3 };
    case "le":
      return { op: "<=", lbp: 3 };
    case "gt":
      return { op: ">", lbp: 3 };
    case "ge":
      return { op: ">=", lbp: 3 };
    case "eqeq":
      return { op: "==", lbp: 3 };
    case "ne":
      return { op: "!=", lbp: 3 };
    case "plus":
      return { op: "+", lbp: 4 };
    case "minus":
      return { op: "-", lbp: 4 };
    case "star":
      return { op: "*", lbp: 5 };
    case "percent":
      return { op: "%", lbp: 5 };
    case "ident":
      if (tok.text === "or") return { op: "or", lbp: 1 };
      if (tok.text === "and") return { op: "and", lbp: 2 };
      if (tok.text === "in") return { op: "in", lbp: 3 };
      return undefined;
    default:
      return undefined;
  }
}

/** Binding power a prefix unary operator applies to its operand. */
const UNARY_BP = 6; // `-`, tighter than `*`/`%`
const NOT_BP = 3; // `not`, looser than comparison so `not a in b` = not (a in b)

/** Internal control-flow signal for a malformed expression. */
class ExprParseError extends Error {
  constructor(readonly diag: ExprDiagnostic) {
    super(diag.message);
  }
}

// ---- parser ----------------------------------------------------------------

/**
 * Parse a slice of tokens into an {@link Expr} tree. `tokens` is the verbatim
 * slice captured by the structural parser (a RawExpr's `tokens`), and must NOT
 * include the terminating newline/eof. Returns `{ expr: null, errors }` on any
 * syntax error rather than throwing.
 */
export function parseExpr(tokens: Token[]): ParseExprResult {
  const parser = new ExprParser(tokens);
  try {
    const expr = parser.parse();
    return { expr, errors: [] };
  } catch (e) {
    if (e instanceof ExprParseError) return { expr: null, errors: [e.diag] };
    throw e;
  }
}

class ExprParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private posOf(t: Token): Pos {
    return { line: t.line, col: t.col, offset: t.offset };
  }

  private fail(message: string, tok?: Token): never {
    const at = tok ?? this.tokens[this.tokens.length - 1];
    const line = at ? at.line : 1;
    // Point just past the last token when we ran off the end.
    const col = tok ? tok.col : at ? at.col + at.text.length : 0;
    throw new ExprParseError({ message, line, col });
  }

  parse(): Expr {
    if (this.tokens.length === 0) this.fail("Expected an expression");
    const expr = this.parseBinding(0);
    const rest = this.peek();
    if (rest) {
      this.fail(`Unexpected '${rest.text}' after expression`, rest);
    }
    return expr;
  }

  /** Precedence climbing: parse operators whose left binding power ≥ `minBp`. */
  private parseBinding(minBp: number): Expr {
    let left = this.parsePrefix();

    for (;;) {
      const tok = this.peek();
      if (!tok) break;
      const info = infixOp(tok);
      if (!info || info.lbp < minBp) break;

      this.advance();
      // All infix operators here are left-associative: parse the right operand
      // at one tier higher so an equal-precedence operator binds to the left.
      const right = this.parseBinding(info.lbp + 1);
      left = {
        kind: "binary",
        op: info.op,
        left,
        right,
        pos: left.pos,
      };
    }

    return left;
  }

  private parsePrefix(): Expr {
    const tok = this.peek();
    if (!tok) this.fail("Expected an expression");

    if (tok.kind === "minus") {
      this.advance();
      const operand = this.parseBinding(UNARY_BP);
      return { kind: "unary", op: "-", operand, pos: this.posOf(tok) };
    }
    if (tok.kind === "ident" && tok.text === "not") {
      this.advance();
      const operand = this.parseBinding(NOT_BP);
      return { kind: "unary", op: "not", operand, pos: this.posOf(tok) };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok) this.fail("Expected an expression");

    if (tok.kind === "number") {
      this.advance();
      return { kind: "num", value: Number(tok.text), pos: this.posOf(tok) };
    }

    if (tok.kind === "lparen") {
      this.advance();
      const inner = this.parseBinding(0);
      const close = this.peek();
      if (!close || close.kind !== "rparen") {
        this.fail("Expected ')' to close the expression", close);
      }
      this.advance();
      return inner;
    }

    if (tok.kind === "ident") {
      this.advance();
      // A call: `name( args )` — today only `class(node)`.
      const next = this.peek();
      if (next && next.kind === "lparen") {
        this.advance();
        const args: Expr[] = [];
        if (this.peek()?.kind !== "rparen") {
          args.push(this.parseBinding(0));
          while (this.peek()?.kind === "comma") {
            this.advance();
            args.push(this.parseBinding(0));
          }
        }
        const close = this.peek();
        if (!close || close.kind !== "rparen") {
          this.fail("Expected ')' to close the argument list", close);
        }
        this.advance();
        return { kind: "call", callee: tok.text, args, pos: this.posOf(tok) };
      }
      return { kind: "var", name: tok.text, pos: this.posOf(tok) };
    }

    this.fail(`Unexpected '${tok.text}' in expression`, tok);
  }
}

// ---- evaluation ------------------------------------------------------------

/** A binding environment: variable name → integer value. */
export type Env = Record<string, number>;

/** Runtime failure while evaluating an expression (unbound var, type error, …). */
export class EvalError extends Error {
  constructor(
    message: string,
    readonly pos: Pos,
  ) {
    super(message);
    this.name = "EvalError";
  }
}

/**
 * Evaluate an expression under a numeric binding environment. Arithmetic
 * (`+ - * %`, unary `-`) yields a number; comparisons and boolean connectives
 * yield a boolean. `in`/`class(...)` membership is deferred to the expander
 * (#7), which supplies the classification environment; evaluating it here
 * throws {@link EvalError}.
 */
export function evaluate(expr: Expr, env: Env = {}): number | boolean {
  switch (expr.kind) {
    case "num":
      return expr.value;

    case "var": {
      const v = env[expr.name];
      if (v === undefined) {
        throw new EvalError(`Unbound variable '${expr.name}'`, expr.pos);
      }
      return v;
    }

    case "unary": {
      if (expr.op === "-") {
        return -asNumber(evaluate(expr.operand, env), expr.operand);
      }
      return !asBoolean(evaluate(expr.operand, env), expr.operand);
    }

    case "binary":
      return evalBinary(expr, env);

    case "call":
      throw new EvalError(
        `'${expr.callee}(...)' requires the classification environment (#7)`,
        expr.pos,
      );
  }
}

function evalBinary(expr: BinaryExpr, env: Env): number | boolean {
  const { op } = expr;

  if (op === "in") {
    throw new EvalError(
      "membership ('in') requires the classification environment (#7)",
      expr.pos,
    );
  }

  if (op === "and" || op === "or") {
    // Short-circuit, and require boolean operands.
    const l = asBoolean(evaluate(expr.left, env), expr.left);
    if (op === "and") return l && asBoolean(evaluate(expr.right, env), expr.right);
    return l || asBoolean(evaluate(expr.right, env), expr.right);
  }

  if (op === "==" || op === "!=") {
    const l = evaluate(expr.left, env);
    const r = evaluate(expr.right, env);
    if (typeof l !== typeof r) {
      throw new EvalError(
        `Cannot compare ${typeof l} with ${typeof r}`,
        expr.pos,
      );
    }
    return op === "==" ? l === r : l !== r;
  }

  const l = asNumber(evaluate(expr.left, env), expr.left);
  const r = asNumber(evaluate(expr.right, env), expr.right);
  switch (op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "%":
      if (r === 0) throw new EvalError("Division by zero in '%'", expr.pos);
      return l % r;
    case "<":
      return l < r;
    case "<=":
      return l <= r;
    case ">":
      return l > r;
    case ">=":
      return l >= r;
  }
}

function asNumber(v: number | boolean, at: Expr): number {
  if (typeof v !== "number") {
    throw new EvalError("Expected a number", at.pos);
  }
  return v;
}

function asBoolean(v: number | boolean, at: Expr): boolean {
  if (typeof v !== "boolean") {
    throw new EvalError("Expected a boolean", at.pos);
  }
  return v;
}
