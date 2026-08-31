// Hand-written lexer for nfa-lang (see docs/GRAMMAR.md).
//
// Turns source text into a flat token stream. Two behaviours matter to the
// parser:
//   - Newlines are significant statement terminators, EXCEPT inside a bracket
//     group (`(` `[` `{`), where they are swallowed so a set/triple may wrap.
//   - Every token carries its line/col/offset so the parser can group a graph
//     body by indentation and slice raw-expression text back out of the source.

import type { Token, TokenKind } from "./tokens";

export interface Diagnostic {
  message: string;
  line: number;
  col: number;
}

export interface LexResult {
  tokens: Token[];
  errors: Diagnostic[];
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

/** Punctuation and operators keyed by their leading character. */
const TWO_CHAR: Record<string, TokenKind> = {
  "..": "dotdot",
  "<=": "le",
  ">=": "ge",
  "==": "eqeq",
  "!=": "ne",
};
const ONE_CHAR: Record<string, TokenKind> = {
  "{": "lbrace",
  "}": "rbrace",
  "[": "lbracket",
  "]": "rbracket",
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
  ":": "colon",
  "=": "eq",
  "+": "plus",
  "-": "minus",
  "*": "star",
  "%": "percent",
  "<": "lt",
  ">": "gt",
};

/** Bracket kinds that suppress newline emission while open. */
const OPENERS: Partial<Record<TokenKind, true>> = {
  lparen: true,
  lbracket: true,
  lbrace: true,
};
const CLOSERS: Partial<Record<TokenKind, true>> = {
  rparen: true,
  rbracket: true,
  rbrace: true,
};

/** Tokenize `source`. Never throws; unknown characters become error diagnostics. */
export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  const errors: Diagnostic[] = [];

  let i = 0;
  let line = 1;
  let lineStart = 0; // offset of the current line's first char, for col math
  let bracketDepth = 0;
  // Whether the last emitted token could end a statement — used to collapse
  // runs of blank lines into at most one significant newline.
  let pendingNewline = false;

  const push = (kind: TokenKind, text: string, startCol: number): void => {
    tokens.push({ kind, text, line, col: startCol, offset: lineStart + startCol });
  };

  while (i < source.length) {
    const c = source[i];

    // Line comment: `# ... EOL`.
    if (c === "#") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    // Newline.
    if (c === "\n") {
      if (bracketDepth === 0 && !pendingNewline && tokens.length > 0) {
        tokens.push({
          kind: "newline",
          text: "",
          line,
          col: i - lineStart,
          offset: i,
        });
        pendingNewline = true;
      }
      i++;
      line++;
      lineStart = i;
      continue;
    }

    // Whitespace (spaces, tabs, CR).
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }

    const startCol = i - lineStart;

    // Identifiers / keywords.
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j])) j++;
      push("ident", source.slice(i, j), startCol);
      i = j;
      pendingNewline = false;
      continue;
    }

    // Numbers (non-negative integers; unary minus is an operator token).
    if (isDigit(c)) {
      let j = i + 1;
      while (j < source.length && isDigit(source[j])) j++;
      push("number", source.slice(i, j), startCol);
      i = j;
      pendingNewline = false;
      continue;
    }

    // Two-character operators.
    const two = source.slice(i, i + 2);
    const twoKind = TWO_CHAR[two];
    if (twoKind) {
      push(twoKind, two, startCol);
      i += 2;
      pendingNewline = false;
      continue;
    }

    // Single-character punctuation / operators.
    const oneKind = ONE_CHAR[c];
    if (oneKind) {
      if (OPENERS[oneKind]) bracketDepth++;
      else if (CLOSERS[oneKind] && bracketDepth > 0) bracketDepth--;
      push(oneKind, c, startCol);
      i++;
      pendingNewline = false;
      continue;
    }

    // A lone `!` (not `!=`) or `.` (not `..`) or anything else is unknown.
    errors.push({
      message: `Unexpected character ${JSON.stringify(c)}`,
      line,
      col: startCol,
    });
    i++;
  }

  // Always terminate with a synthetic trailing newline (if the source had any
  // real tokens) and an EOF, so the parser can rely on both.
  if (tokens.length > 0 && !pendingNewline) {
    tokens.push({ kind: "newline", text: "", line, col: i - lineStart, offset: i });
  }
  tokens.push({ kind: "eof", text: "", line, col: i - lineStart, offset: i });

  return { tokens, errors };
}
