// CodeMirror linter that runs the nfa-lang pipeline and surfaces its structured
// diagnostics in the gutter. `linter()` debounces re-runs, so this parses only
// after the user pauses typing.

import { linter } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import { analyze } from "@automata/nfa-lang";

const isWordChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

/**
 * Map a diagnostic's 1-based line / 0-based col to a document offset range.
 * Highlights the word at that position when there is one, else a single column.
 */
function range(doc: Text, source: string, line1: number, col0: number): {
  from: number;
  to: number;
} {
  const lineNo = Math.min(Math.max(line1, 1), doc.lines);
  const line = doc.line(lineNo);
  const from = Math.min(line.from + Math.max(col0, 0), line.to);
  let to = from;
  if (from < line.to && isWordChar(source[from])) {
    while (to < line.to && isWordChar(source[to])) to++;
  } else {
    to = Math.min(from + 1, line.to);
  }
  return { from, to: Math.max(to, from) };
}

/** Linter extension: live nfa-lang validation with a short debounce. */
export function nfaLinter() {
  return linter(
    (view) => {
      const doc = view.state.doc;
      const source = doc.toString();
      const { diagnostics } = analyze(source);
      return diagnostics.map<CmDiagnostic>((d) => ({
        ...range(doc, source, d.line, d.col),
        severity: d.severity,
        message: d.message,
      }));
    },
    { delay: 250 },
  );
}
