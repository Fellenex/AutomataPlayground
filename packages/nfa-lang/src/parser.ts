// Recursive-descent parser for nfa-lang's structure (see docs/GRAMMAR.md).
//
// It builds the AST in ast.ts. Every expression position is captured as a
// RawExpr — its token slice plus the parsed tree from the Pratt sub-parser (#6,
// see expr.ts). Graph bodies are grouped by indentation — a statement belongs
// to a graph iff it starts to the right of the `graph` keyword.
//
// Parsing is resilient: a malformed statement records one diagnostic, then the
// parser resynchronizes to the next line and keeps going, so a single typo does
// not hide every later error.

import type {
  BodyStmt,
  EdgeStmt,
  ForBinding,
  GraphDef,
  Instantiation,
  Item,
  LabelSpec,
  LetDecl,
  NodeDecl,
  NodeSet,
  NodeTypesDecl,
  Pos,
  Program,
  RawExpr,
  SymbolsDecl,
} from "./ast";
import { parseExpr } from "./expr";
import type { Token, TokenKind } from "./tokens";

export interface Diagnostic {
  message: string;
  line: number;
  col: number;
}

export interface ParseResult {
  program: Program;
  errors: Diagnostic[];
}

/** Internal control-flow signal; caught at each statement boundary to recover. */
class ParseError extends Error {
  constructor(readonly diag: Diagnostic) {
    super(diag.message);
  }
}

/** Human-readable rendering of a token for error messages. */
function describe(tok: Token): string {
  switch (tok.kind) {
    case "eof":
      return "end of input";
    case "newline":
      return "end of line";
    case "ident":
    case "number":
      return `'${tok.text}'`;
    default:
      return `'${tok.text}'`;
  }
}

export function parseProgram(tokens: Token[], source: string): ParseResult {
  const p = new Parser(tokens, source);
  return p.parseProgram();
}

