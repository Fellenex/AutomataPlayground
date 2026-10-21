import { describe, expect, it } from "vitest";
import {
  CreationStore,
  decodeShareHash,
  encodeShareHash,
  fromFileName,
  toFileName,
} from "./persistence";
import type { StorageLike } from "./persistence";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("CreationStore", () => {
  it("saves, lists newest first, and loads by name", () => {
    const store = new CreationStore(memoryStorage());
    store.save("a", "src a", 1);
    store.save("b", "src b", 2);
    expect(store.list().map((c) => c.name)).toEqual(["b", "a"]);
    expect(store.get("a")?.source).toBe("src a");
    expect(store.get("missing")).toBeUndefined();
  });

  it("overwrites an existing name instead of duplicating it", () => {
    const store = new CreationStore(memoryStorage());
    store.save("a", "v1", 1);
    store.save("b", "x", 2);
    store.save("a", "v2", 3);
    expect(store.list()).toEqual([
      { name: "a", source: "v2", updatedAt: 3 },
      { name: "b", source: "x", updatedAt: 2 },
    ]);
  });

  it("removes by name", () => {
    const store = new CreationStore(memoryStorage());
    store.save("a", "x", 1);
    store.save("b", "y", 2);
    store.remove("a");
    expect(store.list().map((c) => c.name)).toEqual(["b"]);
  });

  it("persists across store instances sharing one storage", () => {
    const storage = memoryStorage();
    new CreationStore(storage).save("a", "x", 1);
    expect(new CreationStore(storage).get("a")?.source).toBe("x");
  });

  it("tolerates corrupt or foreign storage contents", () => {
    const storage = memoryStorage();
    const store = new CreationStore(storage);
    const key = "automata-playground:creations:v1";
    storage.data.set(key, "{not json");
    expect(store.list()).toEqual([]);
    storage.data.set(key, JSON.stringify({ name: "a" }));
    expect(store.list()).toEqual([]);
    storage.data.set(
      key,
      JSON.stringify([{ name: "a" }, { name: "b", source: "s", updatedAt: 1 }]),
    );
    expect(store.list().map((c) => c.name)).toEqual(["b"]);
  });
});

describe(".fsm file names", () => {
  it("sanitizes creation names into file names", () => {
    expect(toFileName("Upper Triangle")).toBe("Upper_Triangle.fsm");
    expect(toFileName("a/b\\c")).toBe("a_b_c.fsm");
    expect(toFileName("  ")).toBe("untitled.fsm");
  });

  it("strips the extension on import", () => {
    expect(fromFileName("UpperTriangle.fsm")).toBe("UpperTriangle");
    expect(fromFileName("x.FSM")).toBe("x");
    expect(fromFileName("notes.txt")).toBe("notes.txt");
  });
});

describe("share links", () => {
  it("round-trips source through the URL hash", async () => {
    const source = "graph G(n):\n    symbols { a }\n    (i, a, i+1) for i in 1..n\n\nG(3) — ünïcødé ✓\n";
    const hash = await encodeShareHash(source);
    expect(hash).toMatch(/^#fsm=[A-Za-z0-9_-]+$/);
    expect(await decodeShareHash(hash)).toBe(source);
  });

  it("compresses repetitive source", async () => {
    const source = "(i, a, j) for i in 1..m, j in 1..m if j > i\n".repeat(50);
    expect((await encodeShareHash(source)).length).toBeLessThan(source.length / 4);
  });

  it("rejects non-share and malformed hashes", async () => {
    expect(await decodeShareHash("")).toBeNull();
    expect(await decodeShareHash("#other=abc")).toBeNull();
    expect(await decodeShareHash("#fsm=!!!")).toBeNull();
    expect(await decodeShareHash("#fsm=AAAA")).toBeNull();
  });
});
