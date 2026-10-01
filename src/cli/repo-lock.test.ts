import { describe, expect, it } from "vitest";
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../tests/helpers.js";
import { initTempRepo } from "../temp-repo.js";
import { repoLocked, takeRepoLock } from "./repo-lock.js";
import { supervisorLockPath } from "../run-location.js";

const repo = (prefix: string) => initTempRepo(prefix, { "package.json": "{}" });

describe("the lock a run of several tasks at once holds on its repository", () => {
  it("is free in a repository nothing has run in", async () => {
    expect(await repoLocked(repo("repo-lock-free-"))).toBe(false);
  });

  it("is held from when it is taken until it is let go, and cannot be taken twice meanwhile", async () => {
    const path = repo("repo-lock-held-");
    const release = await takeRepoLock(path);
    expect(release).toBeTypeOf("function");
    expect(await repoLocked(path)).toBe(true);
    expect(await takeRepoLock(path)).toBeUndefined();

    await release?.();
    expect(await repoLocked(path)).toBe(false);
    const again = await takeRepoLock(path);
    expect(again).toBeTypeOf("function");
    await again?.();
  });

  it("is taken over when the run that held it was killed and stopped keeping it fresh", async () => {
    const path = repo("repo-lock-stale-");
    // What a run killed outright leaves behind: the lock, no longer touched by anyone.
    mkdirSync(join(path, ".delivery"), { recursive: true });
    mkdirSync(supervisorLockPath(path));
    const aMinuteAgo = new Date(Date.now() - 60_000);
    utimesSync(supervisorLockPath(path), aMinuteAgo, aMinuteAgo);

    expect(await repoLocked(path)).toBe(false);
    const release = await takeRepoLock(path);
    expect(release).toBeTypeOf("function");
    await release?.();
  });

  it("leaves `git status` as it was while held", async () => {
    const path = repo("repo-lock-status-");
    const release = await takeRepoLock(path);
    expect(git(path, ["status", "--porcelain"])).toBe("");
    await release?.();
  });
});
