// CodeMirror language support for nfa-lang: a stream tokenizer for syntax
// highlighting plus a completion source seeded from the program's own
// declarations (symbols, nodeTypes, graph names).
//
// The tokenizer mirrors the real lexer's rules (see the nfa-lang package) so the
// colours match how the parser actually reads the source: `#` line comments,
// structural KEYWORDS, the EXPR_RESERVED operator words, numbers, the multi- and
// single-character operators, brackets, and everything else as a variable.

import {
  StreamLanguage,
  LanguageSupport,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import {
  KEYWORDS,
  EXPR_RESERVED,
  tokenize,
  parseProgram,
} from "@automata/nfa-lang";

// Longest-first so `<=`/`>=`/`==`/`!=`/`..` win over their single-char prefixes.
const OPERATORS = ["<=", ">=", "==", "!=", "..", "+", "-", "*", "%", "=", "<", ">"];

const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean =>
  isIdentStart(c) || (c >= "0" && c <= "9");

/** Stream tokenizer mirroring the nfa-lang lexer's classification. */
const nfaStreamParser = StreamLanguage.define<Record<string, never>>({
  token(stream) {
    if (stream.eatSpace()) return null;

    // `# ... EOL` line comment.
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    const c = stream.peek() ?? "";

    // Identifier or keyword.
    if (isIdentStart(c)) {
      let word = "";
      while (!stream.eol() && isIdentPart(stream.peek() ?? "")) {
        word += stream.next();
      }
      if (KEYWORDS.has(word)) return "keyword";
      if (EXPR_RESERVED.has(word)) return "operatorKeyword";
      return "variableName";
    }

    // Number.
    if (c >= "0" && c <= "9") {
      while (!stream.eol()) {
        const d = stream.peek() ?? "";
        if (d >= "0" && d <= "9") stream.next();
        else break;
      }
      return "number";
    }

    // Multi- then single-character operators.
    for (const op of OPERATORS) {
      if (stream.match(op)) return "operator";
    }

    // Brackets and structural punctuation.
    if ("([{".includes(c)) {
      stream.next();
      return "bracket";
    }
    if (")]}".includes(c)) {
      stream.next();
      return "bracket";
    }
    if (c === "," || c === ":") {
      stream.next();
      return "punctuation";
    }

    // Anything else: consume one char so the stream always advances.
    stream.next();
    return null;
  },
});

// Dark-theme highlight palette, tuned to the app's surface colours.
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#c586c0" },
  { tag: t.operatorKeyword, color: "#569cd6" },
  { tag: t.number, color: "#b5cea8" },
  { tag: t.operator, color: "#d4d4d4" },
  { tag: t.variableName, color: "#9cdcfe" },
  { tag: t.comment, color: "#6a9955", fontStyle: "italic" },
  { tag: t.punctuation, color: "#c8c8c8" },
]);

/** Category shown in the completion popup's detail column. */
interface Declared {
  symbols: Set<string>;
  nodeTypes: Set<string>;
  graphs: Set<string>;
}

/** Walk whatever parsed cleanly and collect the user's own vocabulary. */
function collectDeclarations(source: string): Declared {
  const symbols = new Set<string>();
  const nodeTypes = new Set<string>();
  const graphs = new Set<string>();
  try {
    const lex = tokenize(source);
    const { program } = parseProgram(lex.tokens, source);
    for (const item of program.items) {
      if (item.kind !== "graph") continue;
      graphs.add(item.name);
      for (const stmt of item.body) {
        if (stmt.kind === "symbols") for (const s of stmt.symbols) symbols.add(s);
        else if (stmt.kind === "nodeTypes") for (const n of stmt.types) nodeTypes.add(n);
      }
    }
  } catch {
    // Mid-edit the source often will not parse; partial vocabulary is fine.
  }
  return { symbols, nodeTypes, graphs };
}

/** Completion source: keywords + the program's declared vocabulary. */
function nfaCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_]\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const { symbols, nodeTypes, graphs } = collectDeclarations(context.state.doc.toString());
  const options = [
    ...[...KEYWORDS].map((label) => ({ label, type: "keyword", detail: "keyword" })),
    ...[...EXPR_RESERVED].map((label) => ({ label, type: "keyword", detail: "operator" })),
    ...[...symbols].map((label) => ({ label, type: "constant", detail: "symbol" })),
    ...[...nodeTypes].map((label) => ({ label, type: "type", detail: "nodeType" })),
    ...[...graphs].map((label) => ({ label, type: "function", detail: "graph" })),
  ];

  return { from: word.from, options, validFor: /^[A-Za-z_]\w*$/ };
}

/** Full language support: highlighting + declaration-aware autocomplete. */
export function nfaLanguage(): LanguageSupport {
  return new LanguageSupport(nfaStreamParser, [
    syntaxHighlighting(highlightStyle),
    nfaStreamParser.data.of({ autocomplete: nfaCompletions }),
  ]);
}
