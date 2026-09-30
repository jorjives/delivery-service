import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git as gitSync } from "../tests/helpers.js";
import { git, tryGit, ensureCommitted, takeTurn } from "./git-exec.js";
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

describe("git calls in one folder take turns", () => {
  /** Long enough for a git call that was not made to wait to have finished several times over. */
  const aWhile = () => new Promise((resolve) => setTimeout(resolve, 300));

  it("does not start a git call in a folder until the call before it there has finished", async () => {
    const repo = initTempRepo("git-exec-turns-", { "seed.txt": "hello\n" });
    const hold = Promise.withResolvers<undefined>();
    const holding = takeTurn(repo, () => hold.promise);
    let finished = false;
    const call = git(repo, ["status", "--porcelain"]).then(() => (finished = true));

    await aWhile();
    expect(finished).toBe(false);

    hold.resolve();
    await holding;
    await call;
    expect(finished).toBe(true);
  });

  it("treats two spellings of the same folder as one", async () => {
    const repo = initTempRepo("git-exec-turns-spelling-", { "seed.txt": "hello\n" });
    const hold = Promise.withResolvers<undefined>();
    const holding = takeTurn(`${repo}/.`, () => hold.promise);
    let finished = false;
    const call = git(repo, ["status", "--porcelain"]).then(() => (finished = true));

    await aWhile();
    expect(finished).toBe(false);
    hold.resolve();
    await Promise.all([holding, call]);
  });

  it("never makes a call in one folder wait on a call in another", async () => {
    const shared = initTempRepo("git-exec-turns-shared-", { "seed.txt": "hello\n" });
    const other = initTempRepo("git-exec-turns-other-", { "seed.txt": "hello\n" });
    const hold = Promise.withResolvers<undefined>();
    const holding = takeTurn(shared, () => hold.promise);

    expect(await git(other, ["symbolic-ref", "--short", "HEAD"])).toBe("main");

    hold.resolve();
    await holding;
  });

  it("keeps taking turns after a call fails", async () => {
    const repo = initTempRepo("git-exec-turns-failed-", { "seed.txt": "hello\n" });
    await expect(takeTurn(repo, () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect(await git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
  });

  it("runs work in the order it was queued", async () => {
    const folder = mkdtempSync(join(tmpdir(), "git-exec-order-"));
    const order: number[] = [];
    await Promise.all([3, 1, 2].map((n) => takeTurn(folder, async () => {
      await new Promise((resolve) => setTimeout(resolve, n * 20));
      order.push(n);
    })));
    expect(order).toEqual([3, 1, 2]);
  });
});
