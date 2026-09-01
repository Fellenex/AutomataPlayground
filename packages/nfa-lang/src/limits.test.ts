import { describe, it, expect } from "vitest";
import { validateProgram, expand, LIMITS, type Limits } from "./index";
import { tokenize } from "./lexer";
import { parseProgram } from "./parser";

// Expansion limits (issue: enforce sane expansion LIMITS). Each ceiling is
// checked two ways: an over-limit input yields a clear error (and never hangs),
// and a near-limit input still expands cleanly. Most tests drive `expand`
// directly with small overridden `limits` so the fixtures stay tiny and fast;
// the shared defaults are covered through `validateProgram` too.

/** Parse `source` and expand it under `limits`, returning error messages. */
function expandUnder(
  source: string,
  limits: Limits,
): { errors: string[]; nodes: number; edges: number } {
  const { tokens } = tokenize(source);
  const { program } = parseProgram(tokens, source);
  const { graph, diags } = expand(program, limits);
  return {
    errors: diags.errors.map((d) => d.message),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };
}

const TINY: Limits = {
  maxSourceChars: 200,
  maxArg: 100,
  maxNodes: 10,
  maxEdges: 10,
};

describe("limits — source length", () => {
  it("rejects source past maxSourceChars with a clear error", () => {
    const source = "// " + "x".repeat(LIMITS.maxSourceChars);
    const result = validateProgram(source);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Source is too long/);
  });

  it("accepts source at exactly maxSourceChars", () => {
    // A comment line padded to exactly the ceiling: within the limit, and it
    // lexes/validates as an empty program (no instantiation ⇒ no error).
    const pad = "x".repeat(LIMITS.maxSourceChars - 3);
    const source = "// " + pad;
    expect(source.length).toBe(LIMITS.maxSourceChars);
    const result = validateProgram(source);
    expect(result.errors.join(" ")).not.toMatch(/too long/);
  });
});

describe("limits — argument magnitude", () => {
  const G = "graph G(n):\n  symbols { a }\n  nodes 1..1\n  (1, a, 1)\n\n";

  it("rejects an argument past maxArg before it drives a range", () => {
    const { errors } = expandUnder(`${G}G(1000000)`, TINY);
    expect(errors.join(" ")).toMatch(/exceeds the maximum magnitude/);
  });

  it("rejects a large-magnitude negative argument too", () => {
    const { errors } = expandUnder(`${G}G(0 - 1000000)`, TINY);
    expect(errors.join(" ")).toMatch(/exceeds the maximum magnitude/);
  });

  it("accepts an argument at exactly maxArg", () => {
    // n is bound but the body ignores it, so no range blows up.
    const { errors } = expandUnder(`${G}G(${TINY.maxArg})`, TINY);
    expect(errors).toEqual([]);
  });

  it("enforces the default maxArg through validateProgram", () => {
    const result = validateProgram(
      "graph G(n):\n  symbols { a }\n  nodes 1..1\n  (1, a, 1)\n\nG(1000000)",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/exceeds the maximum magnitude/);
  });
});

describe("limits — node count", () => {
  it("rejects a node range that overflows maxNodes without hanging", () => {
    // A literal range (no argument) still cannot materialize past the cap.
    const { errors } = expandUnder(
      "graph G:\n  symbols { a }\n  nodes 1..1000000\n  (1, a, 1)\n\nG",
      TINY,
    );
    expect(errors.join(" ")).toMatch(/too many values|Too many nodes/);
  });

  it("rejects distinct declarations that together exceed maxNodes", () => {
    const { errors } = expandUnder(
      "graph G:\n  symbols { a }\n  nodes 1..8\n  nodes 100..108\n  (1, a, 1)\n\nG",
      TINY,
    );
    expect(errors.join(" ")).toMatch(/Too many nodes/);
  });

  it("accepts exactly maxNodes nodes", () => {
    const { errors, nodes } = expandUnder(
      "graph G:\n  symbols { a }\n  nodes 1..10\n  (1, a, 1)\n\nG",
      TINY,
    );
    expect(errors).toEqual([]);
    expect(nodes).toBe(TINY.maxNodes);
  });
});

describe("limits — edge count", () => {
  it("rejects an edge product that overflows maxEdges", () => {
    // 5 sources × 5 targets = 25 edges under a cap of 10.
    const { errors } = expandUnder(
      "graph G:\n  symbols { a }\n  nodes 1..5\n  (1..5, a, 1..5)\n\nG",
      TINY,
    );
    expect(errors.join(" ")).toMatch(/Too many edges/);
  });

  it("accepts exactly maxEdges edges", () => {
    // 1 source × 10 targets = 10 edges, exactly the cap.
    const { errors, edges } = expandUnder(
      "graph G:\n  symbols { a }\n  nodes 1..10\n  (1, a, 1..10)\n\nG",
      TINY,
    );
    expect(errors).toEqual([]);
    expect(edges).toBe(TINY.maxEdges);
  });
});

describe("limits — comprehension iterations", () => {
  it("aborts a selective comprehension that iterates past the limit", () => {
    // An impossible guard (a strict 3-cycle) retains nothing, so neither the
    // node nor edge caps ever trip — only the iteration guard bounds the loop.
    // Each range (1..5) equals maxNodes, so the range cap is not tripped either,
    // yet 5³ nested iterations far exceed the maxNodes² (25) iteration ceiling.
    const iterCap: Limits = { ...TINY, maxNodes: 5, maxArg: 100 };
    const { errors } = expandUnder(
      "graph G:\n  symbols { a }\n  nodes 1..1\n" +
        "  (1, a, 1) for i in 1..5, j in 1..5, k in 1..5 if i > j and j > k and k > i\n\nG",
      iterCap,
    );
    expect(errors.join(" ")).toMatch(/iteration limit/);
  });

  it("does not hang on the classic UpperTriangle(1000000) blowup", () => {
    const source = `graph UpperTriangle(n, m):
    symbols { a }
    nodes 1..n
    nodes n+1..m
    (i, a, j) for i in 1..m, j in 1..m if j > i

UpperTriangle(1000000, 1000000)`;
    const result = validateProgram(source);
    expect(result.ok).toBe(false);
    // Whichever ceiling trips first, it must be a limit error, not a crash.
    expect(result.errors.join(" ")).toMatch(
      /exceeds the maximum magnitude|too many values|Too many/,
    );
  });
});
