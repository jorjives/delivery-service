/**
 * UAT demo for Triage and Deterministic Router Slice 1: A Stuck Worker's Retry
 * Is Informed by Triage, Not Re-dispatched Blind.
 *
 * Runs a surface in which a scripted worker gives up as "stuck", a scripted
 * triage agent decides to retry with a sharpened brief, and a second worker is
 * dispatched; prints the triage request, the verdict and the second worker's
 * request. Then runs a plain gate failure and shows no triage agent was called.
 *
 * Runs against `claude-mock`, vendored in `vendor/claude-mock` and installed by
 * `npm install`: no other setup. No live API call is made, and no API key is
 * needed. `claude-mock` does not enforce a role's tool
 * list, so this demo shows nothing about triage's read-only authority; that is
 * proven by unit tests and, live, by the real agent runtime.
 *
 * Usage: npm run demo:triage-slice-1
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { advance, run } from "../src/surface.js";
import { create, load, readRef } from "../src/case-file.js";
import { createAgentPort } from "../src/agent-invoke.js";
import { createAgentTriage } from "../src/triage.js";
import { triageRoleConfig } from "../src/triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { initTempRepo } from "../src/temp-repo.js";
import { mockSessionEnvironment, promptsSent, readJournal } from "../src/testing.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, SurfaceLocation, SurfacePorts } from "../src/ports.js";
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

const brief = {
  problem: "The greeting endpoint returns 'hi'; the task asks for 'hello'.",
  dead_ends: "Attempt 1 searched the route handlers for the string and gave up: the text is not in any handler.",
  scope: "Change the greeting text only; leave routing and tests alone.",
  references: ["worker-1-0"],
  diagnosis: "The greeting is probably read from a translations file rather than written in code.",
};

/** A fresh case file and repo; the surface is provisioned by the first advance. */
async function surface(name: string): Promise<{ dir: string; location: SurfaceLocation; scratch: string }> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `triage-demo-${name}-`));
  const dir = fs.mkdtempSync(path.join(scratch, `${name}-case-`));
  await create(dir, { surfaceId: name, taskDef: { intent: "make the greeting say hello" }, gateRef }, budgets);
  const repoPath = initTempRepo(`triage-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  return { dir, location: { repoPath, worktreePath: fs.mkdtempSync(path.join(scratch, `${name}-tree-`)) }, scratch };
}

function mockSession(scratch: string, script: unknown[]) {
  const scriptPath = path.join(scratch, "mock.json");
  const journalPath = path.join(scratch, "journal.jsonl");
  fs.writeFileSync(scriptPath, JSON.stringify(script), "utf-8");
  return { journalPath, session: mockSessionEnvironment({ scriptPath, journalPath }) };
}

const indent = (text: string) => text.split("\n").map((l) => `   ${l}`).join("\n");

async function informedRetry(): Promise<void> {
  const { dir, location, scratch } = await surface("stuck-worker");
  // Each session re-reads the whole queue, so each expectation is routed by
  // what its prompt contains: only triage's prompt has a Setback slot, and only
  // the retried worker's prompt contains the brief's dead ends.
  const { session, journalPath } = mockSession(scratch, [
    { when: { promptContains: "## Setback" }, json: { status: "reroute", rationale: "A second attempt is worth it with a sharper brief.", payload: brief } },
    { when: { promptContains: brief.dead_ends }, json: { status: "completed", rationale: "Changed the greeting in the translations file." } },
    { when: { promptContains: "No distilled brief" }, json: { status: "escalate", category: "exhaustion", rationale: "I cannot find where the greeting text comes from." } },
  ]);
  const agent = createAgentPort(configs, session);
  const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };

  const result = await run(dir, location, ports);
  const [, triagePrompt = "", secondWorker = ""] = promptsSent(await readJournal(journalPath));
  const { history } = await load(dir);
  const triaged = history.find((e) => e.t === "triage");

  console.log("1. The stuck worker's setback");
  const stuck = history.find((e) => e.t === "terminus");
  console.log(`   Worker attempt 1 ended: ${stuck?.t === "terminus" ? `${stuck.status} (${stuck.category ?? "-"}): ${stuck.rationale}` : "-"}\n`);

  console.log("2. What triage was asked");
  console.log(indent(triagePrompt.slice(triagePrompt.indexOf("## Setback"), triagePrompt.indexOf("## Reply format")).trimEnd()));
  console.log("");

  console.log("3. Triage's verdict");
  console.log(`   Verdict:   ${triaged?.t === "triage" ? triaged.verdict : "-"}`);
  console.log(`   Rationale: ${triaged?.t === "triage" ? triaged.rationale : "-"}`);
  console.log(`   Stored at: ${triaged?.t === "triage" ? triaged.artifactRef : "-"}\n`);

  console.log("4. The second worker's request");
  console.log(indent(secondWorker.slice(secondWorker.indexOf("## Brief"), secondWorker.indexOf("## Reply format")).trimEnd()));
  console.log(`   Surface finished: ${result.state}\n`);
}

async function plainGateFailure(): Promise<void> {
  const { dir, location, scratch } = await surface("plain-gate-failure");
  const { session } = mockSession(scratch, [
    { when: { promptContains: "No distilled brief" }, effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "Changed the greeting." } },
    { json: { status: "completed", rationale: "Tried again." } },
  ]);
  const inner = createAgentPort(configs, session);
  let triageAgentCalls = 0;
  const counting: AgentPort = {
    invoke: (roleCfg, ctx) => {
      if (roleCfg.role === "triage") triageAgentCalls += 1;
      return inner.invoke(roleCfg, ctx);
    },
  };
  const ports: SurfacePorts = { agent: counting, triage: createAgentTriage(counting), closer: noopCloser };

  // Provision, baseline, worker, gate, triage, second worker.
  for (let i = 0; i < 6; i++) await advance(dir, location, ports);

  const { history } = await load(dir);
  const triaged = history.find((e) => e.t === "triage");
  const retry = history.filter((e) => e.t === "dispatch").at(-1);
  const ref = triaged?.t === "triage" ? await readRef(dir, triaged.artifactRef) : undefined;

  console.log("5. A plain gate failure");
  console.log("   Worker attempt 1 broke one assertion; 3 correction slots remained.");
  console.log(`   Verdict:              ${triaged?.t === "triage" ? `${triaged.verdict}: ${triaged.rationale}` : "-"}`);
  console.log(`   Triage agent calls:   ${triageAgentCalls}`);
  console.log(triageAgentCalls === 0 ? "   No triage agent was called: the deterministic router routed it." : "   A TRIAGE AGENT WAS CALLED");
  console.log(`   Brief stored:         ${ref && typeof ref === "object" && "artifact" in ref ? "yes" : "no"}`);
  console.log(`   Retry dispatch brief: ${retry?.t === "dispatch" && retry.briefRef ? retry.briefRef : "none"}\n`);
}

async function main(): Promise<void> {
  await informedRetry();
  await plainGateFailure();
  console.log("6. What this shows");
  console.log(
    "   A worker that gave up was judged by a read-only triage agent, whose brief reached\n" +
      "   the second worker as a Brief section, with the diagnosis labelled a hypothesis,\n" +
      "   separate from the verbatim Gate evidence. A plain gate failure with budget to spare\n" +
      "   was routed by the lookup table with no agent call and no brief.\n" +
      "   Note: claude-mock does not enforce a role's tool list; triage's read-only authority\n" +
      "   is proven by unit tests and, live, by the real agent runtime.",
  );
}

await main();
