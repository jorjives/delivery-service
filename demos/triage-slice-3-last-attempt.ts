/**
 * UAT demo for Triage and Deterministic Router Slice 3: Triage Judges the Last
 * Attempt and Rechecks Broken Gates for Free.
 *
 * Four surfaces:
 *   1. A worker whose change keeps failing the gate, down to its last
 *      correction slot, where the triage agent chooses one more retry.
 *   2. The same, where the triage agent chooses to escalate instead.
 *   3. A gate that errors once and passes on its free recheck.
 *   4. A gate that keeps erroring: rechecked, then triage sends a repair
 *      session that receives its brief.
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed. `claude-mock` does not enforce a role's tool
 * list, so this demo shows nothing about triage's read-only authority.
 *
 * Usage: npm run demo:triage-slice-3
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../src/surface.js";
import { create, load, readRef } from "../src/case-file.js";
import { createAgentPort } from "../src/agent-invoke.js";
import { createAgentTriage } from "../src/triage.js";
import { triageRoleConfig, EscalationPacket } from "../src/triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { SETBACK_LABELS } from "../src/escalation-packet.js";
import { initTempRepo } from "../src/temp-repo.js";
import { isOnPath } from "../src/on-path.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, TriageInput } from "../src/ports.js";
import type { BudgetSet, GateRef, HistoryEntry } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
/** Errors on the first check after the worker drops a `.flaky` marker, then reads report.tap as usual. */
const flakyGate: GateRef = { type: "command", command: "if [ -f .flaky ]; then rm .flaky; else cat report.tap; fi", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

const brief = {
  problem: "Beta still fails: the greeting says hi.",
  dead_ends: "Attempts 1 and 2 both edited the template; the greeting comes from translations.json.",
  scope: "Change translations.json only.",
  references: ["worker-1-0", "worker-2-0"],
  diagnosis: "The template reads its greeting from translations.json.",
};

const packet = {
  decision: "Two attempts have regressed the same assertion in the same way. Decide whether to amend the task or take it on yourself.",
  evidence: "2: not ok 2 - beta",
  dead_ends: "Attempts 1 and 2 both edited the template and broke beta.",
  why_now: "One correction slot is left, and nothing suggests a third attempt would try anything new.",
  references: ["worker-1-0", "worker-2-0"],
};

const repairBrief = {
  problem: "The gate cannot run: report.tap is empty, so there is no test output to read.",
  dead_ends: "A free recheck found the report still empty; nothing has been repaired yet.",
  scope: "Regenerate report.tap. Never edit the checks themselves.",
  references: ["worker-1-0"],
  diagnosis: "The worker's change truncated the generated report.",
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

interface Scenario {
  script: unknown[];
  budgets?: Partial<BudgetSet>;
  gateRef?: GateRef;
}

interface Ran {
  state: string;
  history: HistoryEntry[];
  /** The session keys of the triage rounds the agent was actually asked about. */
  agentRounds: Set<string>;
  /** Every prompt the mock matched, in order. */
  prompts: string[];
  packet?: EscalationPacket;
}

function sentPrompts(journal: string): string[] {
  if (!fs.existsSync(journal)) return [];
  return fs.readFileSync(journal, "utf-8").split("\n").filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { event: string; prompt?: string })
    .filter((e) => e.event === "matched").map((e) => e.prompt ?? "");
}

/** Run one surface to its end with the agent-backed triage port, and record who decided each round. */
async function runSurface(name: string, scenario: Scenario): Promise<Ran> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `triage-demo-${name}-`));
  const dir = path.join(scratch, "case");
  fs.mkdirSync(dir);
  await create(
    dir,
    { surfaceId: name, taskDef: { intent: "make the greeting say hello" }, gateRef: scenario.gateRef ?? gateRef },
    { ...budgets, ...scenario.budgets },
  );
  const repoPath = initTempRepo(`triage-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const location = { repoPath, worktreePath: path.join(scratch, "wt") };

  const scriptPath = path.join(scratch, "mock.json");
  const journal = path.join(scratch, "journal.jsonl");
  fs.writeFileSync(scriptPath, JSON.stringify(scenario.script), "utf-8");
  const inner = createAgentPort(configs, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journal },
  });
  const agentRounds = new Set<string>();
  const agent: AgentPort = {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "triage") agentRounds.add(ctx.sessionKey);
      return inner.invoke(roleCfg, ctx);
    },
  };

  const result = await run(dir, location, { agent, triage: createAgentTriage(agent), closer: noopCloser });
  const { history } = await load(dir);
  const packetRef = result.outcome?.packetRef;
  const parsed = packetRef ? EscalationPacket.safeParse(await readRef(dir, packetRef)) : undefined;
  return {
    state: result.state,
    history,
    agentRounds,
    prompts: sentPrompts(journal),
    ...(parsed?.success ? { packet: parsed.data } : {}),
  };
}

const indent = (text: string, by: number) => text.split("\n").map((l) => `${" ".repeat(by)}${l}`).join("\n");

function printRounds(r: Ran): void {
  const rounds = r.history.flatMap((e) => (e.t === "triage" ? [e] : []));
  if (rounds.length === 0) console.log("   No triage round was needed.");
  rounds.forEach((e, i) => {
    const by = r.agentRounds.has(`triage-${i}`) ? "the triage agent decided" : "the lookup table decided, no agent call";
    const setback = SETBACK_LABELS[e.trigger as TriageInput["trigger"]];
    console.log(`   Round ${i + 1}: after ${setback} -> ${e.verdict} (${by})`);
  });
}

function printCounts(r: Ran): void {
  const sessions = (role: "worker" | "gate-maintenance") =>
    r.history.filter((e) => e.t === "dispatch" && (e.role ?? "worker") === role).length;
  const gates = r.history.flatMap((e) => (e.t === "gate" ? [e.status] : []));
  console.log(`   Gate runs: ${gates.join(", ")}`);
  console.log(`   Worker sessions: ${sessions("worker")}; repair sessions: ${sessions("gate-maintenance")}; triage agent calls: ${r.agentRounds.size}`);
  console.log(`   Surface finished: ${r.state}\n`);
}

async function main(): Promise<void> {
  requireMock();

  // Each session re-reads the whole script, so expectations are routed by prompt
  // content. Only triage's prompt has a Setback slot, so it is matched first;
  // only a briefed session's prompt contains that brief's dead ends.
  const lastSlot = (triageReply: unknown): Scenario => ({
    budgets: { correction: { used: 0, max: 2 } },
    script: [
      { when: { promptContains: "## Setback" }, json: triageReply },
      { when: { promptContains: brief.dead_ends }, effects: [{ write: { path: "report.tap", content: PASSING_TAP } }], json: { status: "completed", rationale: "Changed the greeting in translations.json." } },
      { effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "Changed the greeting template." } },
    ],
  });

  console.log("1. The last correction slot: the triage agent chooses one more retry");
  console.log("   (correction budget 2: the first failure has two slots left, the second has one)");
  const retried = await runSurface("last-slot-retry", lastSlot({
    status: "reroute", rationale: "One slot left, and the brief names a fix neither attempt tried.", payload: brief,
  }));
  printRounds(retried);
  printCounts(retried);

  console.log("2. The last correction slot: the triage agent chooses to escalate");
  const escalated = await runSurface("last-slot-escalate", lastSlot({
    status: "escalate", rationale: "A third attempt would repeat the first two.", payload: packet,
  }));
  printRounds(escalated);
  console.log(`   Decision put to a person:\n${indent(escalated.packet?.decision ?? "NO ESCALATION PACKET WAS STORED", 6)}`);
  printCounts(escalated);

  console.log("3. A gate that errors once, then passes on its free recheck");
  const flaky = await runSurface("flaky-gate", {
    gateRef: flakyGate,
    script: [
      { effects: [{ write: { path: ".flaky", content: "" } }], json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  });
  printRounds(flaky);
  printCounts(flaky);

  console.log("4. A gate that keeps erroring: rechecked, then repaired with triage's brief");
  console.log("   (gate recheck budget 1: one free recheck, then triage decides on a repair)");
  const broken = await runSurface("broken-gate", {
    budgets: { gateError: { used: 0, max: 1 } },
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "fix_the_gate", rationale: "The report is gone; a repair can regenerate it.", payload: repairBrief } },
      { when: { promptContains: repairBrief.dead_ends }, effects: [{ write: { path: "report.tap", content: PASSING_TAP } }], json: { status: "completed", rationale: "Regenerated report.tap." } },
      { effects: [{ write: { path: "report.tap", content: "" } }], json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  });
  printRounds(broken);
  const repairPrompt = broken.prompts.find((p) => p.includes(repairBrief.dead_ends)) ?? "";
  const briefSlot = repairPrompt.slice(repairPrompt.indexOf("## Brief"), repairPrompt.indexOf("## Gate evidence")).trim();
  console.log(`   The repair session's Brief:\n${indent(briefSlot || "THE REPAIR SESSION RECEIVED NO BRIEF", 6)}`);
  printCounts(broken);

  console.log("5. What this shows");
  console.log(
    "   Triage was asked only where its answer could change the outcome: on the last\n" +
      "   correction slot, where it chose once to retry with a brief and once to escalate,\n" +
      "   and on a gate error once its free recheck was spent. Every earlier round was\n" +
      "   settled by the lookup table with no agent call. The flaky gate recovered on its\n" +
      "   free recheck with no agent and no repair session. The broken gate's repair\n" +
      "   session received triage's brief.\n" +
      "   Note: claude-mock does not enforce a role's tool list; triage's read-only authority\n" +
      "   is proven by unit tests and, live, by the real agent runtime.",
  );
}

await main();
