import { describe, expect, it } from "vitest";
import { CreationFile } from "./creationFile";

describe("CreationFile", () => {
  it("sanitizes creation names into file names", () => {
    expect(CreationFile.toFileName("Upper Triangle")).toBe("Upper_Triangle.txt");
    expect(CreationFile.toFileName("a/b\\c")).toBe("a_b_c.txt");
    expect(CreationFile.toFileName("  ")).toBe("untitled.txt");
  });

  it("strips the extension on import", () => {
    expect(CreationFile.fromFileName("UpperTriangle.txt")).toBe("UpperTriangle");
    expect(CreationFile.fromFileName("x.TXT")).toBe("x");
    expect(CreationFile.fromFileName("notes.md")).toBe("notes.md");
  });

  it("reads a file's name and source", async () => {
    const file = new File(["graph G:\n"], "My Loop.txt");
    expect(await CreationFile.read(file)).toEqual({ name: "My Loop", source: "graph G:\n" });
  });
});
