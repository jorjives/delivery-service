import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setOutcome } from "../case-file.js";
import { CorruptCaseFile } from "../errors.js";
import type { GateRef } from "../schema.js";
import { runsRoot } from "./run-location.js";
import { describeRun, readRun, startedAt, unfinishedRuns } from "./runs.js";

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** A run's record on disk, as `delivery run` leaves it: unfinished unless it is given an outcome. */
async function writeRun(repoPath: string, runId: string, intent: string, finished = false): Promise<string> {
  const dir = join(runsRoot(repoPath), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef: { intent }, gateRef: GATE, closerRef: { type: "commit-to-branch" } }, DEFAULT_BUDGETS);
  if (finished) {
    await setOutcome(dir, { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-15T21:00:00.000Z" });
  }
  return dir;
}

async function scratchRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "runs-"));
}

describe("the runs a repository is holding", () => {
  it("finds none in a repository that has never run anything", async () => {
    expect(await unfinishedRuns(await scratchRepo())).toEqual([]);
  });

  it("leaves out the runs that already finished", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");

    expect((await unfinishedRuns(repo)).map((record) => record.runId)).toEqual(["add-a-greeting-20260915T211500Z"]);
  });

  it("puts the most recently touched run first, whatever order they were started in", async () => {
    const repo = await scratchRepo();
    const older = await writeRun(repo, "reverse-a-word-20260915T213000Z", "reverse a word");
    const newer = await writeRun(repo, "add-a-greeting-20260915T210000Z", "add a greeting");
    await utimes(join(older, "case.json"), new Date("2026-09-15T21:30:00Z"), new Date("2026-09-15T21:30:00Z"));
    await utimes(join(newer, "case.json"), new Date("2026-09-15T22:00:00Z"), new Date("2026-09-15T22:00:00Z"));

    expect((await unfinishedRuns(repo)).map((record) => record.runId)).toEqual([
      "add-a-greeting-20260915T210000Z",
      "reverse-a-word-20260915T213000Z",
    ]);
  });

  it("ignores a folder that holds no record: nothing was ever written there", async () => {
    const repo = await scratchRepo();
    await mkdir(join(runsRoot(repo), "half-made-20260915T210000Z"), { recursive: true });

    expect(await unfinishedRuns(repo)).toEqual([]);
  });

  it("stops on a record that cannot be read back, rather than quietly skipping the user's run", async () => {
    const repo = await scratchRepo();
    const dir = await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeFile(join(dir, "case.json"), "{ this is not json");

    await expect(unfinishedRuns(repo)).rejects.toBeInstanceOf(CorruptCaseFile);
  });

  it("reads one run by its id, finished or not", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);

    const record = await readRun(repo, "reverse-a-word-20260915T210000Z");
    expect(record.caseFile.outcome?.kind).toBe("closed");
    expect(record.repoPath).toBe(repo);
  });
});

describe("how a run is described to a person", () => {
  it("reads the start time out of the run's id, which is where it already lives", () => {
    expect(startedAt("reverse-a-word-20260915T213012Z")).toBe("2026-09-15 21:30 UTC");
  });

  it("says so plainly when an id carries no time", () => {
    expect(startedAt("hand-made")).toBe("an unknown time");
  });

  it("names the run, when it started and what it was asked to do", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T213012Z", "add a function that reverses a word, with a test");

    const [record] = await unfinishedRuns(repo);
    expect(record && describeRun(record)).toBe(
      "reverse-a-word-20260915T213012Z, started 2026-09-15 21:30 UTC: add a function that reverses a word, with a test",
    );
  });
});
