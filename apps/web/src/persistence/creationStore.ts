import { isCreation } from "./creation";
import type { Creation } from "./creation";
import type { StorageLike } from "./storage";

/** All creations live under one versioned key, as a JSON array. */
export const STORAGE_KEY = "automata-playground:creations:v1";

/** Named creations saved in browser storage, keyed by name. */
export class CreationStore {
  constructor(private readonly storage: StorageLike) {}

  /** All saved creations, most recently updated first. */
  list(): Creation[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return []; // corrupt entry: treat as empty rather than crash the UI
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCreation).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(name: string): Creation | undefined {
    return this.list().find((c) => c.name === name);
  }

  /** Create or overwrite the creation called `name`. */
  save(name: string, source: string, now = Date.now()): Creation {
    const creation = { name, source, updatedAt: now };
    this.write([creation, ...this.list().filter((c) => c.name !== name)]);
    return creation;
  }

  /**
   * Save `source` without clobbering a different creation: reuses `name` when
   * it is free or already holds this exact source, else picks `name (2)`, ...
   */
  saveAsNew(name: string, source: string, now = Date.now()): Creation {
    const base = name.trim() || "untitled";
    let candidate = base;
    for (let n = 2; ; n++) {
      const existing = this.get(candidate);
      if (!existing || existing.source === source) break;
      candidate = `${base} (${n})`;
    }
    return this.save(candidate, source, now);
  }

  remove(name: string): void {
    this.write(this.list().filter((c) => c.name !== name));
  }

  private write(creations: Creation[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(creations));
  }
}
