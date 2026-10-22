import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveryLedgerPath, foldDelivery, readDelivery, recordDelivery, type DeliveryEntry } from "./delivery-ledger.js";

const B = "delivery/main";
const at = (minute: number) => `2026-10-17T09:${String(minute).padStart(2, "0")}:00.000Z`;
const landed = (runId: string, minute: number): DeliveryEntry => ({ t: "landed", branch: B, runId, key: `backlog:${runId}.md`, intent: runId, commit: "c", at: at(minute) });

describe("the delivery ledger", () => {
  it("lives beside the item ledger", () => {
    expect(deliveryLedgerPath(join("/state", "ledger", "repo", "items.jsonl"))).toBe(join("/state", "ledger", "repo", "delivery.jsonl"));
  });

  it("knows nothing of a branch it never opened", () => {
    expect(foldDelivery([], B)).toEqual({ branch: B, base: null, openedAt: null, landed: [], pending: [], closer: null, blocked: null });
  });

  it("lists what landed since the branch opened, once per run, and what the closer has not yet handed off", () => {
    const state = foldDelivery([
      { t: "opened", branch: B, base: "main", from: "a", at: at(0) },
      landed("r1", 1),
      landed("r1", 2),
      { t: "closed", branch: B, status: "DONE", detail: "committed", at: at(3) },
      landed("r2", 4),
      { t: "closed", branch: B, status: "FAIL", detail: "refused", at: at(5) },
      { t: "landed", branch: "delivery/other", runId: "x", key: "k", intent: "i", commit: "c", at: at(6) },
    ], B);

    expect(state.openedAt).toBe(at(0));
    expect(state.landed.map((e) => e.runId)).toEqual(["r1", "r2"]);
    expect(state.pending.map((e) => e.runId)).toEqual(["r2"]);
    expect(state.closer).toEqual({ status: "FAIL", detail: "refused", at: at(5) });
  });

  it("keeps an empty landing as delivered: still landed and pending, marked empty", () => {
    const state = foldDelivery([
      { t: "opened", branch: B, base: "main", from: "a", at: at(0) },
      { ...landed("r1", 1), empty: true },
    ], B);

    expect(state.landed).toMatchObject([{ runId: "r1", empty: true }]);
    expect(state.pending).toMatchObject([{ runId: "r1", empty: true }]);
  });

  it("starts a new section when the branch opens again", () => {
    const state = foldDelivery([
      { t: "opened", branch: B, base: "main", from: "a", at: at(0) },
      landed("r1", 1),
      { t: "closed", branch: B, status: "DONE", detail: "merged", at: at(2) },
      { t: "opened", branch: B, base: "main", from: "b", at: at(3) },
    ], B);

    expect(state).toMatchObject({ openedAt: at(3), landed: [], pending: [], closer: null });
  });

  it("stays blocked until the branch opens again or the base is merged in", () => {
    const blocked: DeliveryEntry = { t: "blocked", branch: B, base: "main", baseTip: "m1", tip: "d1", reason: "conflicts", at: at(1) };
    const opened: DeliveryEntry = { t: "opened", branch: B, base: "main", from: "a", at: at(0) };
    expect(foldDelivery([opened, blocked], B).blocked).toEqual(blocked);
    expect(foldDelivery([opened, blocked, { t: "base_merged", branch: B, base: "main", commit: "m2", at: at(2) }], B).blocked).toBeNull();
  });

  it("reads back what it recorded, stamped with when", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "delivery-ledger-")), "delivery.jsonl");
    await recordDelivery(path, { t: "opened", branch: B, base: "main", from: "a" });
    expect((await readDelivery(path, B)).openedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});
