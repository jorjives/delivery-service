/**
 * UAT demo for Triage and Deterministic Router Slice 2: Every Escalation Hands
 * a Human a Decision, Not Internal State.
 *
 * Drives five surfaces to escalation and prints the packet each one stores:
 * the triage agent escalates; the worker hits an authority limit; the
 * correction budget runs out; the triage agent replies with something
 * unusable; and a failed close that the triage agent wrongly answers with
 * "retry the worker".
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed. `claude-mock` does not enforce a role's tool
 * list, so this demo shows nothing about triage's read-only authority.
 *
 * Usage: npm run demo:triage-slice-2
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../src/surface.js";
import { create, readRef } from "../src/case-file.js";
import { createAgentPort } from "../src/agent-invoke.js";
import { createAgentTriage } from "../src/triage.js";
import { deterministicRouter } from "../src/router.js";
import { triageRoleConfig, EscalationPacket } from "../src/triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { initTempRepo } from "../src/temp-repo.js";
import { isOnPath } from "../src/on-path.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, CloserPort, SurfacePorts, TriagePort } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

const STUCK = {
  status: "escalate",
  category: "exhaustion",
  rationale: "The greeting comes from a translations service I cannot find in this repository.",
};

const agentPacket = {
  decision: "The greeting is served by a translations service this task cannot change. Decide whether to grant access to it or narrow the task to the template.",
  evidence: "Worker attempt 1: \"The greeting comes from a translations service I cannot find in this repository.\"",
  dead_ends: "Attempt 1 searched the route handlers and templates; the string is in neither.",
  why_now: "A worker escalation with 3 correction slots left, but a retry would repeat the same search.",
  references: ["worker-1-0"],
};

const brief = {
  problem: "The merge failed, so the change never landed.",
  dead_ends: "No earlier attempt was made; the change passed the gate first time.",
  scope: "Re-run the worker on the same task.",
  references: ["worker-1-0"],
  diagnosis: "The change may conflict with the target branch.",
};

/** A closer that refuses to accept the work, and tears down cleanly. */
const refusingCloser: CloserPort = {
  close: (_ctx, outcome) =>
    Promise.resolve(
      outcome.kind === "accepted"
        ? { status: "FAIL", detail: "The merge was refused: the target branch moved while the change was being checked." }
        : { status: "DONE", detail: "torn down" },
    ),
};

function requireMock(): void {
  if (isOnPath("claude-mock")) return;
  console.error(
    "claude-mock is not on PATH.\n\n" +
      "It is a scripted fake `claude` binary from a sibling project, deliberately not\n" +
      "vendored into this repo. Install it with `npm link` from its own checkout, then\n" +
      "run this demo again. Nothing here calls a live API.",
  );
  process.exit(1);
}

function mockSession(scratch: string, script: unknown[]) {
  const scriptPath = path.join(scratch, "mock.json");
  fs.writeFileSync(scriptPath, JSON.stringify(script), "utf-8");
  return {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: path.join(scratch, "journal.jsonl") },
  };
}

interface Scenario {
  script: unknown[];
  budgets?: Partial<BudgetSet>;
  /** Defaults to the agent-backed triage port. */
  triage?: (agent: AgentPort) => TriagePort;
  closer?: CloserPort;
}

interface Escalated {
  state: string;
  packetRef: string;
  triageCalls: number;
  packet: EscalationPacket | undefined;
}

/** Run one surface to its end; return the packet its outcome points at, and how often triage was asked. */
async function escalateOne(name: string, scenario: Scenario): Promise<Escalated> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `triage-demo-${name}-`));
  const dir = fs.mkdtempSync(path.join(scratch, `${name}-case-`));
  await create(dir, { surfaceId: name, taskDef: { intent: "make the greeting say hello" }, gateRef }, { ...budgets, ...scenario.budgets });
  const repoPath = initTempRepo(`triage-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const location = { repoPath, worktreePath: fs.mkdtempSync(path.join(scratch, `${name}-tree-`)) };

  const inner = createAgentPort(configs, mockSession(scratch, scenario.script));
  let triageCalls = 0;
  const agent: AgentPort = {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "triage") triageCalls += 1;
      return inner.invoke(roleCfg, ctx);
    },
  };
  const ports: SurfacePorts = {
    agent,
    triage: (scenario.triage ?? createAgentTriage)(agent),
    closer: scenario.closer ?? noopCloser,
  };

  const result = await run(dir, location, ports);
  const packetRef = result.outcome?.packetRef ?? "";
  const parsed = packetRef ? EscalationPacket.safeParse(await readRef(dir, packetRef)) : undefined;
  return { state: result.state, packetRef, triageCalls, packet: parsed?.success ? parsed.data : undefined };
}

const indent = (text: string, by: number) => text.split("\n").map((l) => `${" ".repeat(by)}${l}`).join("\n");

function printPacket(heading: string, r: Escalated): void {
  console.log(heading);
  console.log(`   Surface finished: ${r.state}; triage agent calls: ${r.triageCalls}; packet stored at: ${r.packetRef || "none"}`);
  if (!r.packet) {
    console.log("   NO ESCALATION PACKET WAS STORED\n");
    return;
  }
  const field = (label: string, text: string) => console.log(`   ${label}\n${indent(text, 6)}`);
  field("Decision:", r.packet.decision);
  field("Evidence:", r.packet.evidence);
  field("Already tried:", r.packet.dead_ends);
  field("Why now:", r.packet.why_now);
  field("Sessions to consult:", r.packet.references.join(", ") || "none");
  console.log("");
}

async function main(): Promise<void> {
  requireMock();

  // Each session re-reads the whole script, so expectations are routed by prompt
  // content: only triage's prompt has a Setback slot, so it is matched first.
  printPacket("1. The triage agent escalates", await escalateOne("triage-escalates", {
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "escalate", rationale: "A retry would repeat the same search; a person must decide.", payload: agentPacket } },
      { json: STUCK },
    ],
  }));

  printPacket("2. The worker hits an authority limit", await escalateOne("authority", {
    script: [
      { json: { status: "escalate", category: "authority", rationale: "Changing the greeting needs the translations service's deploy key, which I do not hold." } },
    ],
  }));

  // The lookup-table router alone decides this one: a packet does not depend on
  // which triage port a harness is wired with.
  printPacket("3. The correction budget runs out", await escalateOne("budget", {
    budgets: { correction: { used: 0, max: 1 } },
    triage: () => deterministicRouter,
    script: [
      { effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  }));

  printPacket("4. Triage replies with something unusable", await escalateOne("unusable-triage", {
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "completed", rationale: "Looks fine to me." } },
      { json: STUCK },
    ],
  }));

  printPacket("5. A failed close answered with \"retry the worker\"", await escalateOne("failed-close", {
    budgets: { close: { used: 0, max: 1 } },
    closer: refusingCloser,
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "reroute", rationale: "Retry the worker.", payload: brief } },
      { json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  }));

  console.log("6. What this shows");
  console.log(
    "   Every escalation, whatever caused it, stored a packet that opens with a decision for\n" +
      "   a person, then the verbatim evidence, what was already tried, why it escalated now,\n" +
      "   and the sessions to consult. The triage agent wrote the first; the harness built the\n" +
      "   other four from the case file, without asking any agent to write them. The budget\n" +
      "   case says no budget remains. The failed close was not retried as a worker, because\n" +
      "   \"retry the worker\" is not allowed after a close failure.\n" +
      "   Note: claude-mock does not enforce a role's tool list; triage's read-only authority\n" +
      "   is proven by unit tests and, live, by the real agent runtime.",
  );
}

await main();