class Parser {
  private pos = 0;
  private readonly errors: Diagnostic[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  // ---- token cursor helpers ------------------------------------------------

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private atKeyword(value: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && t.text === value;
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  private posOf(t: Token): Pos {
    return { line: t.line, col: t.col, offset: t.offset };
  }

  private fail(message: string, tok: Token = this.peek()): never {
    throw new ParseError({ message, line: tok.line, col: tok.col });
  }

  private expect(kind: TokenKind, what?: string): Token {
    if (this.at(kind)) return this.advance();
    this.fail(
      `Expected ${what ?? `'${kind}'`} but found ${describe(this.peek())}`,
    );
  }

  private expectKeyword(value: string): Token {
    if (this.atKeyword(value)) return this.advance();
    this.fail(`Expected '${value}' but found ${describe(this.peek())}`);
  }

  private expectIdent(what: string): Token {
    if (this.at("ident")) return this.advance();
    this.fail(`Expected ${what} but found ${describe(this.peek())}`);
  }

  /** Skip blank lines. */
  private skipNewlines(): void {
    while (this.at("newline")) this.advance();
  }

  /** Consume the newline (or EOF) that ends a statement. */
  private endStatement(): void {
    if (this.at("eof")) return;
    this.expect("newline", "end of line");
  }

  /** Recover after a ParseError: drop tokens up to and including the next newline. */
  private synchronize(): void {
    while (!this.at("newline") && !this.at("eof")) this.advance();
    if (this.at("newline")) this.advance();
  }

  // ---- program / items -----------------------------------------------------

  parseProgram(): ParseResult {
    const items: Item[] = [];
    this.skipNewlines();
    while (!this.at("eof")) {
      try {
        items.push(this.parseItem());
      } catch (e) {
        if (e instanceof ParseError) {
          this.errors.push(e.diag);
          this.synchronize();
        } else {
          throw e;
        }
      }
      this.skipNewlines();
    }
    return { program: { items }, errors: this.errors };
  }

  private parseItem(): Item {
    if (this.atKeyword("graph")) return this.parseGraph();
    if (this.at("ident")) return this.parseInstantiation();
    this.fail(
      `Expected a graph definition or instantiation but found ${describe(this.peek())}`,
    );
  }

  private parseGraph(): GraphDef {
    const kw = this.expectKeyword("graph");
    const graphCol = kw.col;
    const name = this.expectIdent("a graph name").text;

    const params: string[] = [];
    if (this.at("lparen")) {
      this.advance();
      if (!this.at("rparen")) {
        params.push(this.expectIdent("a parameter name").text);
        while (this.at("comma")) {
          this.advance();
          params.push(this.expectIdent("a parameter name").text);
        }
      }
      this.expect("rparen", "')' to close the parameter list");
    }
    this.expect("colon", "':' after the graph header");
    this.endStatement();

    const body: BodyStmt[] = [];
    for (;;) {
      this.skipNewlines();
      const next = this.peek();
      if (next.kind === "eof" || next.col <= graphCol) break;
      try {
        body.push(this.parseBodyStmt());
      } catch (e) {
        if (e instanceof ParseError) {
          this.errors.push(e.diag);
          this.synchronize();
        } else {
          throw e;
        }
      }
    }

    return { kind: "graph", name, params, body, pos: this.posOf(kw) };
  }

  private parseInstantiation(): Instantiation {
    const nameTok = this.expectIdent("a graph name");
    const args: RawExpr[] = [];
    if (this.at("lparen")) {
      this.advance();
      if (!this.at("rparen")) {
        args.push(this.captureRawExpr(new Set(["comma", "rparen"])));
        while (this.at("comma")) {
          this.advance();
          args.push(this.captureRawExpr(new Set(["comma", "rparen"])));
        }
      }
      this.expect("rparen", "')' to close the argument list");
    }
    this.endStatement();
    return {
      kind: "instantiate",
      name: nameTok.text,
      args,
      pos: this.posOf(nameTok),
    };
  }

  // ---- body statements -----------------------------------------------------

  private parseBodyStmt(): BodyStmt {
    if (this.atKeyword("symbols")) return this.parseSymbols();
    if (this.atKeyword("nodeTypes")) return this.parseNodeTypes();
    if (this.atKeyword("nodes")) return this.parseNodes();
    if (this.atKeyword("let")) return this.parseLet();
    if (this.at("lparen")) return this.parseEdge();
    this.fail(`Unexpected ${describe(this.peek())} at start of statement`);
  }

  private parseSymbols(): SymbolsDecl {
    const kw = this.expectKeyword("symbols");
    this.expect("lbrace", "'{' after 'symbols'");
    const symbols: string[] = [];
    if (!this.at("rbrace")) {
      symbols.push(this.expectIdent("a symbol").text);
      while (this.at("comma")) {
        this.advance();
        symbols.push(this.expectIdent("a symbol").text);
      }
    }
    this.expect("rbrace", "'}' to close the symbols list");
    this.endStatement();
    return { kind: "symbols", symbols, pos: this.posOf(kw) };
  }

  private parseNodeTypes(): NodeTypesDecl {
    const kw = this.expectKeyword("nodeTypes");
    this.expect("lbracket", "'[' after 'nodeTypes'");
    const types: string[] = [];
    if (!this.at("rbracket")) {
      types.push(this.expectIdent("a node type").text);
      while (this.at("comma")) {
        this.advance();
        types.push(this.expectIdent("a node type").text);
      }
    }
    this.expect("rbracket", "']' to close the nodeTypes list");
    this.endStatement();
    return { kind: "nodeTypes", types, pos: this.posOf(kw) };
  }

  private parseNodes(): NodeDecl {
    const kw = this.expectKeyword("nodes");
    let bracketed = false;
    const types: string[] = [];
    if (this.at("lbracket")) {
      bracketed = true;
      this.advance();
      if (!this.at("rbracket")) {
        types.push(this.expectIdent("a node type").text);
        while (this.at("comma")) {
          this.advance();
          types.push(this.expectIdent("a node type").text);
        }
      }
      this.expect("rbracket", "']' to close the classification list");
    }
    const nodes = this.parseNodeSet(new Set(), new Set());
    this.endStatement();
    return { kind: "nodes", types, bracketed, nodes, pos: this.posOf(kw) };
  }

  private parseLet(): LetDecl {
    const kw = this.expectKeyword("let");
    const name = this.expectIdent("a variable name").text;
    this.expect("eq", "'=' in a let binding");
    const value = this.captureRawExpr(new Set());
    this.endStatement();
    return { kind: "let", name, value, pos: this.posOf(kw) };
  }

  private parseEdge(): EdgeStmt {
    const open = this.expect("lparen", "'(' to open an edge triple");
    const src = this.parseNodeSet(new Set(["comma"]), new Set());
    this.expect("comma", "',' after the edge source");
    const label = this.parseLabel();
    this.expect("comma", "',' after the edge label");
    const tgt = this.parseNodeSet(new Set(["rparen"]), new Set());
    this.expect("rparen", "')' to close the edge triple");

    let comprehension: EdgeStmt["comprehension"];
    if (this.atKeyword("for")) {
      this.advance();
      const bindings: ForBinding[] = [this.parseForBinding()];
      while (this.at("comma")) {
        this.advance();
        bindings.push(this.parseForBinding());
      }
      let guard: RawExpr | undefined;
      if (this.atKeyword("if")) {
        this.advance();
        guard = this.captureRawExpr(new Set());
      }
      comprehension = { bindings, guard };
    }

    this.endStatement();
    return { kind: "edge", src, label, tgt, comprehension, pos: this.posOf(open) };
  }

  private parseForBinding(): ForBinding {
    const nameTok = this.expectIdent("a loop variable");
    this.expectKeyword("in");
    const range = this.parseNodeSet(new Set(["comma"]), new Set(["if"]));
    return { name: nameTok.text, range, pos: this.posOf(nameTok) };
  }

  // ---- specs ---------------------------------------------------------------

  /**
   * Parse a set of node ids: `{ e, ... }`, a range `lo..hi`, or a single expr.
   * `termKinds`/`termIdents` are the tokens that terminate this spec in the
   * caller's context (never consumed); a `..` always splits a range.
   */
  private parseNodeSet(
    termKinds: Set<TokenKind>,
    termIdents: Set<string>,
  ): NodeSet {
    const start = this.peek();
    if (this.at("lbrace")) {
      this.advance();
      const items: RawExpr[] = [];
      if (!this.at("rbrace")) {
        items.push(this.captureRawExpr(new Set(["comma", "rbrace"])));
        while (this.at("comma")) {
          this.advance();
          items.push(this.captureRawExpr(new Set(["comma", "rbrace"])));
        }
      }
      this.expect("rbrace", "'}' to close the set");
      return { kind: "set", items, pos: this.posOf(start) };
    }

    const loStops = new Set(termKinds);
    loStops.add("dotdot");
    const lo = this.captureRawExpr(loStops, termIdents);
    if (this.at("dotdot")) {
      this.advance();
      const hi = this.captureRawExpr(termKinds, termIdents);
      return { kind: "range", lo, hi, pos: this.posOf(start) };
    }
    return { kind: "single", value: lo, pos: this.posOf(start) };
  }

  /** Parse an edge label: `{ s, ... }`, a symbol range `a..c`, or one symbol. */
  private parseLabel(): LabelSpec {
    const start = this.peek();
    if (this.at("lbrace")) {
      this.advance();
      const syms: string[] = [];
      if (!this.at("rbrace")) {
        syms.push(this.expectIdent("a symbol").text);
        while (this.at("comma")) {
          this.advance();
          syms.push(this.expectIdent("a symbol").text);
        }
      }
      this.expect("rbrace", "'}' to close the label set");
      return { kind: "set", syms, pos: this.posOf(start) };
    }

    const lo = this.expectIdent("a symbol").text;
    if (this.at("dotdot")) {
      this.advance();
      const hi = this.expectIdent("a symbol").text;
      return { kind: "range", lo, hi, pos: this.posOf(start) };
    }
    return { kind: "single", sym: lo, pos: this.posOf(start) };
  }

  // ---- raw expression capture ---------------------------------------------

  /**
   * Capture the token slice of one arithmetic expression, stopping (but not
   * consuming) at a terminator at bracket depth 0, or at end of line/input, then
   * hand the slice to the Pratt sub-parser (#6) to build its {@link RawExpr.expr}
   * tree. A malformed expression records one diagnostic and yields `expr: null`;
   * structural parsing continues so later statements are still reported.
   */
  private captureRawExpr(
    stopKinds: Set<TokenKind>,
    stopIdents: Set<string> = new Set(),
  ): RawExpr {
    const first = this.peek();
    const collected: Token[] = [];
    let depth = 0;

    for (;;) {
      const t = this.peek();
      if (t.kind === "eof" || t.kind === "newline") break;
      if (depth === 0) {
        if (stopKinds.has(t.kind)) break;
        if (t.kind === "ident" && stopIdents.has(t.text)) break;
      }
      if (t.kind === "lparen" || t.kind === "lbracket" || t.kind === "lbrace") {
        depth++;
      } else if (
        t.kind === "rparen" ||
        t.kind === "rbracket" ||
        t.kind === "rbrace"
      ) {
        if (depth === 0) break; // unbalanced closer terminates the expr
        depth--;
      }
      collected.push(t);
      this.advance();
    }

    if (collected.length === 0) {
      this.fail("Expected an expression", first);
    }
    const last = collected[collected.length - 1];
    const text = this.source.slice(first.offset, last.offset + last.text.length);

    const { expr, errors } = parseExpr(collected);
    for (const err of errors) this.errors.push(err);

    return {
      kind: "rawExpr",
      tokens: collected,
      text,
      expr,
      pos: this.posOf(first),
    };
  }
}
