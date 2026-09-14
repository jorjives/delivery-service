/**
 * UAT demo for Agent Invocation Primitive Slice 1: Wire a Worker to a Real
 * Invocation and Get Back a Typed Result.
 *
 * Provisions a fresh case file, supplies the reference worker configuration,
 * and runs the real invocation primitive three times against a scripted agent
 * session: one clean completion, one escalation, one reply that does not match
 * the shape the worker must emit.
 *
 * Runs against `claude-mock`, vendored in `vendor/claude-mock` and installed by
 * `npm install`: no other setup. No live API call is made, and no API key is
 * needed.
 *
 * This demo does NOT prove tool authority is enforced — the mock models no tool
 * permissions. That guarantee rests on the real SDK and is Slice 2's demo.
 *
 * Usage: npx tsx demos/agent-invocation-slice-1-worker-invocation.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create } from "../src/case-file.js";
import { invoke } from "../src/agent-invoke.js";
import { workerRoleConfig } from "../src/role-config.js";
import { mockSessionEnvironment } from "../src/testing.js";
import type { AgentContext, Terminus } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

const scenarios: { name: string; reply: unknown }[] = [
  {
    name: "the agent finishes cleanly",
    reply: { status: "completed", rationale: "added the greeting endpoint and its handler" },
  },
  {
    name: "the agent escalates",
    reply: {
      status: "escalate",
      category: "authority",
      rationale: "the change needs a deploy credential this role was not given",
    },
  },
  {
    name: "the agent replies with the wrong shape",
    reply: { status: "finished", note: "all done!" },
  },
];

function describe(terminus: Terminus): string {
  switch (terminus.status) {
    case "completed":
      return `completed — ${terminus.rationale}`;
    case "escalate":
      return `escalate (${terminus.category}) — ${terminus.rationale}`;
    case "incomplete":
      return `did not complete — ${terminus.rationale}`;
  }
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-demo-case-"));
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "agent-demo-tree-"));
  const scriptPath = path.join(dir, "mock.json");
  const journalPath = path.join(dir, "journal.jsonl");

  await create(
    dir,
    {
      surfaceId: "agent-demo",
      taskDef: { intent: "add a greeting endpoint" },
      gateRef,
      domainPrompt: "This is a small HTTP service.",
    },
    budgets,
  );

  const ctx: AgentContext = { worktreePath, dir, sessionKey: "worker-1-0" };

  console.log(`Case file: ${dir}`);
  console.log(`Role:      ${workerRoleConfig.role}`);
  console.log(`Tools:     ${workerRoleConfig.allowedTools.join(", ")}\n`);

  for (const scenario of scenarios) {
    fs.writeFileSync(scriptPath, JSON.stringify([{ json: scenario.reply }]), "utf-8");
    const terminus = await invoke(workerRoleConfig, ctx, mockSessionEnvironment({ scriptPath, journalPath }));
    console.log(`Scenario: ${scenario.name}`);
    console.log(`  Result: ${describe(terminus)}\n`);
  }
}

await main();
