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
    expect(foldDelivery([], B)).toEqual({ branch: B, base: null, openedAt: null, landed: [], pending: [], closer: null, blocked: null, stacked: false, from: null, restacked: false, earlier: new Map(), pullRequests: new Map() });
  });

  it("marks a section opened in stack mode as stacked, and a rolling one not", () => {
    expect(foldDelivery([{ t: "opened", branch: B, base: "main", from: "a", stack: true, at: at(0) }], B).stacked).toBe(true);
    expect(foldDelivery([{ t: "opened", branch: B, base: "main", from: "a", at: at(0) }], B).stacked).toBe(false);
  });

  it("keeps the section's opening commit", () => {
    const state = foldDelivery([
      { t: "opened", branch: B, base: "main", from: "a", at: at(0) },
      { t: "opened", branch: B, base: "main", from: "b", at: at(1) },
    ], B);

    expect(state.from).toBe("b");
  });

  it("keeps, per ref, the latest pull request observed since the section opened", () => {
    const state = foldDelivery([
      { t: "opened", branch: B, base: "main", from: "a", stack: true, at: at(0) },
      { t: "observed", branch: B, pullRequests: [{ ref: "delivery-stack/main/r1", url: "https://example.invalid/1", state: "OPEN" }], at: at(1) },
      { t: "observed", branch: B, pullRequests: [{ ref: "delivery-stack/main/r1", url: "https://example.invalid/1", state: "MERGED" }, { ref: "delivery-stack/main/r2", url: "https://example.invalid/2", state: "OPEN" }], at: at(2) },
    ], B);

    expect([...state.pullRequests]).toEqual([
      ["delivery-stack/main/r1", { url: "https://example.invalid/1", state: "MERGED" }],
      ["delivery-stack/main/r2", { url: "https://example.invalid/2", state: "OPEN" }],
    ]);
  });

  it("ignores a pull request observed before the latest opened", () => {
    const state = foldDelivery([
      { t: "opened", branch: B, base: "main", from: "a", stack: true, at: at(0) },
      { t: "observed", branch: B, pullRequests: [{ ref: "delivery-stack/main/r1", url: "https://example.invalid/1", state: "OPEN" }], at: at(1) },
      { t: "opened", branch: B, base: "main", from: "b", stack: true, at: at(2) },
    ], B);

    expect(state.pullRequests.size).toBe(0);
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
      { t: "landed", branch: B, runId: "r1", key: "backlog:r1.md", intent: "r1", commit: "c", empty: true, at: at(1) },
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

describe("foldDelivery after a restack", () => {
  const D = B;
  const opened = (from: string): DeliveryEntry => ({ t: "opened", branch: D, base: "main", from, at: at(0) });
  const landed = (runId: string, commit: string): DeliveryEntry => ({ t: "landed", branch: D, runId, key: `backlog:${runId}.md`, intent: runId, commit, at: at(1) });
  const closedDone = (): DeliveryEntry => ({ t: "closed", branch: D, status: "DONE", detail: "merged", at: at(2) });

  it("drops merged levels, moves the rest to their new commits, and opens the section at the new parent", () => {
    const state = foldDelivery([opened("F"), landed("r1", "c1"), landed("r2", "c2"), landed("r3", "c3"), closedDone(),
      { t: "restacked", branch: D, onto: "B2", merged: ["r1"], levels: [{ runId: "r2", commit: "n2" }, { runId: "r3", commit: "n3" }], at: at(3) }], D);
    expect(state.landed.map((e) => [e.runId, e.commit])).toEqual([["r2", "n2"], ["r3", "n3"]]);
    expect(state.from).toBe("B2");
    expect(state.pending).toEqual([]);
    expect(state.restacked).toBe(true);
    expect(state.earlier.get("r2")).toEqual(["c2"]);
  });

  it("clears a block, and stops counting as restacked once the closer succeeds", () => {
    const restack: DeliveryEntry = { t: "restacked", branch: D, onto: "B2", merged: [], levels: [], at: at(3) };
    const blocked: DeliveryEntry = { t: "blocked", branch: D, base: "main", baseTip: "m1", tip: "d1", reason: "conflicts", at: at(2) };

    expect(foldDelivery([opened("F"), blocked, restack], D).blocked).toBeNull();
    expect(foldDelivery([opened("F"), restack, closedDone()], D).restacked).toBe(false);
  });

  it("keeps a landing after the restack pending, at its own commit", () => {
    const state = foldDelivery([opened("F"), landed("r2", "c2"), landed("r3", "c3"), closedDone(),
      { t: "restacked", branch: D, onto: "B2", merged: [], levels: [{ runId: "r2", commit: "n2" }, { runId: "r3", commit: "n3" }], at: at(3) },
      landed("r4", "c4")], D);
    expect(state.pending.map((e) => [e.runId, e.commit])).toEqual([["r4", "c4"]]);
    expect(state.landed.map((e) => [e.runId, e.commit])).toEqual([["r2", "n2"], ["r3", "n3"], ["r4", "c4"]]);
  });

  it("keeps the pulls fingerprint on a blocked entry", () => {
    const state = foldDelivery([opened("F"), { t: "blocked", branch: D, base: "main", baseTip: "m1", tip: "d1", reason: "conflicts", pulls: "x", at: at(2) }], D);
    expect(state.blocked?.pulls).toBe("x");
  });
});
