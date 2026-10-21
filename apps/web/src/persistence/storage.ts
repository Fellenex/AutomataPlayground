/** The subset of the Web Storage API we rely on (injectable for tests). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** A `StorageLike` that keeps values in memory for the page's lifetime. */
export class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/**
 * `localStorage`, or a `MemoryStorage` when the browser blocks it (e.g.
 * disabled site data), so the app still works and saves last for the session.
 */
export function browserStorage(): StorageLike {
  try {
    const storage = window.localStorage;
    storage.getItem("automata-playground:probe"); // some browsers only throw on access
    return storage;
  } catch {
    return new MemoryStorage();
  }
}
