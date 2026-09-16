import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setOutcome } from "../case-file.js";
import { CorruptCaseFile } from "../errors.js";
import type { GateRef } from "../schema.js";
import { runsRoot } from "./run-location.js";
import { allRuns, chooseRun, describeRun, NOTHING_CHOSEN, NOTHING_HERE, NOTHING_TO_RESUME, readRun, readableUtc, startedAt, unfinishedRuns } from "./runs.js";
import { Refusal } from "./failures.js";

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

/** A command context reading the answers a person would type, with `isTTY` saying whether anyone is there to type them. */
function answering(answers: string[], { interactive }: { interactive: boolean }) {
  const lines: string[] = [];
  const stdin = Object.assign(Readable.from(answers.map((answer) => `${answer}\n`)), { isTTY: interactive || undefined });
  return { ctx: { cwd: "/", env: {}, colour: false, stdin, writeLine: (line: string) => lines.push(line) }, lines };
}

describe("choosing which run to pick up", () => {
  it("takes the only unfinished run without asking", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    const { ctx, lines } = answering([], { interactive: true });

    expect((await chooseRun(await unfinishedRuns(repo), ctx)).runId).toBe("reverse-a-word-20260915T210000Z");
    expect(lines).toEqual([]);
  });

  it("lists them and asks when there is more than one", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");
    const records = await unfinishedRuns(repo);
    const { ctx, lines } = answering(["2"], { interactive: true });

    expect((await chooseRun(records, ctx)).runId).toBe(records[1]?.runId);
    expect(lines.join("\n")).toContain("  1. add-a-greeting-20260915T211500Z, started 2026-09-15 21:15 UTC: add a greeting");
    expect(lines.join("\n")).toContain("  2. reverse-a-word-20260915T210000Z, started 2026-09-15 21:00 UTC: reverse a word");
  });

  it("leaves every run alone when the answer names none of them", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");
    const { ctx } = answering([""], { interactive: true });

    await expect(chooseRun(await unfinishedRuns(repo), ctx)).rejects.toThrow(NOTHING_CHOSEN);
  });

  it("prints the list and stops when nobody is there to answer", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word");
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");
    const { ctx } = answering([], { interactive: false });

    const refusal = await chooseRun(await unfinishedRuns(repo), ctx).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(Refusal);
    expect((refusal as Refusal).message).toContain("reverse-a-word-20260915T210000Z");
    expect((refusal as Refusal).message).toContain("delivery resume --last");
    expect((refusal as Refusal).exitCode).toBe(2);
  });

  it("says plainly when there is nothing to pick up", async () => {
    const { ctx } = answering([], { interactive: true });
    await expect(chooseRun([], ctx)).rejects.toThrow(NOTHING_TO_RESUME);
  });
});

describe("every run a repository holds", () => {
  it("finds none in a repository that has never run anything", async () => {
    expect(await allRuns(await scratchRepo())).toEqual([]);
  });

  it("includes the runs that finished as well as the ones that did not", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");

    expect((await allRuns(repo)).map((record) => record.runId).sort()).toEqual([
      "add-a-greeting-20260915T211500Z",
      "reverse-a-word-20260915T210000Z",
    ]);
  });

  it("puts the most recently touched run first, so `--last` needs no other bookkeeping", async () => {
    const repo = await scratchRepo();
    const older = await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);
    const newer = await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting", true);
    const longAgo = new Date("2026-09-15T21:00:00.000Z");
    await utimes(join(older, "case.json"), longAgo, longAgo);
    await utimes(join(older, "log.jsonl"), longAgo, longAgo);

    const [first] = await allRuns(repo);
    expect(first?.dir).toBe(newer);
  });

  it("passes over a folder that never became a run, and still reports one that cannot be read back", async () => {
    const repo = await scratchRepo();
    await mkdir(join(runsRoot(repo), "never-started-20260915T210000Z"), { recursive: true });
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting", true);
    expect((await allRuns(repo)).map((record) => record.runId)).toEqual(["add-a-greeting-20260915T211500Z"]);

    await writeFile(join(runsRoot(repo), "add-a-greeting-20260915T211500Z", "case.json"), "{ not json");
    await expect(allRuns(repo)).rejects.toThrow(CorruptCaseFile);
  });
});

describe("a time a person can read", () => {
  it("reads an ISO timestamp back as a date, a time and the zone it is in", () => {
    expect(readableUtc("2026-09-14T21:05:09.123Z")).toBe("2026-09-14 21:05 UTC");
  });

  it("says when there is nothing in this repository to report on, and how to start something", () => {
    expect(NOTHING_HERE).toContain("delivery run --task");
  });
});
