/** DSL source as it travels through a plain-text file. */
export interface FileContents {
  /** Creation name implied by the file name. */
  name: string;
  source: string;
}

/** Import/export of creations as plain UTF-8 `.txt` files. */
export class CreationFile {
  static readonly EXTENSION = ".txt";
  /** Value for a file input's `accept` attribute. */
  static readonly ACCEPT = `${CreationFile.EXTENSION},text/plain`;

  /** A filesystem-safe file name for a creation name. */
  static toFileName(name: string): string {
    const base = name.trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
    return `${base || "untitled"}${CreationFile.EXTENSION}`;
  }

  /** The creation name implied by a file name (extension stripped). */
  static fromFileName(fileName: string): string {
    return fileName.replace(/\.txt$/i, "");
  }

  /** Read a user-picked file. */
  static async read(file: File): Promise<FileContents> {
    return { name: CreationFile.fromFileName(file.name), source: await file.text() };
  }

  /** Trigger a browser download of `source`. */
  static download(name: string, source: string): void {
    const url = URL.createObjectURL(new Blob([source], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = CreationFile.toFileName(name);
    a.click();
    URL.revokeObjectURL(url);
  }
}
