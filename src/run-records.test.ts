import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorruptCaseFile } from "./errors.js";
import { attempt, closedAt, damageLog, FOOTER, FORM, ID, writeRecord } from "./report/report-fixtures.js";
import { runsRoot } from "./run-location.js";
import { readRunRecords } from "./run-records.js";
import { initTempRepo } from "./temp-repo.js";

describe("reading every run a repository holds", () => {
  it("finds none where nothing has ever run", async () => {
    const repo = initTempRepo("records-none-", { "README.md": "x\n" });

    expect(await readRunRecords(repo)).toEqual({ records: [], damaged: [] });
  });

  it("reads each run back, in run id order", async () => {
    const repo = initTempRepo("records-two-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.footer, task: FOOTER });
    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

    const { records, damaged } = await readRunRecords(repo);

    expect(records.map((record) => [record.runId, record.caseFile.outcome?.kind])).toEqual([
      [ID.form, "closed"],
      [ID.footer, undefined],
    ]);
    expect(damaged).toEqual([]);
  });

  it("sets a run whose log is damaged aside, naming the log and the task it was for, and still reads the others", async () => {
    const repo = initTempRepo("records-log-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER, history: attempt(1, "done") });
    await damageLog(dir);

    const { records, damaged } = await readRunRecords(repo);

    expect(records.map((record) => record.runId)).toEqual([ID.form]);
    expect(damaged.map(({ runId, dir: where, file, taskDef }) => ({ runId, where, file, taskDef }))).toEqual([
      { runId: ID.footer, where: dir, file: "log.jsonl", taskDef: { intent: FOOTER } },
    ]);
    expect(damaged[0]?.error).toBeInstanceOf(CorruptCaseFile);
  });

  it("names the case file, and no task, when the case file itself is damaged", async () => {
    const repo = initTempRepo("records-case-", { "README.md": "x\n" });
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER });
    await writeFile(join(dir, "case.json"), "{ truncated");

    const { damaged } = await readRunRecords(repo);

    expect(damaged.map(({ runId, file, taskDef }) => ({ runId, file, taskDef }))).toEqual([{ runId: ID.footer, file: "case.json", taskDef: undefined }]);
  });

  it("passes over a folder with no record in it: it was never a run", async () => {
    const repo = initTempRepo("records-empty-dir-", { "README.md": "x\n" });
    await mkdir(join(runsRoot(repo), "never-a-run-20261001T020000Z"), { recursive: true });

    expect(await readRunRecords(repo)).toEqual({ records: [], damaged: [] });
  });
});
