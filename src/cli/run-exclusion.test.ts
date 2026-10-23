import { describe, expect, it, vi } from "vitest";
import { mkdirSync, utimesSync } from "node:fs";
import { Readable } from "node:stream";
import { holdingRepo, liveRunFound, SKIPPED_IDLE } from "./run-exclusion.js";
import { repoLocked, takeRepoLock } from "../repo-lock.js";
import { supervisorLockPath } from "../run-location.js";
import { initTempRepo } from "../temp-repo.js";
import { EXIT, Refusal } from "./failures.js";
import { writeSupervisedRun } from "./command-fixtures.js";
import { plainReporter } from "./report.js";
import type { CommandContext } from "./context.js";

describe("why a second run cannot start on top of a live one", () => {
  it("names the live run, when it started and its shape, and how to look at it", () => {
    expect(liveRunFound({ runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } })).toBe(
      "Another run is already going here (started `2026-09-30 09:00 UTC`, 4 tasks, up to 2 at once: `run-20260930T090000Z`). " +
        "Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });

  it("still says a run is going when its record cannot be found", () => {
    expect(liveRunFound(undefined)).toBe(
      "Another run is already going here. Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });
});

/** A command context whose lines go into `lines`, run in process. */
const contextIn = (cwd: string, lines: string[]): CommandContext => ({
  cwd,
  env: process.env,
  colour: false,
  json: false,
  stdin: Readable.from([]),
  writeLine: (line) => lines.push(line),
  report: plainReporter((line) => lines.push(line), false),
});

const HEADER = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } };

describe("holding the repository for a command", () => {
  it("runs the command holding the lock, returns its exit code, and lets the lock go", async () => {
    const repo = initTempRepo("hold-free-", { "README.md": "hi\n" });
    const code = await holdingRepo(repo, {}, contextIn(repo, []), async () => {
      expect(await repoLocked(repo)).toBe(true);
      return EXIT.escalated;
    });
    expect(code).toBe(EXIT.escalated);
    expect(await repoLocked(repo)).toBe(false);
  });

  it("refuses, naming the run going, and never starts the command", async () => {
    const repo = initTempRepo("hold-refused-", { "README.md": "hi\n" });
    await writeSupervisedRun(repo, { ...HEADER, repoPath: repo });
    const release = await takeRepoLock(repo);
    const lines: string[] = [];
    const body = vi.fn(async () => EXIT.ok);
    try {
      await expect(holdingRepo(repo, {}, contextIn(repo, lines), body)).rejects.toEqual(new Refusal(liveRunFound({ ...HEADER, repoPath: repo }), EXIT.configuration));
      expect(body).not.toHaveBeenCalled();
      expect(lines).toEqual([]);
    } finally {
      await release?.();
    }
  });

  it("with ifIdle, says it skipped in one line and succeeds, never starting the command", async () => {
    const repo = initTempRepo("hold-idle-", { "README.md": "hi\n" });
    const release = await takeRepoLock(repo);
    const lines: string[] = [];
    const body = vi.fn(async () => EXIT.ok);
    try {
      expect(await holdingRepo(repo, { ifIdle: true }, contextIn(repo, lines), body)).toBe(EXIT.ok);
      expect(lines).toEqual([SKIPPED_IDLE]);
      expect(body).not.toHaveBeenCalled();
    } finally {
      await release?.();
    }
    expect(SKIPPED_IDLE).toBe("Skipped: another run is going here");
  });

  it("with ifIdle and no run going, behaves exactly as without it", async () => {
    const repo = initTempRepo("hold-idle-free-", { "README.md": "hi\n" });
    const lines: string[] = [];
    const body = vi.fn(async () => EXIT.escalated);
    expect(await holdingRepo(repo, { ifIdle: true }, contextIn(repo, lines), body)).toBe(EXIT.escalated);
    expect(body).toHaveBeenCalledOnce();
    expect(lines).toEqual([]);
  });

  it("lets the lock go when the command throws", async () => {
    const repo = initTempRepo("hold-throws-", { "README.md": "hi\n" });
    await expect(holdingRepo(repo, {}, contextIn(repo, []), async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await repoLocked(repo)).toBe(false);
  });

  it("is never blocked by a run on another repository", async () => {
    const repoA = initTempRepo("hold-other-a-", { "README.md": "hi\n" });
    const repoB = initTempRepo("hold-other-b-", { "README.md": "hi\n" });
    const release = await takeRepoLock(repoA);
    try {
      expect(await holdingRepo(repoB, {}, contextIn(repoB, []), async () => EXIT.ok)).toBe(EXIT.ok);
    } finally {
      await release?.();
    }
  });

  it("takes over a lock a killed run left behind once it has gone stale", async () => {
    const repo = initTempRepo("hold-stale-", { "README.md": "hi\n" });
    // What a run killed outright leaves behind: the lock, no longer touched by anyone.
    mkdirSync(supervisorLockPath(repo), { recursive: true });
    const aMinuteAgo = new Date(Date.now() - 60_000);
    utimesSync(supervisorLockPath(repo), aMinuteAgo, aMinuteAgo);
    const body = vi.fn(async () => EXIT.ok);
    expect(await holdingRepo(repo, {}, contextIn(repo, []), body)).toBe(EXIT.ok);
    expect(body).toHaveBeenCalledOnce();
  });
});
