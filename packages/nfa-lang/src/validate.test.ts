import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";
import { parseProgram } from "./parser";
import { validate } from "./validate";

/** Lex -> parse -> validate, returning error/warning message arrays. */
function check(source: string): { errors: string[]; warnings: string[] } {
  const { tokens } = tokenize(source);
  const { program, errors: parseErrors } = parseProgram(tokens, source);
  expect(parseErrors, "fixture should parse cleanly").toEqual([]);
  const diags = validate(program);
  return {
    errors: diags.errors.map((d) => d.message),
    warnings: diags.warnings.map((d) => d.message),
  };
}

const oneMatch = (msgs: string[], re: RegExp): boolean =>
  msgs.some((m) => re.test(m));

describe("validation — happy path", () => {
  it("accepts the UpperTriangle example with no errors or warnings", () => {
    const src = `graph UpperTriangle(n, m):
    symbols { a, b }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    nodes [e] n+1..m
    (i, a, j)  for i in 1..m, j in 1..m if j > i

UpperTriangle(5, 8)`;
    const { errors, warnings } = check(src);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("accepts a bare untyped graph", () => {
    const { errors } = check("graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, 2)");
    expect(errors).toEqual([]);
  });
});

describe("validation — alphabet membership", () => {
  it("rejects an edge label not in symbols", () => {
    const { errors } = check("graph G:\n  symbols { a }\n  nodes 1..2\n  (1, b, 2)");
    expect(oneMatch(errors, /Unknown symbol 'b'/)).toBe(true);
  });

  it("rejects both endpoints of an out-of-alphabet label range", () => {
    const { errors } = check("graph G:\n  symbols { a }\n  nodes 1..2\n  (1, x..y, 2)");
    expect(errors.filter((e) => /Unknown symbol/.test(e))).toHaveLength(2);
  });

  it("rejects an unknown node type in typed mode", () => {
    const { errors } = check("graph G:\n  nodeTypes [ u ]\n  nodes [v] 1..3");
    expect(oneMatch(errors, /Unknown node type 'v'/)).toBe(true);
  });
});

describe("validation — two node modes", () => {
  it("untyped mode rejects a bracketed classification", () => {
    const { errors } = check("graph G:\n  nodes [u] 1..3");
    expect(oneMatch(errors, /Untyped mode.*'u'.*no nodeTypes/)).toBe(true);
  });

  it("untyped mode rejects an empty [] classification", () => {
    const { errors } = check("graph G:\n  nodes [] 1..3");
    expect(oneMatch(errors, /Untyped mode.*empty/)).toBe(true);
  });

  it("typed mode rejects a bare (label-less) node declaration", () => {
    const { errors } = check("graph G:\n  nodeTypes [ u ]\n  nodes 1..3");
    expect(oneMatch(errors, /Typed mode.*bracketed classification/)).toBe(true);
  });

  it("typed mode rejects an empty [] classification", () => {
    const { errors } = check("graph G:\n  nodeTypes [ u ]\n  nodes [] 1..3");
    expect(oneMatch(errors, /Typed mode.*at least one type/)).toBe(true);
  });

  it("allows multiple typed classifications", () => {
    const { errors } = check("graph G:\n  nodeTypes [ u, v ]\n  nodes [u,v] 1..3");
    expect(errors).toEqual([]);
  });
});

describe("validation — declared-before-use", () => {
  it("errors when symbols are declared after an edge uses them", () => {
    const { errors } = check("graph G:\n  nodes 1..2\n  (1, a, 2)\n  symbols { a }");
    expect(oneMatch(errors, /'symbols' must be declared before/)).toBe(true);
  });

  it("errors on instantiating an undefined graph", () => {
    const { errors } = check("Missing(1, 2)");
    expect(oneMatch(errors, /Unknown graph 'Missing'/)).toBe(true);
  });

  it("errors on instantiating a graph defined later", () => {
    const { errors } = check("G()\n\ngraph G:\n  nodes 1..2");
    expect(oneMatch(errors, /Unknown graph 'G'/)).toBe(true);
  });

  it("errors on an instantiation argument-count mismatch", () => {
    const { errors } = check("graph G(n, m):\n  nodes 1..n\n\nG(5)");
    expect(oneMatch(errors, /expects 2 argument\(s\) but got 1/)).toBe(true);
  });

  it("errors on a duplicate graph definition", () => {
    const { errors } = check("graph G:\n  nodes 1..2\n\ngraph G:\n  nodes 1..3");
    expect(oneMatch(errors, /Duplicate graph 'G'/)).toBe(true);
  });
});

describe("validation — free variables", () => {
  it("catches an unbound variable in a range bound", () => {
    // `m` is never a param, let, or loop variable.
    const { errors } = check("graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, m)");
    expect(oneMatch(errors, /Unbound variable 'm'/)).toBe(true);
  });

  it("binds comprehension loop variables", () => {
    const { errors } = check(
      "graph G(n):\n  symbols { a }\n  nodes 1..n\n  (i, a, j) for i in 1..n, j in 1..n if j > i",
    );
    expect(errors).toEqual([]);
  });

  it("treats node types as constants inside a guard", () => {
    const src = `graph G(n):
    symbols { a }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    (i, a, j) for i in 1..n, j in 1..n if u in class(i) and e in class(j)`;
    const { errors } = check(src);
    expect(errors).toEqual([]);
  });

  it("catches an unbound variable in a top-level instantiation argument", () => {
    const { errors } = check("graph G(n):\n  nodes 1..n\n\nG(k)");
    expect(oneMatch(errors, /Unbound variable 'k'/)).toBe(true);
  });

  it("scopes a let binding after its own definition", () => {
    const { errors } = check(
      "graph G(n):\n  symbols { a }\n  let k = n + 1\n  nodes 1..k\n  (1, a, k)",
    );
    expect(errors).toEqual([]);
  });

  it("catches a let RHS referencing a not-yet-bound name", () => {
    const { errors } = check("graph G(n):\n  let k = z + 1\n  nodes 1..k");
    expect(oneMatch(errors, /Unbound variable 'z'/)).toBe(true);
  });
});

describe("validation — warnings (hygiene / scaffolding)", () => {
  it("warns on a let that overrides a parameter", () => {
    const { warnings } = check("graph G(n):\n  symbols { a }\n  let n = 5\n  nodes 1..n");
    expect(oneMatch(warnings, /overrides parameter 'n'/)).toBe(true);
  });

  it("warns on a duplicate symbol declaration list", () => {
    const { warnings } = check("graph G:\n  symbols { a, a }\n  nodes 1..2");
    expect(oneMatch(warnings, /Duplicate symbol 'a'/)).toBe(true);
  });

  it("warns on duplicate symbols/nodeTypes blocks", () => {
    const dupSym = check("graph G:\n  symbols { a }\n  symbols { b }\n  nodes 1..2");
    expect(oneMatch(dupSym.warnings, /Duplicate 'symbols' declaration/)).toBe(true);

    const dupNt = check(
      "graph G:\n  nodeTypes [ u ]\n  nodeTypes [ e ]\n  nodes [u] 1..2",
    );
    expect(oneMatch(dupNt.warnings, /Duplicate 'nodeTypes' declaration/)).toBe(true);
  });

  it("warns on a redundant repeated node type", () => {
    const { warnings } = check("graph G:\n  nodeTypes [ u ]\n  nodes [u,u] 1..3");
    expect(oneMatch(warnings, /Redundant node type 'u'/)).toBe(true);
  });

  it("warns on a duplicate parameter", () => {
    const { warnings } = check("graph G(n, n):\n  nodes 1..n");
    expect(oneMatch(warnings, /Duplicate parameter 'n'/)).toBe(true);
  });
});
