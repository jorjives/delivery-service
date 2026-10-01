import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileNotFound, RunFileNotFound } from "../errors.js";
import { appendRunEntry, createRunFile } from "../run-file.js";
import { prepareRunDir, supervisedPlace } from "../run-location.js";
import { initTempRepo } from "../temp-repo.js";
import { attempt, closedAt, damageLog, fill, FOOTER, FORM, ID, writeRecord } from "./report-fixtures.js";
import { loadSnapshot } from "./snapshot.js";

const LIST = [{ intent: FORM }, { intent: FOOTER }];

async function writeRun(repo: string): Promise<string> {
  const dir = supervisedPlace(repo, ID.run);
  await prepareRunDir(repo, dir);
  await createRunFile(dir, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } });
  await appendRunEntry(dir, fill(1, ID.form, FORM));
  return dir;
}

describe("reading what a report is derived from", () => {
  it("is empty, not an error, where nothing has ever run", async () => {
    const repo = initTempRepo("snapshot-none-", { "README.md": "x\n" });

    expect(await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST })).toEqual({
      subject: { kind: "list" },
      live: false,
      list: LIST,
      records: [],
      runs: [],
      damaged: [],
    });
  });

  it("reads every task's record and every run of several at once", async () => {
    const repo = initTempRepo("snapshot-all-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });
    await writeRun(repo);

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: true, list: LIST });

    expect(snapshot.records.map((record) => record.runId)).toEqual([ID.form]);
    expect(snapshot.runs.map((run) => [run.header.runId, run.history.length])).toEqual([[ID.run, 1]]);
    expect(snapshot.live).toBe(true);
  });

  it("names a damaged task record by its file, relative to the repository", async () => {
    const repo = initTempRepo("snapshot-damaged-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER });
    await damageLog(dir);

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST });

    expect(snapshot.damaged).toEqual([{ runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } }]);
    expect(snapshot.records.map((record) => record.runId)).toEqual([ID.form]);
  });

  it("names a damaged run of several at once by its folder", async () => {
    const repo = initTempRepo("snapshot-damaged-run-", { "README.md": "x\n" });
    const dir = await writeRun(repo);
    await writeFile(join(dir, "run.json"), "{ truncated");

    const snapshot = await loadSnapshot(repo, { kind: "run", runId: ID.run }, { live: false, list: LIST });

    expect(snapshot.runs).toEqual([]);
    expect(snapshot.damaged).toEqual([{ runId: ID.run, file: `.delivery/supervised/${ID.run}` }]);
  });

  it("fails to answer for a named run nothing on disk answers for", async () => {
    const repo = initTempRepo("snapshot-unknown-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });

    await expect(loadSnapshot(repo, { kind: "task", runId: "no-such-run" }, { live: false, list: LIST })).rejects.toBeInstanceOf(FileNotFound);
    await expect(loadSnapshot(repo, { kind: "run", runId: "no-such-run" }, { live: false, list: LIST })).rejects.toBeInstanceOf(RunFileNotFound);
  });
});
