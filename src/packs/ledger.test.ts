import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DamagedReview } from "../errors.js";
import type { GateRef } from "../schema.js";
import { withoutAt } from "../without-at.js";
import { appendLedger, authorisations, readLedger, signOffResults, allowedUnchecked, allowedTestEdits, type LedgerEntry } from "./ledger.js";
import { guardListsFor } from "../guards.js";

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
    const entries: LedgerEntry[] = [
      { t: "authorise", at: AT, ids: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], verify: NPM_TEST, threshold: "high", hold: { aaaaaaaaaaaa: true, bbbbbbbbbbbb: false }, landing: { type: "merge-back" } },
    ];
    expect(authorisations(entries).get("aaaaaaaaaaaa")).toEqual({ verify: NPM_TEST, threshold: "high", hold: true, landing: { type: "merge-back" } });
    expect(authorisations(entries).get("bbbbbbbbbbbb")).toEqual({ verify: NPM_TEST, threshold: "high", hold: false, landing: { type: "merge-back" } });
  });

  it("folds each problem's sign-off to its last result", () => {
    const AT = "2026-10-06T11:00:00.000Z";
    const entries: LedgerEntry[] = [
      { t: "signed_off" as const, at: AT, id: "aaaaaaaaaaaa" },
      { t: "not_landed" as const, at: AT, id: "aaaaaaaaaaaa", reason: "conflict" as const, detail: "rebase stopped" },
      { t: "signed_off" as const, at: AT, id: "aaaaaaaaaaaa" },
      { t: "landed" as const, at: AT, id: "aaaaaaaaaaaa", commit: "abc123", closer: { type: "merge-back" } as const },
      { t: "rejected" as const, at: AT, id: "bbbbbbbbbbbb" },
    ];
    expect(signOffResults(entries).get("aaaaaaaaaaaa")).toMatchObject({ t: "landed", commit: "abc123" });
    expect(signOffResults(entries).get("bbbbbbbbbbbb")).toMatchObject({ t: "rejected" });
  });
});

describe("approving without a check", () => {
  const AT = "2026-10-05T10:00:00.000Z";
  const decided = (ids: string[], choice: "approve" | "skip", allowUnchecked?: true): LedgerEntry => ({ t: "decision", at: AT, ids, choice, ...(allowUnchecked ? { allowUnchecked } : {}) });

  it("is remembered for each problem until a later choice replaces it", () => {
    expect(allowedUnchecked([decided(["aaaaaaaaaaaa", "bbbbbbbbbbbb"], "approve", true)])).toEqual(new Set(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
    expect(allowedUnchecked([decided(["aaaaaaaaaaaa"], "approve", true), decided(["aaaaaaaaaaaa"], "skip")])).toEqual(new Set());
  });
});

describe("recording the sign-off threshold", () => {
  it("remembers the threshold an authorisation was written under, null included, and leaves it absent for an older entry", () => {
    const base = { t: "authorise", at: "2026-10-09T10:00:00.000Z", ids: ["aaaaaaaaaaaa"], verify: NPM_TEST, landing: { type: "merge-back" as const } };
    expect(authorisations([{ ...base, threshold: null }] as LedgerEntry[]).get("aaaaaaaaaaaa")).toHaveProperty("threshold", null);
    expect(authorisations([{ ...base, threshold: "medium" }] as LedgerEntry[]).get("aaaaaaaaaaaa")?.threshold).toBe("medium");
    expect(authorisations([base] as LedgerEntry[]).get("aaaaaaaaaaaa")).not.toHaveProperty("threshold");
  });
});

describe("letting a fix change existing tests", () => {
  const AT = "2026-10-09T10:00:00.000Z";
  const A = "aaaaaaaaaaaa";
  const approve = (allowTestEdits?: true): LedgerEntry => ({ t: "decision", at: AT, ids: [A], choice: "approve", ...(allowTestEdits ? { allowTestEdits } : {}) });
  const authorise = (over: Partial<Extract<LedgerEntry, { t: "authorise" }>> = {}): LedgerEntry => ({ t: "authorise", at: AT, ids: [A], verify: NPM_TEST, hold: { [A]: false }, landing: { type: "merge-back" }, ...over });

  it("is remembered for each problem until a later choice replaces it", () => {
    expect(allowedTestEdits([approve(true)])).toEqual(new Set([A]));
    expect(allowedTestEdits([approve(true), approve()])).toEqual(new Set());
  });

  it("reads back from the record, with the authorisation naming each problem it was granted for", async () => {
    const d = dir();
    await appendLedger(d, { t: "decision", ids: [A], choice: "approve", allowTestEdits: true });
    await appendLedger(d, { t: "authorise", ids: [A], verify: NPM_TEST, hold: { [A]: true }, allowTestEdits: [A], landing: { type: "merge-back" } });
    expect(authorisations(await readLedger(d)).get(A)).toEqual({ verify: NPM_TEST, hold: true, allowTestEdits: true, landing: { type: "merge-back" } });
  });

  it("re-opens a problem already taken on when approved again allowing test edits, so its next authorisation is the one that counts", () => {
    expect(authorisations([approve(), authorise(), approve(true)]).has(A)).toBe(false);
    expect(authorisations([approve(), authorise(), approve(true), authorise({ hold: { [A]: true }, allowTestEdits: [A] })]).get(A)).toEqual({ verify: NPM_TEST, hold: true, allowTestEdits: true, landing: { type: "merge-back" } });
  });

  it("is not re-opened by an approval that does not allow test edits", () => {
    expect(authorisations([approve(), authorise(), approve()]).get(A)).toEqual({ verify: NPM_TEST, hold: false, landing: { type: "merge-back" } });
  });
});
