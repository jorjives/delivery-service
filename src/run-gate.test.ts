import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, load } from "./case-file.js";
import { recordBaseline } from "./run-gate.js";
import { ImmutabilityViolation } from "./errors.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate reads a TAP file from the worktree, so a test can change what the
// gate sees between baseline and check without changing the pinned command.
const TAP_GATE: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

const GREEN = "1..2\nok 1 - alpha\nok 2 - beta\n";

let surfaceDir: string;
let worktree: string;

async function newSurface(gateRef: GateRef = TAP_GATE): Promise<void> {
  surfaceDir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
  worktree = await mkdtemp(join(tmpdir(), "run-gate-tree-"));
  await create(surfaceDir, { surfaceId: "surface-1", taskDef: { intent: "fix bug" }, gateRef }, budgets);
}

async function tap(contents: string): Promise<void> {
  await writeFile(join(worktree, "report.tap"), contents);
}

describe("recordBaseline", () => {
  beforeEach(async () => {
    await newSurface();
    await tap(GREEN);
  });

  it("resolves the header's gate ref, runs baseline, and stores it in the case file", async () => {
    const report = await recordBaseline(surfaceDir, worktree);

    expect(report.status).toBe("PASS");
    expect(report.assertions.map((a) => a.id)).toEqual(["1 - alpha", "2 - beta"]);

    const loaded = await load(surfaceDir);
    expect(loaded.header.baseline).toEqual(report);
  });

  it("rejects a second baseline for the same surface", async () => {
    await recordBaseline(surfaceDir, worktree);

    await expect(recordBaseline(surfaceDir, worktree)).rejects.toThrow(ImmutabilityViolation);
  });

  it("returns an ERROR report without storing it when the gate cannot run", async () => {
    await rm(join(worktree, "report.tap"));

    const report = await recordBaseline(surfaceDir, worktree);

    expect(report.status).toBe("ERROR");
    const loaded = await load(surfaceDir);
    expect(loaded.header.baseline).toBeNull();
  });
});
