import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { diffPackFiles, hunkLines } from "./file-diff.js";

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "file-diff-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

describe("hunkLines", () => {
  it("reads removed, added and unchanged lines, and a gap between hunks", () => {
    const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -9 +9 @@\n-y\n+z\n";
    expect(hunkLines(patch)).toEqual([
      { kind: "context", text: "a" }, { kind: "removed", text: "b" }, { kind: "added", text: "c" },
      { kind: "gap" }, { kind: "removed", text: "y" }, { kind: "added", text: "z" },
    ]);
  });
  it("marks a line with no line break after it", () => {
    expect(hunkLines("@@ -1 +1 @@\n-a\n+a\n\\ No newline at end of file\n").at(-1)).toEqual({ kind: "no-line-break" });
  });
  it("keeps a removed line that itself starts with dashes as text", () => {
    expect(hunkLines("@@ -1 +0,0 @@\n--- x\n")).toEqual([{ kind: "removed", text: "-- x" }]);
  });
});

describe("diffPackFiles", () => {
  let before: string;
  let after: string;
  beforeAll(() => {
    before = folder({ "a.md": "one\ntwo\n", "b.md": "same\n", "c.md": "gone\n" });
    after = folder({ "a.md": "one\nthree\n", "b.md": "same\n", "d.md": "new\nlines\n" });
  });

  it("lists changed, added, removed and unchanged files in path order with counts", async () => {
    expect((await diffPackFiles(before, ["a.md", "b.md", "c.md"], after, ["a.md", "b.md", "d.md"])).map(({ path, status, added, removed }) => ({ path, status, added, removed }))).toEqual([
      { path: "a.md", status: "changed", added: 1, removed: 1 },
      { path: "b.md", status: "unchanged", added: 0, removed: 0 },
      { path: "c.md", status: "removed", added: 0, removed: 1 },
      { path: "d.md", status: "added", added: 2, removed: 0 },
    ]);
  });
  it("keeps a right-to-left override in a changed line as the character itself", async () => {
    const left = folder({ "r.md": "x\n" });
    const right = folder({ "r.md": "a‮b\n" });
    const [file] = await diffPackFiles(left, ["r.md"], right, ["r.md"]);
    expect(file?.lines).toContainEqual({ kind: "added", text: "a‮b" });
  });
});
