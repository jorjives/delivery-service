import { describe, expect, it } from "vitest";
import { initialCaseFile } from "./case-file.js";
import type { BudgetSet, CaseFile, GateReport, GateRef, HistoryEntry } from "./schema.js";
import { currentStep, mergeAgent, nextStepOf, stepIndexOf, stepKey, stepView } from "./workflow-step.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 }, gateError: { used: 0, max: 3 }, gateMaintenance: { used: 0, max: 2 }, terminus: { used: 0, max: 5 }, close: { used: 0, max: 3 },
};
const projectGate: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const planGate: GateRef = { type: "command", command: "test -f 'PLAN.md'", parseMode: "exitcode", checkOnly: true };
const workflow = {
  name: "plan-then-build",
  steps: [
    { name: "plan", prompt: "write PLAN.md", gateRef: planGate },
    { name: "build", prompt: "carry it out", continue: true as const, agent: { model: "opus", env: { B: "2" } }, guards: { add: ["tests-unchanged" as const] } },
  ],
};
const step1Baseline: GateReport = { status: "PASS", assertions: [] };
const step2Baseline: GateReport = { status: "PASS", assertions: [{ id: "t", outcome: "PASS", detail: "ok" }] };

function record(history: HistoryEntry[], withWorkflow = true): CaseFile {
  const cf = initialCaseFile(
    { surfaceId: "s", taskDef: { intent: "x" }, gateRef: projectGate, agent: { model: "sonnet", env: { A: "1" } }, startCommit: "c0", ...(withWorkflow ? { workflow } : {}) },
    budgets,
  );
  return { ...cf, header: { ...cf.header, baseline: step1Baseline }, history };
}

const step1Log: HistoryEntry[] = [
  { t: "baseline", status: "PASS" },
  { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" },
  { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "planned", sessionId: "sess-1" },
  { t: "gate", attempt: 1, status: "PASS", newFailures: [] },
];
const step2Opened: HistoryEntry[] = [...step1Log, { t: "step", step: 2, startCommit: "c1", resume: "sess-1" }, { t: "baseline", status: "PASS", report: step2Baseline }];

describe("stepView", () => {
  it("is the record itself for a run with no workflow", () => {
    const cf = record(step1Log, false);
    expect(stepView(cf)).toEqual(cf);
    expect(stepKey(cf, "worker-1-0")).toBe("worker-1-0");
  });

  it("puts step 1's own gate in front, keeping the whole log and the task's start", () => {
    const view = stepView(record(step1Log));
    expect(stepIndexOf(view)).toBe(1);
    expect(view.header.gateRef).toEqual(planGate);
    expect(view.header.baseline).toEqual(step1Baseline);
    expect(view.header.startCommit).toBe("c0");
    expect(view.history).toEqual(step1Log);
    expect(stepKey(view, "worker-1-0")).toBe("worker-1-0");
  });

  it("shows a later step its own log, baseline, start and gate, and the project's gate when it names none", () => {
    const view = stepView(record(step2Opened));
    expect(stepIndexOf(view)).toBe(2);
    expect(view.history).toEqual(step2Opened.slice(4));
    expect(view.header.baseline).toEqual(step2Baseline);
    expect(view.header.startCommit).toBe("c1");
    expect(view.header.gateRef).toEqual(projectGate);
    expect(stepKey(view, "worker-1-0")).toBe("step2-worker-1-0");
  });

  it("has no baseline for a step that has not taken one yet", () => {
    expect(stepView(record(step2Opened.slice(0, 5))).header.baseline).toBeNull();
  });

  it("lays the step's agent options over the project's, env merged", () => {
    expect(stepView(record(step2Opened)).header.agent).toEqual({ model: "opus", env: { A: "1", B: "2" } });
  });

  it("clears a project custom gate's digest when the step names a command gate", () => {
    const cf = record(step1Log);
    const custom = { ...cf, header: { ...cf.header, gateRef: { type: "custom" as const, modulePath: "g.js" }, gateDigest: "abc" } };
    const view = stepView(custom);
    expect(view.header.gateRef).toEqual(planGate);
    expect(view.header.gateDigest).toBeUndefined();
  });

  it("names the current and next step", () => {
    expect(currentStep(record(step1Log))?.name).toBe("plan");
    expect(nextStepOf(record(step1Log))?.name).toBe("build");
    expect(nextStepOf(record(step2Opened))).toBeUndefined();
    expect(nextStepOf(record(step1Log, false))).toBeUndefined();
  });
});

describe("mergeAgent", () => {
  it("lets the step win and merges env", () => {
    expect(mergeAgent({ model: "a", env: { X: "1" } }, { effort: "high", env: { Y: "2" } })).toEqual({ model: "a", effort: "high", env: { X: "1", Y: "2" } });
    expect(mergeAgent(undefined, { model: "b" })).toEqual({ model: "b" });
  });

  it("keeps the project's append and adds the step's after it", () => {
    // Spec §5.9: the global `append` is "text added to every step's context", so a step's own cannot drop it.
    expect(mergeAgent({ append: "Project." }, { append: "Step." })).toEqual({ append: "Project.\n\nStep." });
    expect(mergeAgent({ append: "Project." }, { model: "b" })).toEqual({ append: "Project.", model: "b" });
  });
});

describe("stepView after a landing", () => {
  it("judges the work from the tip it was rebuilt on, against that tip's baseline", () => {
    const base = initialCaseFile({ surfaceId: "s", taskDef: { intent: "x" }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } }, budgets);
    const baseline = { status: "PASS" as const, assertions: [{ id: "a", outcome: "PASS" as const, detail: "ok" }] };
    const caseFile = {
      ...base,
      header: { ...base.header, startCommit: "start", baseline: { status: "PASS" as const, assertions: [] } },
      history: [{ t: "landing" as const, onto: "tip", baseline }],
    };

    const view = stepView(caseFile);

    expect(view.header.startCommit).toBe("tip");
    expect(view.header.baseline).toEqual(baseline);
    expect(view.history).toEqual(caseFile.history);
  });
});
