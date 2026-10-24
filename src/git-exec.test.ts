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

  it("returns the patch when diff --no-index exits 1 and 1 is accepted", async () => {
    writeFileSync(join(repo, "a.txt"), "one\n");
    writeFileSync(join(repo, "b.txt"), "two\n");
    const out = await git(repo, ["diff", "--no-index", "--no-color", "a.txt", "b.txt"], { raw: true, okExitCodes: [1] });
    expect(out).toContain("-one\n+two\n");
  });

  it("adds the environment it is given on top of the cleaned one", async () => {
    const index = join(mkdtempSync(join(tmpdir(), "git-exec-index-")), "index");
    await git(repo, ["read-tree", "HEAD"], { env: { GIT_INDEX_FILE: index } });
    expect(await git(repo, ["ls-files"], { env: { GIT_INDEX_FILE: index } })).toBe("seed.txt");
    // The repository's own index was not the one written.
    expect(gitSync(repo, ["status", "--porcelain"])).toBe("");
  });

  it("writes the input it is given to the call's standard input", async () => {
    const file = join(repo, "x.txt");
    writeFileSync(file, "x\n");
    expect(await git(repo, ["hash-object", "--stdin"], { input: "x\n" })).toBe(await git(repo, ["hash-object", file]));
  });

  it("rejects with git's output limit exceeded when told how much output to accept", async () => {
    await expect(git(repo, ["log", "-p"], { maxBuffer: 10 })).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
  });

  it("gives up on a call that runs past the time it is given", async () => {
    const started = Date.now();
    await expect(git(repo, ["-c", "alias.wait=!sleep 5", "wait"], { timeout: 200 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4_000);
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
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- resolve() takes no argument
    const hold = Promise.withResolvers<void>();
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
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- resolve() takes no argument
    const hold = Promise.withResolvers<void>();
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
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- resolve() takes no argument
    const hold = Promise.withResolvers<void>();
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
