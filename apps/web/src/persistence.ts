// Client-only persistence for DSL source: no backend involved.
//
// - Named creations live in localStorage under a single versioned key.
// - `.nfa` files are plain UTF-8 DSL text, imported via a file picker and
//   exported as a download.
// - Share links carry the source in the URL hash, deflate-compressed and
//   base64url-encoded, so a link works without any server round-trip.

const STORAGE_KEY = "automata-playground:creations:v1";
const HASH_PREFIX = "#nfa=";
export const FILE_EXTENSION = ".nfa";

export interface Creation {
  name: string;
  source: string;
  /** Epoch milliseconds of the last save. */
  updatedAt: number;
}

/** The subset of the Web Storage API we rely on (injectable for tests). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * `localStorage`, or an in-memory stand-in when the browser blocks it (e.g.
 * disabled site data), so the app still works and saves last for the session.
 */
export function browserStorage(): StorageLike {
  try {
    const storage = window.localStorage;
    storage.getItem(STORAGE_KEY); // some browsers only throw on first access
    return storage;
  } catch {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }
}

function isCreation(value: unknown): value is Creation {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.name === "string" &&
    typeof c.source === "string" &&
    typeof c.updatedAt === "number"
  );
}

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

  remove(name: string): void {
    this.write(this.list().filter((c) => c.name !== name));
  }

  private write(creations: Creation[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(creations));
  }
}

/** A filesystem-safe `.nfa` filename for a creation name. */
export function toFileName(name: string): string {
  const base = name.trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${base || "untitled"}${FILE_EXTENSION}`;
}

/** The creation name implied by an imported file's name. */
export function fromFileName(fileName: string): string {
  return fileName.replace(/\.nfa$/i, "");
}

/** Trigger a browser download of `source` as a `.nfa` file. */
export function downloadSource(name: string, source: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = toFileName(name);
  a.click();
  URL.revokeObjectURL(url);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Run `bytes` through a (de)compression stream. */
async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Encode DSL source as a URL hash fragment (`#nfa=...`). */
export async function encodeShareHash(source: string): Promise<string> {
  const compressed = await pipe(
    new TextEncoder().encode(source),
    new CompressionStream("deflate-raw"),
  );
  return HASH_PREFIX + toBase64Url(compressed);
}

/**
 * Decode DSL source from a URL hash fragment. Returns `null` when the hash is
 * not a share link or its payload is malformed.
 */
export async function decodeShareHash(hash: string): Promise<string | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  try {
    const bytes = await pipe(
      fromBase64Url(hash.slice(HASH_PREFIX.length)),
      new DecompressionStream("deflate-raw"),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
