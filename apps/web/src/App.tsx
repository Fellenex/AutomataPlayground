import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { EditorView, basicSetup } from "codemirror";
import { lintGutter } from "@codemirror/lint";
import { analyze } from "@automata/nfa-lang";
import type { AnalysisResult } from "@automata/nfa-lang";
import { nfaLanguage } from "./nfaLanguage";
import { nfaLinter } from "./nfaLinter";
import { Diagram } from "./diagram";
import {
  CreationStore,
  FILE_EXTENSION,
  browserStorage,
  decodeShareHash,
  downloadSource,
  encodeShareHash,
  fromFileName,
} from "./persistence";
import type { Creation } from "./persistence";

const store = new CreationStore(browserStorage());

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
  const viewRef = useRef<EditorView | null>(null);
  // Source as last saved/loaded, to detect unsaved edits before replacing it.
  const baselineRef = useRef(SAMPLE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [creations, setCreations] = useState<Creation[]>(() => store.list());
  const [notice, setNotice] = useState("");

  const currentSource = () => viewRef.current?.state.doc.toString() ?? "";

  /** Replace the editor contents (the update listener re-analyzes them). */
  const loadSource = useCallback((source: string, newName: string): boolean => {
    const view = viewRef.current;
    if (!view) return false;
    const dirty = view.state.doc.toString() !== baselineRef.current;
    if (dirty && !window.confirm("Discard unsaved changes?")) return false;
    baselineRef.current = source;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    setName(newName);
    return true;
  }, []);

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
          // An edited share link no longer describes the editor contents.
          if (window.location.hash) {
            history.replaceState(null, "", window.location.pathname + window.location.search);
          }
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => run(u.state.doc.toString()), 250);
        }),
      ],
      parent: editorEl.current,
    });
    viewRef.current = view;

    run(SAMPLE); // initial paint, before any edit

    return () => {
      if (timer) clearTimeout(timer);
      viewRef.current = null;
      view.destroy();
      diagram.destroy();
    };
  }, []);

  // Open a share link: on first load, and when a new one is pasted into the tab.
  useEffect(() => {
    const openHash = async () => {
      const hash = window.location.hash;
      const source = await decodeShareHash(hash);
      if (source === null) {
        if (hash) setNotice("Couldn't read the shared link.");
        return;
      }
      // Loading rewrites the editor, which clears the hash; restore it so the
      // address bar keeps the link until the user actually edits.
      if (loadSource(source, "")) {
        history.replaceState(null, "", hash);
        setNotice("Loaded shared FSM.");
      }
    };
    void openHash();
    window.addEventListener("hashchange", openHash);
    return () => window.removeEventListener("hashchange", openHash);
  }, [loadSource]);

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice("Name it before saving.");
      return;
    }
    const source = currentSource();
    const existing = store.get(trimmed);
    if (existing && existing.source !== source && !window.confirm(`Overwrite "${trimmed}"?`)) {
      return;
    }
    try {
      store.save(trimmed, source);
    } catch (e) {
      setNotice(`Save failed (${String(e)})`); // e.g. storage quota exceeded
      return;
    }
    baselineRef.current = source;
    setName(trimmed);
    setCreations(store.list());
    setNotice(`Saved "${trimmed}".`);
  };

  const onOpen = (e: ChangeEvent<HTMLSelectElement>) => {
    const creation = store.get(e.target.value);
    if (creation && loadSource(creation.source, creation.name)) {
      setNotice(`Opened "${creation.name}".`);
    }
  };

  const onDelete = () => {
    const trimmed = name.trim();
    if (!store.get(trimmed) || !window.confirm(`Delete "${trimmed}"?`)) return;
    store.remove(trimmed);
    setCreations(store.list());
    setNotice(`Deleted "${trimmed}".`);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow importing the same file again
    if (!file) return;
    if (loadSource(await file.text(), fromFileName(file.name))) {
      setNotice(`Imported ${file.name}.`);
    }
  };

  const onShare = async () => {
    const url = new URL(window.location.href);
    url.hash = await encodeShareHash(currentSource());
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice("Share link copied.");
    } catch {
      // Clipboard can be unavailable (permissions, insecure context): fall back
      // to putting the link in the address bar for manual copying.
      history.replaceState(null, "", url.hash);
      setNotice("Share link is in the address bar.");
    }
  };

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
          <div className="toolbar">
            <input
              className="name"
              placeholder="Untitled"
              aria-label="Creation name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSave()}
            />
            <button onClick={onSave}>Save</button>
            {/* Controlled to "" so it acts as a menu: re-picking an entry still fires. */}
            <select aria-label="Open saved creation" value="" onChange={onOpen}>
              <option value="" disabled>
                {creations.length ? "Open…" : "No saved FSMs"}
              </option>
              {creations.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={onDelete}
              disabled={!creations.some((c) => c.name === name.trim())}
            >
              Delete
            </button>
            <span className="sep" />
            <button onClick={() => fileInputRef.current?.click()}>Import</button>
            <input
              ref={fileInputRef}
              type="file"
              accept={`${FILE_EXTENSION},text/plain`}
              hidden
              onChange={onImport}
            />
            <button onClick={() => downloadSource(name, currentSource())}>Export</button>
            <button onClick={onShare}>Share</button>
            <span className="notice" role="status">
              {notice}
            </span>
          </div>
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
