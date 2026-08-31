// Shared diagnostic types + a small collector used by validation.

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  message: string;
  line: number;
  col: number;
}

/** Anything carrying a source position (all AST nodes do). */
export interface HasPos {
  pos: { line: number; col: number };
}

/** Accumulates errors and warnings during a validation pass. */
export class Diagnostics {
  readonly items: Diagnostic[] = [];

  error(message: string, at: HasPos): void {
    this.items.push({
      severity: "error",
      message,
      line: at.pos.line,
      col: at.pos.col,
    });
  }

  warning(message: string, at: HasPos): void {
    this.items.push({
      severity: "warning",
      message,
      line: at.pos.line,
      col: at.pos.col,
    });
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === "error");
  }

  get warnings(): Diagnostic[] {
    return this.items.filter((d) => d.severity === "warning");
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }
}

/** Render a diagnostic as `line:col: message` for the string-array public API. */
export function formatDiagnostic(d: {
  message: string;
  line: number;
  col: number;
}): string {
  return `${d.line}:${d.col + 1}: ${d.message}`;
}
