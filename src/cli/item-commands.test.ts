import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { ledgerPath, readItemLedger } from "../item-ledger.js";
import { appendLine } from "../journal.js";
import { delivery, PACKAGE } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { answered, notParked, notWaitingForAnswer, unparked } from "./item-commands.js";

const at = "2026-10-16T09:00:00.000Z";
const KEY = "backlog:20261016T090000Z-greet.md";

async function withLedger(entries: object[]) {
  const repo = initTempRepo("item-commands-", { "package.json": PACKAGE });
  const state = mkdtempSync(join(tmpdir(), "item-state-"));
  const path = ledgerPath(repo, { XDG_STATE_HOME: state });
  await mkdir(dirname(path), { recursive: true });
  for (const entry of entries) await appendLine(path, entry);
  return { repo, env: { XDG_STATE_HOME: state }, path };
}

const decided = [
  { t: "dispatched", key: KEY, runId: "r1", intent: "Greet people.", at },
  { t: "ended", key: KEY, runId: "r1", class: "decision", question: "Formal?", at },
  { t: "parked", key: KEY, reason: "decision", at },
];

describe("delivery answer", () => {
  it("records the answer and unparks the item, by key or by id", async () => {
    const { repo, env, path } = await withLedger(decided);
    const { exitCode, stdout } = await delivery(["answer", "20261016T090000Z-greet.md", "Formal, please."], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(answered(KEY));
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, answer: "Formal, please." });
  });

  it("refuses an item that is not waiting on an answer", async () => {
    const { repo, env } = await withLedger([{ t: "parked", key: KEY, reason: "attempts", at }]);
    const { exitCode, stderr } = await delivery(["answer", KEY, "yes"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(notWaitingForAnswer(KEY));
  });

  it("refuses an item it does not know, naming what is parked", async () => {
    const { repo, env } = await withLedger(decided);
    expect((await delivery(["answer", "nope", "yes"], { cwd: repo, env })).stderr).toContain(notParked("nope", [KEY]));
  });
});

describe("delivery unpark", () => {
  it("puts a parked item back in the queue, to start afresh", async () => {
    const { repo, env, path } = await withLedger([{ t: "parked", key: KEY, reason: "escalated", at }]);
    const { exitCode, stdout } = await delivery(["unpark", KEY], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(unparked(KEY));
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, lastClass: null, attempts: 0 });
  });
});
