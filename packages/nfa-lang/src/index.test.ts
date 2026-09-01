import { describe, it, expect } from "vitest";
import { validateProgram, LIMITS } from "./index";

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

  it("reports expansion as not implemented for a fully valid program", () => {
    const result = validateProgram(
      "graph G(n):\n  symbols { a }\n  nodes 1..n\n  (1, a, 1)\n\nG(3)",
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/expansion not implemented/i);
    expect(result.graph).toBeUndefined();
  });

  it("exposes positive expansion LIMITS", () => {
    expect(LIMITS.maxSourceChars).toBeGreaterThan(0);
    expect(LIMITS.maxNodes).toBeGreaterThan(0);
    expect(LIMITS.maxEdges).toBeGreaterThan(0);
  });
});
