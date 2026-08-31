import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";
import { parseProgram } from "./parser";
import type {
  EdgeStmt,
  GraphDef,
  Instantiation,
  NodeDecl,
  Program,
} from "./ast";

function parse(source: string): { program: Program; errors: string[] } {
  const { tokens } = tokenize(source);
  const { program, errors } = parseProgram(tokens, source);
  return { program, errors: errors.map((e) => e.message) };
}

/** Parse and assert no errors, returning the program. */
function parseOk(source: string): Program {
  const { program, errors } = parse(source);
  expect(errors).toEqual([]);
  return program;
}

const UPPER_TRIANGLE = `graph UpperTriangle(n, m):
    symbols { a, b }
    nodeTypes [ u, e ]
    nodes [u] 1..n
    nodes [e] n+1..m
    (i, a, j)  for i in 1..m, j in 1..m if j > i

UpperTriangle(5, 8)`;

describe("parser — graph structure", () => {
  it("parses the UpperTriangle grammar example end to end", () => {
    const program = parseOk(UPPER_TRIANGLE);
    expect(program.items).toHaveLength(2);

    const g = program.items[0] as GraphDef;
    expect(g.kind).toBe("graph");
    expect(g.name).toBe("UpperTriangle");
    expect(g.params).toEqual(["n", "m"]);
    expect(g.body.map((s) => s.kind)).toEqual([
      "symbols",
      "nodeTypes",
      "nodes",
      "nodes",
      "edge",
    ]);

    const inst = program.items[1] as Instantiation;
    expect(inst.kind).toBe("instantiate");
    expect(inst.name).toBe("UpperTriangle");
    expect(inst.args.map((a) => a.text)).toEqual(["5", "8"]);
  });

  it("captures symbols (ordered) and nodeTypes declarations", () => {
    const g = parseOk("graph G:\n  symbols { a, b, c }\n  nodeTypes [ u, e ]") as never;
    const graph = (g as Program).items[0] as GraphDef;
    const [sym, nt] = graph.body;
    expect(sym).toMatchObject({ kind: "symbols", symbols: ["a", "b", "c"] });
    expect(nt).toMatchObject({ kind: "nodeTypes", types: ["u", "e"] });
  });

  it("distinguishes bare vs bracketed node declarations", () => {
    const bare = (parseOk("graph G:\n  nodes 1..n").items[0] as GraphDef)
      .body[0] as NodeDecl;
    expect(bare).toMatchObject({ bracketed: false, types: [] });
    expect(bare.nodes.kind).toBe("range");

    const typed = (parseOk("graph G:\n  nodes [u,v] 1..n").items[0] as GraphDef)
      .body[0] as NodeDecl;
    expect(typed).toMatchObject({ bracketed: true, types: ["u", "v"] });

    const empty = (parseOk("graph G:\n  nodes [] 1..n").items[0] as GraphDef)
      .body[0] as NodeDecl;
    expect(empty).toMatchObject({ bracketed: true, types: [] });
  });
});

describe("parser — edge triples", () => {
  function edge(src: string): EdgeStmt {
    const g = parseOk(`graph G:\n  ${src}`).items[0] as GraphDef;
    return g.body[0] as EdgeStmt;
  }

  it("parses a single triple", () => {
    const e = edge("(1, a, 2)");
    expect(e.src).toMatchObject({ kind: "single" });
    expect(e.label).toEqual(expect.objectContaining({ kind: "single", sym: "a" }));
    expect(e.tgt).toMatchObject({ kind: "single" });
    expect(e.comprehension).toBeUndefined();
  });

  it("parses set endpoints and multi-label sets", () => {
    const e = edge("({1,2}, {a,b}, {3,4})");
    expect(e.src).toMatchObject({ kind: "set" });
    expect(e.label).toEqual(expect.objectContaining({ kind: "set", syms: ["a", "b"] }));
    expect(e.tgt).toMatchObject({ kind: "set" });
    expect((e.src as { items: unknown[] }).items).toHaveLength(2);
  });

  it("parses ranges in endpoint and label positions", () => {
    const e = edge("(1, a, 1..5)");
    expect(e.tgt).toMatchObject({ kind: "range" });

    const lr = edge("(1, a..c, 2)");
    expect(lr.label).toEqual(
      expect.objectContaining({ kind: "range", lo: "a", hi: "c" }),
    );
  });

  it("keeps arithmetic range bounds as raw expression text", () => {
    const e = edge("(1, a, n+1..2*m)");
    expect(e.tgt.kind).toBe("range");
    const range = e.tgt as { lo: { text: string }; hi: { text: string } };
    expect(range.lo.text).toBe("n+1");
    expect(range.hi.text).toBe("2*m");
  });

  it("parses a comprehension with bindings and a guard", () => {
    const e = edge("(i, a, j) for i in 1..m, j in 1..m if j > i");
    expect(e.comprehension?.bindings.map((b) => b.name)).toEqual(["i", "j"]);
    expect(e.comprehension?.guard?.text).toBe("j > i");
  });

  it("parses a comprehension with no guard", () => {
    const e = edge("(i, a, j) for i in 1..n");
    expect(e.comprehension?.bindings).toHaveLength(1);
    expect(e.comprehension?.guard).toBeUndefined();
  });
});

