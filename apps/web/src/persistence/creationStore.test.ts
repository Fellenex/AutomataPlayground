import { describe, expect, it } from "vitest";
import { CreationStore, STORAGE_KEY } from "./creationStore";
import { MemoryStorage } from "./storage";

describe("CreationStore", () => {
  it("saves, lists newest first, and loads by name", () => {
    const store = new CreationStore(new MemoryStorage());
    store.save("a", "src a", 1);
    store.save("b", "src b", 2);
    expect(store.list().map((c) => c.name)).toEqual(["b", "a"]);
    expect(store.get("a")?.source).toBe("src a");
    expect(store.get("missing")).toBeUndefined();
  });

  it("overwrites an existing name instead of duplicating it", () => {
    const store = new CreationStore(new MemoryStorage());
    store.save("a", "v1", 1);
    store.save("b", "x", 2);
    store.save("a", "v2", 3);
    expect(store.list()).toEqual([
      { name: "a", source: "v2", updatedAt: 3 },
      { name: "b", source: "x", updatedAt: 2 },
    ]);
  });

  it("saveAsNew picks a free name instead of overwriting", () => {
    const store = new CreationStore(new MemoryStorage());
    store.save("a", "v1", 1);
    expect(store.saveAsNew("a", "v1", 2).name).toBe("a"); // same source: reuse
    expect(store.saveAsNew("a", "v2", 3).name).toBe("a (2)");
    expect(store.saveAsNew("a", "v3", 4).name).toBe("a (3)");
    expect(store.saveAsNew("a", "v2", 5).name).toBe("a (2)");
    expect(store.saveAsNew("  ", "x", 6).name).toBe("untitled");
    expect(store.get("a")?.source).toBe("v1");
    expect(store.list()).toHaveLength(4);
  });

  it("removes by name", () => {
    const store = new CreationStore(new MemoryStorage());
    store.save("a", "x", 1);
    store.save("b", "y", 2);
    store.remove("a");
    expect(store.list().map((c) => c.name)).toEqual(["b"]);
  });

  it("persists across store instances sharing one storage", () => {
    const storage = new MemoryStorage();
    new CreationStore(storage).save("a", "x", 1);
    expect(new CreationStore(storage).get("a")?.source).toBe("x");
  });

  it("tolerates corrupt or foreign storage contents", () => {
    const storage = new MemoryStorage();
    const store = new CreationStore(storage);
    storage.setItem(STORAGE_KEY, "{not json");
    expect(store.list()).toEqual([]);
    storage.setItem(STORAGE_KEY, JSON.stringify({ name: "a" }));
    expect(store.list()).toEqual([]);
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ name: "a" }, { name: "b", source: "s", updatedAt: 1 }]),
    );
    expect(store.list().map((c) => c.name)).toEqual(["b"]);
  });
});
