import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DamagedReview } from "../errors.js";
import type { GateRef } from "../schema.js";
import { withoutAt } from "../without-at.js";
import { appendLedger, authorisations, readLedger } from "./ledger.js";
import { guardListsFor } from "./guards.js";

const dir = () => mkdtempSync(join(tmpdir(), "ledger-"));
const NPM_TEST: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const OTHER: GateRef = { type: "command", command: "make check", parseMode: "exitcode" };
const ID = "0123456789ab";

describe("a review's record of what was decided", () => {
  it("is empty before anything is decided", async () => {
    expect(await readLedger(dir())).toEqual([]);
  });

  it("reads back every entry in the order it was written, each with when it was written", async () => {
    const d = dir();
    await appendLedger(d, { t: "decision", ids: [ID], choice: "approve" });
    await appendLedger(d, { t: "authorise", ids: [ID], verify: NPM_TEST });
    await appendLedger(d, { t: "fix_observed", id: ID, outcome: "already_resolved", commit: "a".repeat(40) });
    const entries = await readLedger(d);
    expect(withoutAt(entries)).toEqual([
      { t: "decision", ids: [ID], choice: "approve" },
      { t: "authorise", ids: [ID], verify: NPM_TEST },
      { t: "fix_observed", id: ID, outcome: "already_resolved", commit: "a".repeat(40) },
    ]);
    for (const entry of entries) expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  it("drops a last line cut short by a crash", async () => {
    const d = dir();
    await appendLedger(d, { t: "decision", ids: [ID], choice: "skip" });
    appendFileSync(join(d, "log.jsonl"), '{"t":"deci');
    expect(await readLedger(d)).toHaveLength(1);
  });

  it.each([
    ["a line that is not JSON", "nonsense"],
    ["a line naming something that is not a problem's identity", JSON.stringify({ t: "decision", at: "2026-10-05T10:00:00.000Z", ids: ["../x"], choice: "approve" })],
  ])("names the file as damaged for %s before the last", async (_, bad) => {
    const d = dir();
    writeFileSync(join(d, "log.jsonl"), `${bad}\n${JSON.stringify({ t: "decision", at: "2026-10-05T10:00:00.000Z", ids: [ID], choice: "skip" })}\n`);
    await expect(readLedger(d)).rejects.toBeInstanceOf(DamagedReview);
  });

  it("knows which problems were authorised for fixing, each against the check it was first authorised with", async () => {
    const d = dir();
    await appendLedger(d, { t: "authorise", ids: [ID], verify: NPM_TEST });
    await appendLedger(d, { t: "authorise", ids: [ID, "111111111111"], verify: OTHER });
    expect(authorisations(await readLedger(d))).toEqual(new Map([[ID, { verify: NPM_TEST }], ["111111111111", { verify: OTHER }]]));
  });

  it("pins what a fix may not touch with its authorisation, and reads back an authorisation from before it did", async () => {
    const d = dir();
    const guards = guardListsFor(undefined);
    await appendLedger(d, { t: "authorise", ids: [ID], verify: NPM_TEST, guards });
    expect(authorisations(await readLedger(d)).get(ID)).toEqual({ verify: NPM_TEST, guards });
  });

  it("reads what was decided about holding each problem and how fixes land", () => {
    const AT = "2026-10-06T11:00:00.000Z";
    const entries = [
      { t: "authorise" as const, at: AT, ids: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], verify: NPM_TEST, threshold: "high" as const, hold: { aaaaaaaaaaaa: true, bbbbbbbbbbbb: false }, landing: { type: "merge-back" } },
    ];
    expect(authorisations(entries as any).get("aaaaaaaaaaaa")).toEqual({ verify: NPM_TEST, hold: true, landing: { type: "merge-back" } });
    expect(authorisations(entries as any).get("bbbbbbbbbbbb")).toEqual({ verify: NPM_TEST, hold: false, landing: { type: "merge-back" } });
  });
});
