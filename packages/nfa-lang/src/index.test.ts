import { describe, it, expect } from "vitest";
import { validateProgram, analyze, LIMITS } from "./index";

// End-to-end tests of the public `validateProgram` orchestration. The lexer,
// parser, and validator have their own focused suites (*.test.ts); these cover
// how the pieces compose behind the one exported entry point.
describe("nfa-lang — validateProgram", () => {
  it("returns a stable ValidationResult shape", () => {
    const result = validateProgram("graph G(n): symbols { a }");
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("surfaces validation errors for an invalid program", () => {
    const result = validateProgram(
      "graph G:\n  symbols { a }\n  nodes 1..2\n  (1, b, 2)",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Unknown symbol 'b'/);
  });

  it("surfaces warnings alongside a clean/parseable program", () => {
    const result = validateProgram(
      "graph G(n):\n  symbols { a }\n  let n = 5\n  nodes 1..n\n  (1, a, n)",
    );
    expect(result.warnings.join(" ")).toMatch(/overrides parameter 'n'/);
  });

  it("prefixes diagnostics with a 1-based line:col location", () => {
    const result = validateProgram(
      "graph G:\n  symbols { a }\n  nodes 1..2\n  (1, b, 2)",
    );
    expect(result.errors[0]).toMatch(/^\d+:\d+: /);
  });

  it("expands a fully valid program into a concrete graph", () => {
    const result = validateProgram(
      "graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, 1)\n\nG(3)",
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.graph?.nodes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(result.graph?.edges).toEqual([{ src: 1, label: "a", tgt: 1 }]);
  });

  it("surfaces an expansion error (edge endpoint not declared)", () => {
    const result = validateProgram(
      "graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, 9)\n\nG(3)",
    );
    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
    expect(result.errors.join(" ")).toMatch(/'9' is not a declared node/);
  });

  it("analyze() returns positioned diagnostics with a severity", () => {
    const result = analyze(
      "graph G:\n  symbols { a }\n  nodes 1..2\n  (1, b, 2)",
    );
    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
    const err = result.diagnostics.find((d) => /Unknown symbol 'b'/.test(d.message));
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
    expect(err?.line).toBe(4);
    expect(typeof err?.col).toBe("number");
  });

  it("analyze() sorts diagnostics by source position", () => {
    const { diagnostics } = analyze(
      "graph G:\n  symbols { a }\n  nodes 1..2\n  (1, b, 2)\n  (2, c, 1)",
    );
    for (let i = 1; i < diagnostics.length; i++) {
      const prev = diagnostics[i - 1];
      const cur = diagnostics[i];
      expect(prev.line < cur.line || (prev.line === cur.line && prev.col <= cur.col)).toBe(true);
    }
  });

  it("analyze() yields a graph and keeps warnings on success", () => {
    const result = analyze(
      "graph G(n):\n  symbols { a }\n  let n = 5\n  nodes 1..n\n  (1, a, n)\n\nG(3)",
    );
    expect(result.ok).toBe(true);
    expect(result.graph?.nodes.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.severity === "warning")).toBe(true);
    expect(result.diagnostics.some((d) => /overrides parameter 'n'/.test(d.message))).toBe(true);
  });

  it("exposes positive expansion LIMITS", () => {
    expect(LIMITS.maxSourceChars).toBeGreaterThan(0);
    expect(LIMITS.maxNodes).toBeGreaterThan(0);
    expect(LIMITS.maxEdges).toBeGreaterThan(0);
  });
});
