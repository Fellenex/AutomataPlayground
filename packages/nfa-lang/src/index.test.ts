import { describe, it, expect } from "vitest";
import { validateProgram, LIMITS } from "./index";

// Scaffold smoke tests — prove the Vitest harness runs and the package's public
// surface is importable. Behavioral tests for the real parser land with the
// grammar issues (#5–#8); the "not implemented" assertion below is a placeholder
// to replace once #5 makes validateProgram actually parse.
describe("nfa-lang (scaffold smoke test)", () => {
  it("returns a stable ValidationResult shape", () => {
    const result = validateProgram("graph G(n): symbols { a }");
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("reports not-implemented until the parser lands (remove in #5)", () => {
    const result = validateProgram("");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not implemented/i);
  });

  it("exposes positive expansion LIMITS", () => {
    expect(LIMITS.maxSourceChars).toBeGreaterThan(0);
    expect(LIMITS.maxNodes).toBeGreaterThan(0);
    expect(LIMITS.maxEdges).toBeGreaterThan(0);
  });
});
