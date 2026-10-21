import { describe, expect, it } from "vitest";
import { ShareLink } from "./shareLink";

describe("ShareLink", () => {
  it("round-trips source through the URL hash", async () => {
    const source = "graph G(n):\n    symbols { a }\n    (i, a, i+1) for i in 1..n\n\nG(3) — ünïcødé ✓\n";
    const hash = await ShareLink.encode(source);
    expect(hash).toMatch(/^#fsm=[A-Za-z0-9_-]+$/);
    expect(await ShareLink.decode(hash)).toBe(source);
  });

  it("compresses repetitive source", async () => {
    const source = "(i, a, j) for i in 1..m, j in 1..m if j > i\n".repeat(50);
    expect((await ShareLink.encode(source)).length).toBeLessThan(source.length / 4);
  });

  it("rejects non-share and malformed hashes", async () => {
    expect(await ShareLink.decode("")).toBeNull();
    expect(await ShareLink.decode("#other=abc")).toBeNull();
    expect(await ShareLink.decode("#fsm=!!!")).toBeNull();
    expect(await ShareLink.decode("#fsm=AAAA")).toBeNull();
  });
});
