import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";
import type { TokenKind } from "./tokens";

/** Compact helper: the kind stream, dropping the trailing newline/eof noise. */
function kinds(source: string): TokenKind[] {
  return tokenize(source).tokens.map((t) => t.kind);
}

/** The `[kind, text]` pairs for non-trivial tokens. */
function pairs(source: string): Array<[TokenKind, string]> {
  return tokenize(source)
    .tokens.filter((t) => t.kind !== "newline" && t.kind !== "eof")
    .map((t) => [t.kind, t.text]);
}

describe("lexer", () => {
  it("tokenizes identifiers, numbers, and punctuation", () => {
    expect(pairs("(1, a, 23)")).toEqual([
      ["lparen", "("],
      ["number", "1"],
      ["comma", ","],
      ["ident", "a"],
      ["comma", ","],
      ["number", "23"],
      ["rparen", ")"],
    ]);
  });

  it("tokenizes all bracket, range, and operator forms", () => {
    expect(pairs("{ } [ ] .. + - * % = == != < > <= >= :")).toEqual([
      ["lbrace", "{"],
      ["rbrace", "}"],
      ["lbracket", "["],
      ["rbracket", "]"],
      ["dotdot", ".."],
      ["plus", "+"],
      ["minus", "-"],
      ["star", "*"],
      ["percent", "%"],
      ["eq", "="],
      ["eqeq", "=="],
      ["ne", "!="],
      ["lt", "<"],
      ["gt", ">"],
      ["le", "<="],
      ["ge", ">="],
      ["colon", ":"],
    ]);
  });

  it("keeps keywords as identifiers (parser dispatches on text)", () => {
    expect(pairs("graph nodes symbols nodeTypes let for if in")).toEqual([
      ["ident", "graph"],
      ["ident", "nodes"],
      ["ident", "symbols"],
      ["ident", "nodeTypes"],
      ["ident", "let"],
      ["ident", "for"],
      ["ident", "if"],
      ["ident", "in"],
    ]);
  });

  it("distinguishes `..` from a would-be single dot", () => {
    expect(kinds("1..5")).toEqual(["number", "dotdot", "number", "newline", "eof"]);
  });

  it("skips `#` line comments to end of line", () => {
    expect(pairs("a # this is ignored, and so is (1,b,2)\nb")).toEqual([
      ["ident", "a"],
      ["ident", "b"],
    ]);
  });

  it("emits one significant newline per logical line, collapsing blanks", () => {
    const ks = kinds("a\n\n\n b");
    expect(ks).toEqual(["ident", "newline", "ident", "newline", "eof"]);
  });

  it("suppresses newlines inside bracket groups so sets may wrap", () => {
    // The interior newline is swallowed; only the trailing terminator remains.
    expect(kinds("{ 1,\n 2 }")).toEqual([
      "lbrace",
      "number",
      "comma",
      "number",
      "rbrace",
      "newline",
      "eof",
    ]);
  });

  it("tracks line/col for each token", () => {
    const [first, second] = tokenize("ab\n  cd").tokens;
    expect({ line: first.line, col: first.col }).toEqual({ line: 1, col: 0 });
    // second real token is `newline`; the ident after is at line 2, col 2
    const cd = tokenize("ab\n  cd").tokens.find((t) => t.text === "cd");
    expect({ line: cd?.line, col: cd?.col }).toEqual({ line: 2, col: 2 });
    void second;
  });

  it("reports unknown characters without throwing", () => {
    const { errors } = tokenize("a ? b");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Unexpected character/);
  });

  it("produces only EOF for empty or whitespace-only input", () => {
    expect(kinds("")).toEqual(["eof"]);
    expect(kinds("   \n\n  ")).toEqual(["eof"]);
  });
});
