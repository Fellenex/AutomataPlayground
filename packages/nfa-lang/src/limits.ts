// Hard ceilings that keep expansion bounded, so a pathological program (e.g.
// `UpperTriangle(1000000)`) fails fast with a clear error instead of hanging or
// exhausting memory. Enforced identically on client and server because both go
// through the shared `validateProgram` / `expand` entry points.

export interface Limits {
  /** Max characters of DSL source accepted (checked before lexing). */
  maxSourceChars: number;
  /** Max absolute value of an instantiation argument (e.g. `G(1000000)`). */
  maxArg: number;
  /** Max distinct nodes accumulated across every instantiation. */
  maxNodes: number;
  /** Max distinct edges accumulated across every instantiation. */
  maxEdges: number;
}

/** The default ceilings; `expand` accepts overrides, chiefly for tests. */
export const LIMITS: Limits = {
  maxSourceChars: 20_000,
  maxArg: 100_000,
  maxNodes: 5_000,
  maxEdges: 50_000,
};
