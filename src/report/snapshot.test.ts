import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileNotFound, RunFileNotFound } from "../errors.js";
import { appendRunEntry, createRunFile } from "../run-file.js";
import { prepareRunDir, supervisedPlace } from "../run-location.js";
import type { HistoryEntry, RunEntry } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { writeSupervisedRun } from "../cli/command-fixtures.js";
import { attempt, closedAt, damageLog, failedCheck, fill, FOOTER, FORM, ID, PACKET, stoppedAt, writeRecord } from "./report-fixtures.js";
import { loadSnapshot } from "./snapshot.js";

const LIST = [{ intent: FORM }, { intent: FOOTER }];

async function writeRun(repo: string): Promise<string> {
  const dir = supervisedPlace(repo, ID.run);
  await prepareRunDir(repo, dir);
  await createRunFile(dir, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } });
  await appendRunEntry(dir, fill(1, ID.form, FORM));
  return dir;
}

describe("a record written for a test", () => {
  it("is read back exactly as it was given: a step keeps the time it names, and a step given none has none", async () => {
    const repo = initTempRepo("snapshot-exact-", { "README.md": "x\n" });
    const [setToWork, answered] = attempt(1, "done");
    const history = [{ ...setToWork, at: "2026-10-01T02:20:00.000Z" }, answered] as HistoryEntry[];
    await writeRecord(repo, { runId: ID.form, task: FORM, history });
    const fills: RunEntry[] = [{ ...fill(1, ID.form, FORM), at: "2026-10-01T02:00:00.000Z" }, fill(2, ID.footer, FOOTER)];
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } }, fills);

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST });

    expect(snapshot.records[0]?.caseFile.history).toEqual(history);
    expect(snapshot.runs[0]?.history).toEqual(fills);
  });
});

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
      refs: {},
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

  it("reads back what each triage round wrote beside its log entry, by run and by ref", async () => {
    const repo = initTempRepo("snapshot-refs-", { "README.md": "x\n" });
    const round = { trigger: "gate_fail", rationale: "gate_fail: reroute (correction 0/3)" };
    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") });
    await writeRecord(repo, { runId: ID.footer, task: FOOTER, history: [...attempt(1, "first go"), ...failedCheck(1, "reroute")], refs: { "triage-0": round } });

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST });

    expect(snapshot.refs).toEqual({ [ID.footer]: { "triage-0": round } });
  });

  it("reads back the packet a stopped task left for a person, by the ref its outcome names", async () => {
    const repo = initTempRepo("snapshot-packet-", { "README.md": "x\n" });
    await writeRecord(repo, {
      runId: ID.footer,
      task: FOOTER,
      history: attempt(1, "I need the owner to confirm.", "authority"),
      refs: { escalation: PACKET },
      outcome: { ...stoppedAt("2026-10-01T02:58:00.000Z", { kind: "authority", role: "worker" }), packetRef: "escalation" },
    });

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: false, list: LIST });

    expect(snapshot.refs).toEqual({ [ID.footer]: { escalation: PACKET } });
  });

  it("leaves out a round's ref that is missing or cannot be read, and still reads the record", async () => {
    const repo = initTempRepo("snapshot-refs-missing-", { "README.md": "x\n" });
    const history = [...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go"), ...failedCheck(2, "escalate")];
    const dir = await writeRecord(repo, { runId: ID.footer, task: FOOTER, history });
    await mkdir(join(dir, "refs"), { recursive: true });
    await writeFile(join(dir, "refs", "triage-1.json"), "{ truncated");

    const snapshot = await loadSnapshot(repo, { kind: "task", runId: ID.footer }, { live: false, list: LIST });

    expect(snapshot.refs).toEqual({});
    expect(snapshot.records.map((record) => record.runId)).toEqual([ID.footer]);
    expect(snapshot.damaged).toEqual([]);
  });

  it("reads only the rounds of the task a report on one task is about", async () => {
    const repo = initTempRepo("snapshot-refs-one-task-", { "README.md": "x\n" });
    const round = { trigger: "gate_fail", rationale: "gate_fail: reroute (correction 0/3)" };
    const history = [...attempt(1, "first go"), ...failedCheck(1, "reroute")];
    await writeRecord(repo, { runId: ID.form, task: FORM, history, refs: { "triage-0": round } });
    await writeRecord(repo, { runId: ID.footer, task: FOOTER, history, refs: { "triage-0": round } });

    const snapshot = await loadSnapshot(repo, { kind: "task", runId: ID.footer }, { live: false, list: LIST });

    expect(snapshot.refs).toEqual({ [ID.footer]: { "triage-0": round } });
    expect(snapshot.records.map((record) => record.runId).sort()).toEqual([ID.form, ID.footer].sort());
  });

  it("fails to answer for a named run nothing on disk answers for", async () => {
    const repo = initTempRepo("snapshot-unknown-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM });

    await expect(loadSnapshot(repo, { kind: "task", runId: "no-such-run" }, { live: false, list: LIST })).rejects.toBeInstanceOf(FileNotFound);
    await expect(loadSnapshot(repo, { kind: "run", runId: "no-such-run" }, { live: false, list: LIST })).rejects.toBeInstanceOf(RunFileNotFound);
  });
});
