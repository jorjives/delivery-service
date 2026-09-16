import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { git as gitSync } from "../tests/helpers.js";
import { git, tryGit, ensureCommitted } from "./git-exec.js";
import { initTempRepo } from "./temp-repo.js";

describe("git", () => {
  let repo: string;

  beforeEach(() => {
    repo = initTempRepo("git-exec-repo-", { "seed.txt": "hello\n" });
  });

  it("returns trimmed stdout for a command that succeeds", async () => {
    expect(await git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
  });

  it("rejects for a command that fails", async () => {
    await expect(git(repo, ["rev-parse", "--verify", "refs/heads/nope"])).rejects.toThrow();
  });
});

describe("tryGit", () => {
  let repo: string;

  beforeEach(() => {
    repo = initTempRepo("git-exec-repo-", { "seed.txt": "hello\n" });
  });

  it("reports true when the command exits zero", async () => {
    expect(await tryGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/main"])).toBe(true);
  });

  it("reports false instead of throwing when the command fails", async () => {
    expect(await tryGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/nope"])).toBe(false);
  });
});

describe("ensureCommitted", () => {
  let repo: string;

  beforeEach(() => {
    repo = initTempRepo("git-exec-repo-", { "seed.txt": "hello\n" });
  });

  it("commits every uncommitted change, including new files", async () => {
    writeFileSync(join(repo, "worker.txt"), "work\n");

    await ensureCommitted(repo, "accepted work");

    expect(gitSync(repo, ["status", "--porcelain"])).toBe("");
    expect(gitSync(repo, ["log", "-1", "--pretty=%s"])).toBe("accepted work");
  });

  it("is a no-op on a clean tree, leaving the history untouched", async () => {
    const before = gitSync(repo, ["rev-parse", "HEAD"]);

    await ensureCommitted(repo, "accepted work");

    expect(gitSync(repo, ["rev-parse", "HEAD"])).toBe(before);
  });

  it("is safe to call twice: the second call adds no commit", async () => {
    writeFileSync(join(repo, "worker.txt"), "work\n");
    await ensureCommitted(repo, "accepted work");
    const after = gitSync(repo, ["rev-parse", "HEAD"]);

    await ensureCommitted(repo, "accepted work");

    expect(gitSync(repo, ["rev-parse", "HEAD"])).toBe(after);
  });
});
