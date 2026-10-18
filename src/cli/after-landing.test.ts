import { describe, expect, it } from "vitest";
import type { LandedEntry } from "../delivery-ledger.js";
import type { RunRecord } from "../run-records.js";
import type { PlannedStep } from "../after-ledger.js";
import { afterFor, currentStep, newBatch } from "./after-landing.js";
import type { DeliveryConfig } from "./config.js";

const landed = (runId: string): LandedEntry => ({ t: "landed", branch: "delivery/main", runId, key: `backlog:${runId}.md`, intent: `do ${runId}`, commit: "c", at: "2026-10-18T09:00:00.000Z" });
const record = (runId: string, workflow?: string): RunRecord =>
  ({ runId, dir: `/nowhere/${runId}`, repoPath: "/nowhere", caseFile: { header: { surfaceId: runId, taskDef: { intent: `do ${runId}` }, ...(workflow === undefined ? {} : { workflow: { name: workflow, steps: [] } }) }, history: [] } }) as unknown as RunRecord;

const config: DeliveryConfig = {
  after: [{ run: "make deploy" }],
  workflows: { scan: { steps: [{ name: "scan", prompt: "look" }], after: [] }, notes: { steps: [{ name: "n", prompt: "n" }], after: [{ prompt: "Write release notes." }] } },
};
const at = { config, branch: "delivery/main", base: "main", commit: "c", now: new Date("2026-10-18T09:00:00Z") };

describe("after steps for what landed", () => {
  it("uses a workflow's own after steps in place of the project's", () => {
    expect(afterFor(record("r1"), config)).toEqual({ key: "project", steps: [{ run: "make deploy" }] });
    expect(afterFor(record("r2", "scan"), config)).toEqual({ key: "scan", steps: [] });
    expect(afterFor(record("r3", "notes"), config).steps).toEqual([{ prompt: "Write release notes." }]);
  });

  it("runs each distinct list once, in the order the tasks landed", async () => {
    const batch = await newBatch({ ...at, landed: [landed("r1"), landed("r3"), landed("r4")], records: [record("r1"), record("r3", "notes"), record("r4")] });
    expect(batch?.steps.map((s) => [s.for, s.label])).toEqual([["project", "make deploy"], ["notes", "Write release notes."]]);
    expect(batch?.landed.map((l) => l.run)).toEqual(["r1", "r3", "r4"]);
  });

  it("reads a pending step from the config as it is now, by its place in its list", () => {
    const steps: PlannedStep[] = [
      { for: "follow-ups", label: "Raise follow-ups", step: { raise: true } },
      { for: "project", label: "make depoly", step: { run: "make depoly" } },
      { for: "project", label: "make notes", step: { run: "make notes" } },
      { for: "notes", label: "Write release notes.", step: { prompt: "Write release notes." } },
    ];
    const fixed: DeliveryConfig = { after: [{ run: "make deploy" }], workflows: { notes: { steps: [{ name: "n", prompt: "n" }], after: [{ prompt: "Write better release notes." }] } } };
    expect(currentStep(fixed, steps, 0)).toEqual({ raise: true });
    expect(currentStep(fixed, steps, 1)).toEqual({ run: "make deploy" });
    expect(currentStep(fixed, steps, 2)).toBeUndefined();
    expect(currentStep(fixed, steps, 3)).toEqual({ prompt: "Write better release notes." });
  });

  it("starts nothing when no task landed, or when the tasks' lists are empty", async () => {
    expect(await newBatch({ ...at, landed: [landed("b0-1")], records: [] })).toBeUndefined();
    expect(await newBatch({ ...at, landed: [landed("r2")], records: [record("r2", "scan")] })).toBeUndefined();
  });
});
