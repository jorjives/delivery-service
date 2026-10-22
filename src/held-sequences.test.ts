import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldLedger } from "./item-ledger.js";
import { heldPath, mergeHeld, readHeld, recordHeld, stillHeld } from "./held-sequences.js";

const at = "2026-10-22T09:00:00.000Z";

const hold = (sequence: string, source: string, reason: "parked" | "decision" | "in_flight" = "parked") => ({ sequence, item: `${source}:${sequence}-1`, source, reason });

describe("the held sequences a run records", () => {
  it("lives beside the item ledger", () => {
    expect(heldPath("/state/ledger/repo/items.jsonl")).toBe("/state/ledger/repo/held.json");
  });

  it("reads back what was recorded, and nothing when no run has recorded any", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "held-")), "held.json");
    expect(await readHeld(path)).toEqual([]);
    await recordHeld(path, [hold("spec-a", "backlog")], ["backlog"]);
    expect(await readHeld(path)).toEqual([hold("spec-a", "backlog")]);
    await recordHeld(path, [], ["backlog"]);
    expect(await readHeld(path)).toEqual([]);
  });

  it("keeps what an earlier run found in a source this run did not read", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "held-")), "held.json");
    await recordHeld(path, [hold("spec-a", "backlog"), hold("spec-b", "slices")], ["backlog", "slices"]);
    await recordHeld(path, [], ["backlog"]);
    expect(await readHeld(path)).toEqual([hold("spec-b", "slices")]);
  });
});

describe("mergeHeld", () => {
  it("replaces the entries of each source read with what this run found there", () => {
    const previous = [hold("old", "backlog"), hold("kept", "slices")];
    expect(mergeHeld(previous, [hold("new", "backlog")], ["backlog"])).toEqual([hold("kept", "slices"), hold("new", "backlog")]);
  });

  it("keeps every entry when no source was read", () => {
    expect(mergeHeld([hold("a", "slices")], [], [])).toEqual([hold("a", "slices")]);
  });

  it("keeps one entry for a sequence that spans sources: the one found this run, from the earlier source", () => {
    const previous = [hold("spec-a", "slices", "in_flight")];
    expect(mergeHeld(previous, [hold("spec-a", "backlog")], ["backlog"])).toEqual([hold("spec-a", "backlog")]);
  });
});

describe("stillHeld", () => {
  const held = (item: string, reason: "parked" | "decision" | "in_flight" = "in_flight") => ({ sequence: `seq-${item}`, item, source: "backlog", reason });
  // The report's shape has no `source`.
  // Named fields rather than a rest spread: the lint config flags an unused destructured `source`.
  const shown = ({ sequence, item, reason }: ReturnType<typeof held>) => ({ sequence, item, reason });

  it("gives each holder the reason the item ledger says now", () => {
    const ledger = foldLedger([
      { t: "parked", key: "p", reason: "attempts", at },
      { t: "parked", key: "q", reason: "decision", at },
      { t: "dispatched", key: "r", runId: "r1", intent: "x", at },
    ]);
    expect(stillHeld([held("p"), held("q"), held("r", "parked")], ledger)).toEqual([shown(held("p", "parked")), shown(held("q", "decision")), shown(held("r", "in_flight"))]);
  });

  it("drops a holder that has since been unparked, answered or delivered", () => {
    const ledger = foldLedger([
      { t: "parked", key: "u", reason: "escalated", at }, { t: "unparked", key: "u", at },
      { t: "parked", key: "a", reason: "decision", at }, { t: "answered", key: "a", answer: "yes", at },
      { t: "dispatched", key: "d", runId: "d1", intent: "x", at }, { t: "ended", key: "d", runId: "d1", class: "delivered", at },
    ]);
    expect(stillHeld([held("u", "parked"), held("a", "decision"), held("d")], ledger)).toEqual([]);
  });

  it("drops a holder the item ledger has never heard of", () => {
    expect(stillHeld([held("chosen-but-not-started")], new Map())).toEqual([]);
  });
});
