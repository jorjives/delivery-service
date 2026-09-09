import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, appendEntry, writeRef } from "./case-file.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { workerRoleConfig } from "./role-config.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prompt-assembly-"));
  await create(
    dir,
    {
      surfaceId: "s-1",
      taskDef: { intent: "add a greeting endpoint" },
      gateRef,
      domainPrompt: "This is a Python service.",
    },
    budgets,
  );
});

describe("assemblePrompt", () => {
  it("puts the role fragment and the domain prompt in the system prompt", async () => {
    const caseFile = await load(dir);
    const { systemPrompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(systemPrompt).toContain("You are the worker on a gated delivery harness.");
    expect(systemPrompt).toContain("This is a Python service.");
  });

  it("carries the task definition, the brief slot and the envelope instruction, in that order", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("add a greeting endpoint");
    const order = ["## Task", "## Brief", "## Gate evidence", "## Reply format"];
    const positions = order.map((heading) => prompt.indexOf(heading));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("names the role's legal statuses in the envelope instruction", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("completed");
    expect(prompt).toContain("escalate");
  });

  it("says plainly when there is no brief and no gate evidence yet", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("No distilled brief");
    expect(prompt).toContain("No failing assertions");
  });

  it("reproduces the gate's newly-failing assertions verbatim", async () => {
    const detailRef = await writeRef(dir, "gate-1-0-0", {
      id: "test_greeting",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "AssertionError: expected 'hi' to equal 'hello'",
    });
    await appendEntry(dir, {
      t: "gate",
      attempt: 1,
      status: "FAIL",
      newFailures: [{ id: "test_greeting", detailRef }],
      class: "fail",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("test_greeting");
    expect(prompt).toContain("AssertionError: expected 'hi' to equal 'hello'");
  });

  it("produces a byte-identical request for the same case file", async () => {
    const first = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    const second = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    expect(second.prompt).toBe(first.prompt);
    expect(second.systemPrompt).toBe(first.systemPrompt);
  });

  it("ignores the session key, so a retry re-sends the same request", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    const before = await load(dir);
    const first = assemblePrompt(before, workerRoleConfig, await resolveEvidence(dir, before));
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-1" });
    const after = await load(dir);
    const second = assemblePrompt(after, workerRoleConfig, await resolveEvidence(dir, after));
    expect(second.prompt).toBe(first.prompt);
  });
});