describe("parser — let and instantiation", () => {
  it("parses a let binding with a raw right-hand side", () => {
    const g = parseOk("graph G(n):\n  let k = n + 1").items[0] as GraphDef;
    expect(g.body[0]).toMatchObject({ kind: "let", name: "k" });
    expect((g.body[0] as { value: { text: string } }).value.text).toBe("n + 1");
  });

  it("parses a zero-argument instantiation", () => {
    const p = parseOk("graph G:\n  nodes 1..3\n\nG()");
    expect(p.items[1]).toMatchObject({ kind: "instantiate", name: "G", args: [] });
  });
});

describe("parser — Pratt expressions at expr sites (#6)", () => {
  it("attaches a parsed tree to a range bound", () => {
    const g = parseOk("graph G(n, m):\n  nodes n+1..2*m").items[0] as GraphDef;
    const range = (g.body[0] as NodeDecl).nodes as {
      lo: { expr: unknown };
      hi: { expr: unknown };
    };
    expect(range.lo.expr).toMatchObject({
      kind: "binary",
      op: "+",
      left: { kind: "var", name: "n" },
      right: { kind: "num", value: 1 },
    });
    expect(range.hi.expr).toMatchObject({ kind: "binary", op: "*" });
  });

  it("attaches a parsed tree to a let RHS and instantiation args", () => {
    const g = parseOk("graph G(n):\n  let k = n + 1").items[0] as GraphDef;
    expect((g.body[0] as { value: { expr: unknown } }).value.expr).toMatchObject({
      kind: "binary",
      op: "+",
    });

    const inst = parseOk("graph G(n):\n  nodes 1..n\n\nG(2 * 3)")
      .items[1] as Instantiation;
    expect(inst.args[0].expr).toMatchObject({ kind: "binary", op: "*" });
  });

  it("parses a comprehension guard into a comparison tree", () => {
    const e = parseOk("graph G:\n  (i, a, j) for i in 1..3, j in 1..3 if j > i")
      .items[0] as GraphDef;
    const guard = (e.body[0] as EdgeStmt).comprehension?.guard;
    expect(guard?.expr).toMatchObject({
      kind: "binary",
      op: ">",
      left: { kind: "var", name: "j" },
      right: { kind: "var", name: "i" },
    });
  });

  it("surfaces a malformed arithmetic expression as a parse error", () => {
    const { errors } = parse("graph G(n):\n  let k = n +");
    expect(errors.some((m) => /Expected an expression/.test(m))).toBe(true);
  });
});

describe("parser — error recovery", () => {
  it("recovers to the next line and keeps reporting", () => {
    const { program, errors } = parse(
      "graph G:\n  = not a statement\n  symbols { a }",
    );
    // The first body line is malformed; the parser resyncs and still parses the
    // `symbols` declaration on the next line.
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const g = program.items[0] as GraphDef;
    expect(g.body.some((s) => s.kind === "symbols")).toBe(true);
  });

  it("reports a helpful message for a missing paren", () => {
    const { errors } = parse("graph G:\n  (1, a, 2");
    expect(errors[0]).toMatch(/Expected/);
  });

  it("errors on a top-level statement that is neither graph nor instantiation", () => {
    const { errors } = parse("nodes 1..3");
    // `nodes` is a bare ident at top level -> treated as instantiation `nodes`
    // followed by an unexpected range; the trailing tokens are the error.
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
