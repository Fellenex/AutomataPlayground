import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import cytoscape from "cytoscape";
import { validateProgram } from "@automata/nfa-lang";

const SAMPLE = `graph UpperTriangle(n, m):
    symbols { a, b }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    nodes [e] n+1..m
    (i, a, j)  for i in 1..m, j in 1..m if j > i

UpperTriangle(5, 8)
`;

export function App() {
  const editorEl = useRef<HTMLDivElement>(null);
  const graphEl = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState("checking…");

  // CodeMirror editor (placeholder — not yet wired to the parser).
  useEffect(() => {
    if (!editorEl.current) return;
    const view = new EditorView({
      doc: SAMPLE,
      extensions: [basicSetup],
      parent: editorEl.current,
    });
    return () => view.destroy();
  }, []);

  // Cytoscape diagram (placeholder demo graph incl. a self-loop + merged labels).
  useEffect(() => {
    if (!graphEl.current) return;
    const cy = cytoscape({
      container: graphEl.current,
      elements: [
        { data: { id: "1" } },
        { data: { id: "2" } },
        { data: { id: "e12", source: "1", target: "2", label: "a,b" } },
        { data: { id: "loop1", source: "1", target: "1", label: "a" } },
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(id)",
            "text-valign": "center",
            "text-halign": "center",
            color: "#fff",
            "background-color": "#5b8def",
          },
        },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": "#999",
            "target-arrow-color": "#999",
            width: 2,
            "font-size": 10,
          },
        },
      ],
      layout: { name: "grid" },
    });
    return () => cy.destroy();
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

  // Prove the shared @automata/nfa-lang package is wired in on the client.
  const validation = validateProgram(SAMPLE);

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
          <pre className="validation">
            nfa-lang: {validation.errors.join(", ") || "ok"}
          </pre>
        </section>
        <section className="pane">
          <h2>Diagram</h2>
          <div ref={graphEl} className="graph" />
        </section>
      </main>
    </div>
  );
}
