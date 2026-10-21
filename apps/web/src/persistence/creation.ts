/** A named piece of DSL source the user has saved. */
export interface Creation {
  name: string;
  source: string;
  /** Epoch milliseconds of the last save. */
  updatedAt: number;
}

/** Runtime check for values read back from storage, which may be stale or corrupt. */
export function isCreation(value: unknown): value is Creation {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.name === "string" &&
    typeof c.source === "string" &&
    typeof c.updatedAt === "number"
  );
}
