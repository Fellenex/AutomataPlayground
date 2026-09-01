import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";
import { parseProgram } from "./parser";
import { validate } from "./validate";
import { expand } from "./expand";
import type { ExpandedEdge, ExpandedGraph } from "./index";

// Expand `source`, asserting it lexes, parses, and validates cleanly first so a
// test failure points at the expander rather than an upstream stage.
function expandOk(source: string): {
  graph: ExpandedGraph;
  warnings: string[];
} {
  const { tokens, errors: lexErrors } = tokenize(source);
  expect(lexErrors, "fixture should lex cleanly").toEqual([]);
  const { program, errors: parseErrors } = parseProgram(tokens, source);
  expect(parseErrors, "fixture should parse cleanly").toEqual([]);
  const vdiags = validate(program);
  expect(vdiags.errors, "fixture should validate cleanly").toEqual([]);

  const { graph, diags } = expand(program);
  expect(diags.errors, "fixture should expand cleanly").toEqual([]);
  return { graph, warnings: diags.warnings.map((d) => d.message) };
}

/** Expand `source` and return its expansion diagnostics as message strings. */
function expandDiags(source: string): { errors: string[]; warnings: string[] } {
  const { tokens } = tokenize(source);
  const { program } = parseProgram(tokens, source);
  const { diags } = expand(program);
  return {
    errors: diags.errors.map((d) => d.message),
    warnings: diags.warnings.map((d) => d.message),
  };
}

/** Sort edges into a stable order for order-insensitive comparison. */
function sortEdges(edges: ExpandedEdge[]): ExpandedEdge[] {
  return [...edges].sort(
    (a, b) => a.src - b.src || a.label.localeCompare(b.label) || a.tgt - b.tgt,
  );
}

const UPPER_TRIANGLE = `graph UpperTriangle(n, m):
    symbols { a, b }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    nodes [e] n+1..m
    (i, a, j)  for i in 1..m, j in 1..m if j > i

UpperTriangle(5, 8)`;

describe("expand — golden: UpperTriangle(5, 8)", () => {
  it("classifies 1..5 as u and 6..8 as e", () => {
    const { graph } = expandOk(UPPER_TRIANGLE);
    expect(graph.nodes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const n of graph.nodes) {
      expect(n.types).toEqual([n.id <= 5 ? "u" : "e"]);
    }
  });

  it("emits every i<j pair once, all labeled a", () => {
    const { graph } = expandOk(UPPER_TRIANGLE);
    // C(8, 2) = 28 upper-triangular pairs.
    expect(graph.edges).toHaveLength(28);
    expect(graph.edges.every((e) => e.label === "a")).toBe(true);
    expect(graph.edges.every((e) => e.src < e.tgt)).toBe(true);
    expect(graph.edges).toContainEqual({ src: 1, label: "a", tgt: 8 });
    expect(graph.edges).not.toContainEqual({ src: 1, label: "a", tgt: 1 });
  });
});

