import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { lintGutter } from "@codemirror/lint";
import { analyze } from "@automata/nfa-lang";
import type { AnalysisResult } from "@automata/nfa-lang";
import { nfaLanguage } from "./nfaLanguage";
import { nfaLinter } from "./nfaLinter";
import { Diagram } from "./diagram";

const SAMPLE = `graph UpperTriangle(n, m):
    symbols { a, b }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    nodes [e] n+1..m
    (i, a, j)  for i in 1..m, j in 1..m if j > i

UpperTriangle(5, 8)
`;

// Minimal dark theme so the editor blends with the app's panel colours.
const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#26262e", color: "#e6e6ea", height: "100%" },
    ".cm-content": { caretColor: "#e6e6ea" },
    ".cm-gutters": {
      backgroundColor: "#26262e",
      color: "#6b6b78",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.04)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "rgba(91,141,239,0.25)",
    },
  },
  { dark: true },
);

/** Human-readable summary of the latest analysis for the status line. */
function summarize(result: AnalysisResult): string {
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
  if (result.ok) {
    const { nodes, edges } = result.graph ?? { nodes: [], edges: [] };
    const w = warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : "";
    return `ok — ${nodes.length} nodes, ${edges.length} edges${w}`;
  }
  const e = `${errors} error${errors === 1 ? "" : "s"}`;
  const w = warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : "";
  return `${e}${w}`;
}

export function App() {
  const editorEl = useRef<HTMLDivElement>(null);
  const graphEl = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState("checking…");
  const [status, setStatus] = useState("…");

  // Editor + diagram share one effect so the debounced update closure can drive
  // both: CodeMirror lints on its own schedule; the diagram re-renders here.
  useEffect(() => {
    if (!editorEl.current || !graphEl.current) return;
    const diagram = new Diagram(graphEl.current);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (source: string) => {
      const result = analyze(source);
      setStatus(summarize(result));
      diagram.render(result.graph ?? null);
    };

    const view = new EditorView({
      doc: SAMPLE,
      extensions: [
        basicSetup,
        darkTheme,
        nfaLanguage(),
        nfaLinter(),
        lintGutter(),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => run(u.state.doc.toString()), 250);
        }),
      ],
      parent: editorEl.current,
    });

    run(SAMPLE); // initial paint, before any edit

    return () => {
      if (timer) clearTimeout(timer);
      view.destroy();
      diagram.destroy();
    };
  }, []);

  // Prove the Vite → server proxy works.
  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setHealth(JSON.stringify(d)))
      .catch((e: unknown) => setHealth(`unreachable (${String(e)})`));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Automata Playground</h1>
        <span className="status">api: {health}</span>
      </header>
      <main className="panes">
        <section className="pane">
          <h2>DSL</h2>
          <div ref={editorEl} className="editor" />
          <pre className="validation">nfa-lang: {status}</pre>
        </section>
        <section className="pane">
          <h2>Diagram</h2>
          <div ref={graphEl} className="graph" />
        </section>
      </main>
    </div>
  );
}
