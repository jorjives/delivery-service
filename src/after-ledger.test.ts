import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterLedgerPath, foldAfter, isPending, readAfter, recordAfter, waiting, type AfterEntry } from "./after-ledger.js";

const at = (minute: number) => `2026-10-18T09:${String(minute).padStart(2, "0")}:00.000Z`;
const batch: AfterEntry = {
  t: "batch", batch: "b1", branch: "delivery/main", base: "main", commit: "c1",
  landed: [{ run: "r1", item: "backlog:a.md", intent: "say hello" }],
  followUps: [{ run: "r1", source: "tracker", file: "f.md", text: "x" }],
  steps: [
    { for: "follow-ups", label: "Raise follow-ups", step: { raise: true } },
    { for: "project", label: "deploy", step: { run: "make deploy" } },
    { for: "project", label: "notes", step: { prompt: "notes" } },
  ],
  at: at(0),
};

describe("the after ledger", () => {
  it("lives beside the item ledger", () => {
    expect(afterLedgerPath(join("/state", "ledger", "repo", "items.jsonl"))).toBe(join("/state", "ledger", "repo", "after.jsonl"));
  });

  it("starts a batch with every step pending", () => {
    const [state] = foldAfter([batch]);
    expect(state?.next).toBe(0);
    expect(state?.steps.map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
    if (!state) throw new Error("no batch folded");
    expect(isPending(state)).toBe(true);
  });

  it("carries on from the step that failed, and shows the rest as pending", () => {
    const [state] = foldAfter([
      batch,
      { t: "raised", batch: "b1", file: "f.md", id: "#1", at: at(1) },
      { t: "step", batch: "b1", index: 0, status: "done", detail: "raised f.md as #1", at: at(1) },
      { t: "step", batch: "b1", index: 1, status: "failed", detail: "exited with code 2", at: at(2) },
    ]);
    expect(state?.next).toBe(1);
    expect(state?.steps.map((s) => s.status)).toEqual(["done", "failed", "pending"]);
    expect(state?.steps[1]).toMatchObject({ detail: "exited with code 2", at: at(2) });
    expect(state?.raised.get("f.md")).toBe("#1");
  });

  it("is finished once every step is done, and keeps what an agent step left", () => {
    const [state] = foldAfter([
      batch,
      { t: "step", batch: "b1", index: 0, status: "done", detail: "", at: at(1) },
      { t: "step", batch: "b1", index: 1, status: "failed", detail: "no", at: at(2) },
      { t: "step", batch: "b1", index: 1, status: "done", detail: "deployed", at: at(3) },
      { t: "held", batch: "b1", index: 2, items: [{ file: "g.md", text: "y" }], discarded: ["README.md"], at: at(4) },
      { t: "step", batch: "b1", index: 2, status: "done", detail: "", at: at(4) },
    ]);
    expect(state?.next).toBe(3);
    if (!state) throw new Error("no batch folded");
    expect(isPending(state)).toBe(false);
    expect(state?.held.get(2)).toEqual({ items: [{ file: "g.md", text: "y" }], discarded: ["README.md"] });
  });

  it("counts a skipped step as finished, so a skipped batch is no longer pending", () => {
    const skipped = (index: number): AfterEntry => ({ t: "step", batch: "b1", index, status: "skipped", detail: "superseded by b2", at: at(5) });
    const [state] = foldAfter([batch, skipped(1)]);
    expect(state?.steps.map((s) => s.status)).toEqual(["pending", "skipped", "pending"]);
    expect(state?.next).toBe(0);
    if (!state) throw new Error("no batch folded");
    expect(waiting(state)).toBe(2);
    const [rest] = foldAfter([batch, skipped(1), skipped(0), skipped(2)]);
    expect(rest?.next).toBe(3);
    if (!rest) throw new Error("no batch folded");
    expect(isPending(rest)).toBe(false);
    // A skipped step is final: a later failure entry for it does not bring it back.
    expect(foldAfter([batch, skipped(1), { t: "step", batch: "b1", index: 1, status: "failed", detail: "late", at: at(6) }])[0]?.steps[1]?.status).toBe("skipped");
  });

  it("reads back what it recorded, stamped with when", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "after-ledger-")), "after.jsonl");
    await recordAfter(path, batch);
    const [state] = await readAfter(path);
    expect(state?.batch.batch).toBe("b1");
    expect(state?.batch.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await readAfter(join(tmpdir(), "no-such-after.jsonl"))).toEqual([]);
  });
});