describe("expand — cartesian product", () => {
  it("takes the product over endpoints", () => {
    const { graph } = expandOk(
      "graph G:\n  symbols { a }\n  nodes 1..4\n  ({1,2}, a, {3,4})\n\nG",
    );
    expect(sortEdges(graph.edges)).toEqual([
      { src: 1, label: "a", tgt: 3 },
      { src: 1, label: "a", tgt: 4 },
      { src: 2, label: "a", tgt: 3 },
      { src: 2, label: "a", tgt: 4 },
    ]);
  });

  it("expands a target range", () => {
    const { graph } = expandOk(
      "graph G:\n  symbols { a }\n  nodes 1..5\n  (1, a, 1..5)\n\nG",
    );
    expect(graph.edges.map((e) => e.tgt)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("expand — multi-label", () => {
  it("emits one parallel edge per label", () => {
    const { graph } = expandOk(
      "graph G:\n  symbols { a, b }\n  nodes 1..2\n  (1, {a,b}, 2)\n\nG",
    );
    expect(sortEdges(graph.edges)).toEqual([
      { src: 1, label: "a", tgt: 2 },
      { src: 1, label: "b", tgt: 2 },
    ]);
  });

  it("expands a label range in declaration order, not ASCII", () => {
    const { graph } = expandOk(
      "graph G:\n  symbols { x, a, c }\n  nodes 1..2\n  (1, x..c, 2)\n\nG",
    );
    // Declaration order is x, a, c — so x..c spans all three.
    expect(graph.edges.map((e) => e.label)).toEqual(["x", "a", "c"]);
  });
});

describe("expand — self-loops", () => {
  it("keeps src == tgt edges", () => {
    const { graph } = expandOk(
      "graph G:\n  symbols { a }\n  nodes 1..3\n  (i, a, i) for i in 1..3\n\nG",
    );
    expect(sortEdges(graph.edges)).toEqual([
      { src: 1, label: "a", tgt: 1 },
      { src: 2, label: "a", tgt: 2 },
      { src: 3, label: "a", tgt: 3 },
    ]);
  });
});

describe("expand — empty nodeTypes (untyped mode)", () => {
  it("expands nodes with no classifications", () => {
    const { graph } = expandOk(
      "graph G:\n  symbols { a }\n  nodes 1..3\n  (1, a, 2)\n\nG",
    );
    expect(graph.nodes).toEqual([
      { id: 1, types: [] },
      { id: 2, types: [] },
      { id: 3, types: [] },
    ]);
  });
});

describe("expand — guarded comprehension using class()", () => {
  const SOURCE = `graph G:
  symbols { a }
  nodeTypes [ u, e ]
  nodes [u] 1..2
  nodes [e] 3..4
  (i, a, j) for i in 1..4, j in 1..4 if u in class(i) and e in class(j)

G`;

  it("keeps only edges from a u-node to an e-node", () => {
    const { graph } = expandOk(SOURCE);
    expect(sortEdges(graph.edges)).toEqual([
      { src: 1, label: "a", tgt: 3 },
      { src: 1, label: "a", tgt: 4 },
      { src: 2, label: "a", tgt: 3 },
      { src: 2, label: "a", tgt: 4 },
    ]);
  });
});

describe("expand — instantiation, params, and let", () => {
  it("binds arguments to parameters", () => {
    const { graph } = expandOk(
      "graph Path(n):\n  symbols { a }\n  nodes 1..n\n  (i, a, i+1) for i in 1..n if i < n\n\nPath(4)",
    );
    expect(graph.nodes).toHaveLength(4);
    expect(sortEdges(graph.edges)).toEqual([
      { src: 1, label: "a", tgt: 2 },
      { src: 2, label: "a", tgt: 3 },
      { src: 3, label: "a", tgt: 4 },
    ]);
  });

  it("evaluates arithmetic instantiation arguments", () => {
    const { graph } = expandOk(
      "graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, n)\n\nG(2 + 3)",
    );
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toEqual([{ src: 1, label: "a", tgt: 5 }]);
  });

  it("lets a local override a parameter", () => {
    const { graph } = expandOk(
      "graph G(n):\n  symbols { a }\n  let n = 2\n  nodes 1..n\n  (1, a, n)\n\nG(99)",
    );
    expect(graph.nodes.map((node) => node.id)).toEqual([1, 2]);
    expect(graph.edges).toEqual([{ src: 1, label: "a", tgt: 2 }]);
  });

  it("unions two instantiations in one id space", () => {
    const { graph } = expandOk(
      "graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, n)\n\nG(2)\nG(3)",
    );
    expect(graph.nodes.map((node) => node.id)).toEqual([1, 2, 3]);
    expect(sortEdges(graph.edges)).toEqual([
      { src: 1, label: "a", tgt: 2 },
      { src: 1, label: "a", tgt: 3 },
    ]);
  });
});

describe("expand — dedup and hygiene warnings", () => {
  it("dedups a repeated edge and warns once", () => {
    const { graph, warnings } = expandOk(
      "graph G:\n  symbols { a }\n  nodes 1..2\n  ({1,1}, a, 2)\n\nG",
    );
    expect(graph.edges).toEqual([{ src: 1, label: "a", tgt: 2 }]);
    expect(warnings.filter((w) => /Redundant duplicate edge/.test(w))).toHaveLength(1);
  });

  it("merges classifications and warns on a redundant re-add", () => {
    const { graph, warnings } = expandOk(
      "graph G:\n  symbols { a }\n  nodeTypes [ u, e ]\n  nodes [u] 1..2\n  nodes [u, e] 1..2\n  (1, a, 2)\n\nG",
    );
    expect(graph.nodes).toEqual([
      { id: 1, types: ["u", "e"] },
      { id: 2, types: ["u", "e"] },
    ]);
    expect(warnings.some((w) => /Redundant classification/.test(w))).toBe(true);
  });
});

describe("expand — errors surfaced only by evaluation", () => {
  it("rejects an edge endpoint outside every nodes declaration", () => {
    const { errors } = expandDiags(
      "graph G:\n  symbols { a }\n  nodes 1..3\n  (1, a, 9)\n\nG",
    );
    expect(errors.join(" ")).toMatch(/'9' is not a declared node/);
  });

  it("rejects modulo by zero in a bound", () => {
    const { errors } = expandDiags(
      "graph G:\n  symbols { a }\n  nodes 1..(5 % 0)\n  (1, a, 1)\n\nG",
    );
    expect(errors.join(" ")).toMatch(/Division by zero/);
  });

  it("warns when nothing is instantiated", () => {
    const { warnings } = expandDiags("graph G(n):\n  symbols { a }\n  nodes 1..n");
    expect(warnings.join(" ")).toMatch(/No instantiation/);
  });

  it("produces an empty graph for an empty program", () => {
    const { errors, warnings } = expandDiags("");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
