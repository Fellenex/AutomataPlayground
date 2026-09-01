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
// Arithmetic (`+ - * %`, unary `-`, parens) is the core; comparisons, boolean
// connectives, and `in class(...)` are here so that comprehension *guards* parse
// into the same tree. Evaluation (see {@link evaluate}) covers arithmetic,
// comparison, and boolean logic under a numeric binding environment;
// `in`/`class(...)` membership is deferred to the expander, which owns the
// classification environment.

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

/**
 * The classification context a guard needs to resolve `class(...)` and `in`.
 * The expander supplies it once concrete node ids and their merged node-type
 * sets are known; pure arithmetic/comparison guards never touch it.
 */
export interface ClassEnv {
  /** The declared node-type alphabet, so a bare `u` reads as the type name. */
  nodeTypes: ReadonlySet<string>;
  /** The merged classifications of a concrete node id (empty if none). */
  classOf(nodeId: number): ReadonlySet<string>;
}

/**
 * A value produced while evaluating. Arithmetic yields `number`, comparisons and
 * connectives yield `boolean`; guards additionally produce a node-type name
 * (`string`, the left side of `in`) and a `class(...)` result (a set of names).
 */
type Value = number | boolean | string | ReadonlySet<string>;

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
 * Evaluate an arithmetic/boolean expression under a numeric binding environment.
 * Arithmetic (`+ - * %`, unary `-`) yields a number; comparisons and boolean
 * connectives yield a boolean. `in`/`class(...)` membership is deferred to the
 * expander (see {@link evaluateGuard}); reaching one here throws {@link EvalError}.
 */
export function evaluate(expr: Expr, env: Env = {}): number | boolean {
  const v = evalNode(expr, env);
  // Without a ClassEnv, `class(...)`/`in`/type-name paths all throw before here,
  // so a leaked string/set would be a bug rather than bad input.
  if (typeof v !== "number" && typeof v !== "boolean") {
    throw new EvalError("Expected a number or boolean", expr.pos);
  }
  return v;
}

/**
 * Evaluate a comprehension guard to a boolean, resolving `class(...)` and `in`
 * against `classEnv`. Everything else behaves as in {@link evaluate}.
 */
export function evaluateGuard(
  expr: Expr,
  env: Env,
  classEnv: ClassEnv,
): boolean {
  return asBoolean(evalNode(expr, env, classEnv), expr);
}

function evalNode(expr: Expr, env: Env, cx?: ClassEnv): Value {
  switch (expr.kind) {
    case "num":
      return expr.value;

    case "var": {
      const v = env[expr.name];
      if (v !== undefined) return v;
      // Inside a guard a bare node-type name reads as a string literal, so that
      // `u in class(i)` compares the name against node i's classification set.
      if (cx && cx.nodeTypes.has(expr.name)) return expr.name;
      throw new EvalError(`Unbound variable '${expr.name}'`, expr.pos);
    }

    case "unary": {
      if (expr.op === "-") {
        return -asNumber(evalNode(expr.operand, env, cx), expr.operand);
      }
      return !asBoolean(evalNode(expr.operand, env, cx), expr.operand);
    }

    case "binary":
      return evalBinary(expr, env, cx);

    case "call":
      return evalCall(expr, env, cx);
  }
}

function evalCall(expr: CallExpr, env: Env, cx?: ClassEnv): Value {
  if (!cx) {
    throw new EvalError(
      `'${expr.callee}(...)' requires the classification environment, which the expander supplies`,
      expr.pos,
    );
  }
  if (expr.callee !== "class") {
    throw new EvalError(`Unknown function '${expr.callee}'`, expr.pos);
  }
  if (expr.args.length !== 1) {
    throw new EvalError("'class(...)' takes exactly one node argument", expr.pos);
  }
  const id = asNumber(evalNode(expr.args[0], env, cx), expr.args[0]);
  return cx.classOf(id);
}

function evalBinary(expr: BinaryExpr, env: Env, cx?: ClassEnv): Value {
  const { op } = expr;

  if (op === "in") {
    if (!cx) {
      throw new EvalError(
        "membership ('in') requires the classification environment, which the expander supplies",
        expr.pos,
      );
    }
    const left = evalNode(expr.left, env, cx);
    const right = evalNode(expr.right, env, cx);
    if (typeof left !== "string") {
      throw new EvalError("Left of 'in' must be a node type", expr.left.pos);
    }
    if (!(right instanceof Set)) {
      throw new EvalError("Right of 'in' must be a 'class(...)' set", expr.right.pos);
    }
    return right.has(left);
  }

  if (op === "and" || op === "or") {
    // Short-circuit, and require boolean operands.
    const l = asBoolean(evalNode(expr.left, env, cx), expr.left);
    if (op === "and") {
      return l && asBoolean(evalNode(expr.right, env, cx), expr.right);
    }
    return l || asBoolean(evalNode(expr.right, env, cx), expr.right);
  }

  if (op === "==" || op === "!=") {
    const l = evalNode(expr.left, env, cx);
    const r = evalNode(expr.right, env, cx);
    if (l instanceof Set || r instanceof Set) {
      throw new EvalError("Cannot compare a 'class(...)' set", expr.pos);
    }
    if (typeof l !== typeof r) {
      throw new EvalError(
        `Cannot compare ${typeof l} with ${typeof r}`,
        expr.pos,
      );
    }
    return op === "==" ? l === r : l !== r;
  }

  const l = asNumber(evalNode(expr.left, env, cx), expr.left);
  const r = asNumber(evalNode(expr.right, env, cx), expr.right);
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

function asNumber(v: Value, at: Expr): number {
  if (typeof v !== "number") {
    throw new EvalError("Expected a number", at.pos);
  }
  return v;
}

function asBoolean(v: Value, at: Expr): boolean {
  if (typeof v !== "boolean") {
    throw new EvalError("Expected a boolean", at.pos);
  }
  return v;
}
