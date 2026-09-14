/**
 * UAT demo for Agent Mock Slice 3: Prove a Whole Pipeline Against a Scripted Agent.
 *
 * 1. Runs one surface, worker to gate to close, against the scripted agent: a
 *    real command gate judges the scripted change and the real merge-back
 *    closer lands it on main in a scratch repository.
 * 2. Prints the prompt the harness sent the worker, and the consumption check.
 * 3. Reruns with a script whose trigger phrase has a typo, and prints the
 *    consumption check's failure.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no other setup. No network, no API key.
 *
 * Usage: npm run demo:mock-slice-3
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { cleanGitEnv } from "../src/git-env.js";
import { initTempRepo } from "../src/temp-repo.js";
import { deterministicRouter } from "../src/router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { triageRoleConfig } from "../src/triage-role-config.js";
import { assertFullyConsumed, promptsSent, runSurfaceAgainstMock } from "../src/testing.js";
import type { JournalEvent, MockScript, ScriptedSurfaceResult } from "../src/testing.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 3 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const INTENT = "add a greeting file that says hello";

/** A worker that, when its prompt contains `phrase`, writes greeting.txt and reports completion. */
function scriptTriggeredBy(phrase: string): MockScript {
  return {
    expectations: [
      {
        when: { promptContains: phrase },
        effects: [{ write: { path: "greeting.txt", content: "hello\n" } }],
        json: { status: "completed", rationale: "wrote greeting.txt" },
      },
    ],
  };
}

async function runWith(name: string, script: MockScript): Promise<ScriptedSurfaceResult & { repoPath: string }> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `mock-pipeline-demo-${name}-`));
  const dir = path.join(scratch, "case");
  fs.mkdirSync(dir);
  const repoPath = initTempRepo(`mock-pipeline-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const ran = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: path.join(scratch, "wt") },
    header: { surfaceId: name, taskDef: { intent: INTENT }, gateRef, closerRef },
    budgets,
    roleConfigs: { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    triage: () => deterministicRouter,
    script,
  });
  return { ...ran, repoPath };
}

function onMain(repoPath: string, file: string): string {
  try {
    return execFileSync("git", ["show", `main:${file}`], { cwd: repoPath, encoding: "utf-8", env: cleanGitEnv(), stdio: "pipe" }).trim();
  } catch {
    return "(not on main)";
  }
}

const indent = (text: string) => text.split("\n").map((l) => `   ${l}`).join("\n");

function consumption(journal: JournalEvent[], script: MockScript): string {
  try {
    assertFullyConsumed(journal, script);
    return "Consumption check passed: every scripted expectation was used.";
  } catch (err) {
    return `Consumption check failed:\n${indent((err as Error).message)}`;
  }
}

async function main(): Promise<void> {
  console.log("=== Agent Mock Slice 3: a whole pipeline against a scripted agent ===\n");

  const script = scriptTriggeredBy("add a greeting file");
  console.log("--- 1. The script given to the agent, and how the surface closed ---");
  console.log(indent(JSON.stringify(script, null, 2)));
  const happy = await runWith("greeting", script);
  console.log(`Surface finished:     ${happy.result.state}`);
  console.log(`Closing report:       ${happy.result.outcome?.reason ?? "-"}`);
  console.log(`greeting.txt on main: ${onMain(happy.repoPath, "greeting.txt")}\n`);

  console.log("--- 2. What the harness sent the worker, and the consumption check ---");
  const [workerPrompt = ""] = promptsSent(happy.journal);
  const replyFormat = workerPrompt.indexOf("## Reply format");
  console.log(indent((replyFormat === -1 ? workerPrompt : workerPrompt.slice(0, replyFormat)).trimEnd()));
  console.log(`The task's wording reached the worker: ${workerPrompt.includes(INTENT) ? "yes" : "NO"}`);
  console.log(`${consumption(happy.journal, script)}\n`);

  console.log("--- 3. The same run with a typo in the trigger phrase ---");
  const typo = scriptTriggeredBy("add a greting file");
  console.log(`Trigger phrase: ${JSON.stringify(typo.expectations[0]?.when?.promptContains)}`);
  const broken = await runWith("greeting-typo", typo);
  console.log(`Surface finished:     ${broken.result.state}`);
  console.log(`greeting.txt on main: ${onMain(broken.repoPath, "greeting.txt")}`);
  console.log(consumption(broken.journal, typo));
}

await main();
