import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";
import { parseExpr, evaluate, EvalError, type Expr, type Env } from "./expr";

/** Lex `src` and parse its tokens (dropping the trailing newline/eof) as an expr. */
function parse(src: string): Expr {
  const { tokens, errors } = tokenize(src);
  expect(errors, "fixture should lex cleanly").toEqual([]);
  const slice = tokens.filter((t) => t.kind !== "newline" && t.kind !== "eof");
  const { expr, errors: perrors } = parseExpr(slice);
  expect(perrors, `expression should parse: ${src}`).toEqual([]);
  if (!expr) throw new Error("no expr");
  return expr;
}

/** Parse and evaluate `src` under `env`. */
function evalExpr(src: string, env: Env = {}): number | boolean {
  return evaluate(parse(src), env);
}

/** Render an expr as a fully-parenthesized string, exposing the parse shape. */
function show(e: Expr): string {
  switch (e.kind) {
    case "num":
      return String(e.value);
    case "var":
      return e.name;
    case "unary":
      return `(${e.op} ${show(e.operand)})`;
    case "binary":
      return `(${show(e.left)} ${e.op} ${show(e.right)})`;
    case "call":
      return `${e.callee}(${e.args.map(show).join(", ")})`;
  }
}

describe("expr — precedence", () => {
  it("multiplication binds tighter than addition", () => {
    expect(show(parse("1 + 2 * 3"))).toBe("(1 + (2 * 3))");
    expect(show(parse("2 * 3 + 1"))).toBe("((2 * 3) + 1)");
    expect(evalExpr("1 + 2 * 3")).toBe(7);
    expect(evalExpr("2 * 3 + 1")).toBe(7);
  });

  it("modulo shares the multiplicative tier", () => {
    expect(show(parse("1 + 10 % 3"))).toBe("(1 + (10 % 3))");
    expect(evalExpr("1 + 10 % 3")).toBe(2);
  });

  it("comparison binds looser than arithmetic", () => {
    expect(show(parse("n + 1 > m * 2"))).toBe("((n + 1) > (m * 2))");
  });

  it("boolean connectives bind looser than comparison", () => {
    expect(show(parse("a > b and c > d or e > f"))).toBe(
      "(((a > b) and (c > d)) or (e > f))",
    );
  });

  it("and binds tighter than or", () => {
    expect(show(parse("a or b and c"))).toBe("(a or (b and c))");
    expect(show(parse("a and b or c"))).toBe("((a and b) or c)");
  });

  it("not binds looser than comparison but tighter than and", () => {
    expect(show(parse("not a < b"))).toBe("(not (a < b))");
    expect(show(parse("not a and b"))).toBe("((not a) and b)");
  });
});

describe("expr — associativity", () => {
  it("subtraction is left-associative", () => {
    expect(show(parse("1 - 2 - 3"))).toBe("((1 - 2) - 3)");
    expect(evalExpr("1 - 2 - 3")).toBe(-4);
  });

  it("division-like modulo is left-associative", () => {
    expect(show(parse("20 % 7 % 2"))).toBe("((20 % 7) % 2)");
    expect(evalExpr("20 % 7 % 2")).toBe(0);
  });

  it("addition chains left-associatively", () => {
    expect(show(parse("1 + 2 + 3 + 4"))).toBe("(((1 + 2) + 3) + 4)");
    expect(evalExpr("1 + 2 + 3 + 4")).toBe(10);
  });
});

describe("expr — unary minus", () => {
  it("negates a primary", () => {
    expect(show(parse("-3"))).toBe("(- 3)");
    expect(evalExpr("-3")).toBe(-3);
  });

  it("binds tighter than multiplication", () => {
    expect(show(parse("-2 * 3"))).toBe("((- 2) * 3)");
    expect(evalExpr("-2 * 3")).toBe(-6);
  });

  it("parses a subtraction of a negated operand", () => {
    expect(show(parse("3 - -2"))).toBe("(3 - (- 2))");
    expect(evalExpr("3 - -2")).toBe(5);
  });

  it("stacks", () => {
    expect(evalExpr("- -5")).toBe(5);
  });
});

describe("expr — parentheses", () => {
  it("overrides precedence", () => {
    expect(show(parse("(1 + 2) * 3"))).toBe("((1 + 2) * 3)");
    expect(evalExpr("(1 + 2) * 3")).toBe(9);
  });

  it("nests to arbitrary depth", () => {
    expect(evalExpr("((1 + 2) * (3 + 4))")).toBe(21);
    expect(evalExpr("(((5)))")).toBe(5);
  });

  it("negates a parenthesized group", () => {
    expect(show(parse("-(2 * 3)"))).toBe("(- (2 * 3))");
    expect(evalExpr("-(2 * 3)")).toBe(-6);
  });
});

