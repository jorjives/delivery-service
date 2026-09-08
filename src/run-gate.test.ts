import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, load, readRef } from "./case-file.js";
import { recordBaseline, runCheck } from "./run-gate.js";
import { ImmutabilityViolation, MissingBaseline } from "./errors.js";
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

// Written out in full rather than spread from TAP_GATE: TAP_GATE is annotated
// as the `GateRef` union, and spreading a union then assigning the result back
// to `GateRef` is an assignability risk `npm run lint` (tsc --noEmit over
// `src`, which includes `src/*.test.ts`) would have to catch for us.
async function newSurfaceWithFlag(): Promise<void> {
  await newSurface({
    type: "command",
    command: "cat report.tap",
    parseMode: "tap",
    failOnNewAssertions: true,
  });
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

const REGRESSED = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";

describe("runCheck", () => {
  beforeEach(async () => {
    await newSurface();
    await tap(GREEN);
  });

  it("appends a PASS entry with no new failures when nothing regressed", async () => {
    await recordBaseline(surfaceDir, worktree);

    const { delta } = await runCheck(surfaceDir, worktree, 1);

    expect(delta.pass).toBe(true);
    const loaded = await load(surfaceDir);
    expect(loaded.history).toEqual([
      { t: "baseline", status: "PASS" },
      { t: "gate", attempt: 1, status: "PASS", newFailures: [] },
    ]);
  });

  it("records the verdict, the new failures, and the failure class after a regression", async () => {
    await recordBaseline(surfaceDir, worktree);
    await tap(REGRESSED);

    const { delta } = await runCheck(surfaceDir, worktree, 1);

    expect(delta.pass).toBe(false);
    expect(delta.class).toBe("fail");

    const loaded = await load(surfaceDir);
    expect(loaded.history[1]).toEqual({
      t: "gate",
      attempt: 1,
      status: "FAIL",
      class: "fail",
      newFailures: [{ id: "2 - beta", detailRef: "gate-1-0-0" }],
    });

    expect(await readRef(surfaceDir, "gate-1-0-0")).toEqual({
      id: "2 - beta",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "not ok 2 - beta",
    });
  });

  it("leaves the stored baseline untouched across the round trip", async () => {
    const baseline = await recordBaseline(surfaceDir, worktree);
    await tap(REGRESSED);
    await runCheck(surfaceDir, worktree, 1);

    const loaded = await load(surfaceDir);
    expect(loaded.header.baseline).toEqual(baseline);
  });

  it("records a gate-level error as an error-class entry with no new failures", async () => {
    await recordBaseline(surfaceDir, worktree);
    await rm(join(worktree, "report.tap"));

    const { report, delta } = await runCheck(surfaceDir, worktree, 2);

    expect(report.status).toBe("ERROR");
    expect(delta.class).toBe("error");
    // The returned delta agrees with what was persisted: the ABSENT artefacts
    // of a failed gate run are not reported as the worker's new failures.
    expect(delta.newFailures).toEqual([]);

    const loaded = await load(surfaceDir);
    expect(loaded.history[1]).toEqual({
      t: "gate",
      attempt: 2,
      status: "ERROR",
      class: "error",
      newFailures: [],
    });
  });

  it("honours failOnNewAssertions pinned on the gate ref", async () => {
    await newSurfaceWithFlag();
    await tap("1..1\nok 1 - alpha\n");
    await recordBaseline(surfaceDir, worktree);
    await tap("1..2\nok 1 - alpha\nnot ok 2 - brandnew\n");

    const { delta } = await runCheck(surfaceDir, worktree, 1);

    expect(delta.pass).toBe(false);
    expect(delta.newFailures.map((f) => f.id)).toEqual(["2 - brandnew"]);
  });

  it("rejects a check run before any baseline was recorded", async () => {
    await expect(runCheck(surfaceDir, worktree, 1)).rejects.toThrow(MissingBaseline);
  });

  it("keys a re-check of the same attempt separately from the first check", async () => {
    await tap(GREEN);
    await recordBaseline(surfaceDir, worktree);

    await tap("1..2\nok 1 - alpha\nnot ok 2 - beta\n");
    await runCheck(surfaceDir, worktree, 1);

    await tap("1..2\nnot ok 1 - alpha\nok 2 - beta\n");
    await runCheck(surfaceDir, worktree, 1);

    const { history } = await load(surfaceDir);
    const gates = history.filter((e) => e.t === "gate") as Extract<typeof history[number], { t: "gate" }>[];
    expect(gates).toHaveLength(2);

    const first = gates[0];
    const second = gates[1];
    if (!first || !second) throw new Error("expected 2 gate entries");

    const firstFailure = first.newFailures[0];
    const secondFailure = second.newFailures[0];
    if (!firstFailure || !secondFailure) throw new Error("expected failures on gate entries");

    expect(firstFailure.detailRef).toBe("gate-1-0-0");
    expect(secondFailure.detailRef).toBe("gate-1-1-0");

    // The first check's detail must still be readable and still be its own.
    expect(await readRef(surfaceDir, firstFailure.detailRef))
      .toMatchObject({ id: "2 - beta" });
    expect(await readRef(surfaceDir, secondFailure.detailRef))
      .toMatchObject({ id: "1 - alpha" });
  });
});
