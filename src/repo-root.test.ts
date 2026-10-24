import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootOf } from "./repo-root.js";

describe("repoRootOf", () => {
  it("finds the repository a folder is in from its .git entry, a folder or a file", () => {
    const repo = mkdtempSync(join(tmpdir(), "root-"));
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "a", "b"), { recursive: true });
    expect(repoRootOf(join(repo, "a", "b"))).toBe(repo);
    const linked = mkdtempSync(join(tmpdir(), "linked-"));
    writeFileSync(join(linked, ".git"), "gitdir: elsewhere\n");
    expect(repoRootOf(linked)).toBe(linked);
  });

  it("is undefined outside any repository", () => {
    expect(repoRootOf(mkdtempSync(join(tmpdir(), "none-")))).toBeUndefined();
  });
});