describe("expr — evaluation under a binding environment", () => {
  it("resolves variables from the environment", () => {
    expect(evalExpr("n + 1", { n: 5 })).toBe(6);
    expect(evalExpr("2 * m", { m: 4 })).toBe(8);
    expect(evalExpr("n + 1", { n: 4 })).toBe(5); // the `n+1..m` lower bound
  });

  it("evaluates a multi-variable expression", () => {
    expect(evalExpr("(n + m) % k", { n: 10, m: 5, k: 4 })).toBe(3);
  });

  it("throws EvalError on an unbound variable", () => {
    expect(() => evalExpr("n + 1", {})).toThrow(EvalError);
    expect(() => evalExpr("n + 1", {})).toThrow(/Unbound variable 'n'/);
  });

  it("evaluates comparisons to booleans", () => {
    expect(evalExpr("j > i", { j: 2, i: 1 })).toBe(true);
    expect(evalExpr("j > i", { j: 1, i: 1 })).toBe(false);
    expect(evalExpr("j >= i", { j: 1, i: 1 })).toBe(true);
    expect(evalExpr("n % 2 == 0", { n: 6 })).toBe(true);
    expect(evalExpr("n != m", { n: 1, m: 2 })).toBe(true);
  });

  it("evaluates boolean connectives with short-circuiting", () => {
    expect(evalExpr("i < j and j < k", { i: 1, j: 2, k: 3 })).toBe(true);
    expect(evalExpr("i < j and j < k", { i: 1, j: 5, k: 3 })).toBe(false);
    expect(evalExpr("i > j or j < k", { i: 1, j: 2, k: 3 })).toBe(true);
    expect(evalExpr("not i < j", { i: 2, j: 1 })).toBe(true);
    // Short-circuit: the right operand's unbound var is never evaluated.
    expect(evalExpr("1 > 2 and z > 0", {})).toBe(false);
  });

  it("rejects type mismatches", () => {
    expect(() => evalExpr("1 + (2 > 3)", {})).toThrow(/Expected a number/);
    expect(() => evalExpr("not 3", {})).toThrow(/Expected a boolean/);
    expect(() => evalExpr("1 == (2 > 3)", {})).toThrow(/Cannot compare/);
  });

  it("guards against modulo by zero", () => {
    expect(() => evalExpr("5 % 0", {})).toThrow(/Division by zero/);
  });
});

describe("expr — membership deferred to the expander (#7)", () => {
  it("parses `x in class(i)` into a tree", () => {
    expect(show(parse("u in class(i)"))).toBe("(u in class(i))");
    expect(show(parse("u in class(i) and e in class(j)"))).toBe(
      "((u in class(i)) and (e in class(j)))",
    );
  });

  it("throws when asked to evaluate membership or a call", () => {
    expect(() => evalExpr("u in class(i)", { u: 1, i: 2 })).toThrow(EvalError);
    expect(() => evalExpr("u in class(i)", { u: 1, i: 2 })).toThrow(/#7/);
    expect(() => evaluate(parse("class(i)"), { i: 1 })).toThrow(/#7/);
  });
});

describe("expr — syntax errors", () => {
  function errorsFor(src: string): string[] {
    const { tokens } = tokenize(src);
    const slice = tokens.filter((t) => t.kind !== "newline" && t.kind !== "eof");
    return parseExpr(slice).errors.map((e) => e.message);
  }

  it("reports a dangling operator", () => {
    const errs = errorsFor("1 +");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/Expected an expression/);
  });

  it("reports trailing tokens after a complete expression", () => {
    expect(errorsFor("1 2")[0]).toMatch(/Unexpected '2' after expression/);
  });

  it("reports an unclosed parenthesis", () => {
    expect(errorsFor("(1 + 2")[0]).toMatch(/Expected '\)'/);
  });

  it("reports a leading operator", () => {
    expect(errorsFor("* 3")[0]).toMatch(/Unexpected '\*'/);
  });

  it("returns a null expr on failure", () => {
    const { tokens } = tokenize("1 +");
    const slice = tokens.filter((t) => t.kind !== "newline" && t.kind !== "eof");
    expect(parseExpr(slice).expr).toBeNull();
  });
});
