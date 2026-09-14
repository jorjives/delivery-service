/**
 * UAT demo for Agent Mock Slice 4: Prove the Pipeline Copes When the Agent Misbehaves.
 *
 * Runs one surface per misbehaviour against the scripted agent, each in its own
 * scratch repository with a real command gate and the real merge-back closer:
 *
 * 1-4. The worker replies badly: a prompt no expectation matches, a reply with
 *      no envelope, an envelope in the wrong shape, a scripted failure. Each
 *      attempt ends incomplete with a plain-English reason, is retried within
 *      the terminus budget, and the surface then escalates. Section 3 also
 *      shows expectEnvelope rejecting a malformed envelope as it is written.
 * 5.   The worker escalates for authority: the surface escalates at once.
 * 6.   The worker's first change fails the gate: it is routed back for another
 *      attempt, and only the passing attempt lands.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no other setup. No network, no API key.
 *
 * Usage: npm run demo:mock-slice-4
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { load } from "../src/case-file.js";
import { cleanGitEnv } from "../src/git-env.js";
import { initTempRepo } from "../src/temp-repo.js";
import { deterministicRouter } from "../src/router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { triageRoleConfig } from "../src/triage-role-config.js";
import { expectEnvelope, promptsSent, runSurfaceAgainstMock } from "../src/testing.js";
import type { MockScript } from "../src/testing.js";
import type { BudgetSet, CloserRef, GateRef, HistoryEntry } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 2 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 2 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const INTENT = "add a greeting file that says hello";

const indent = (text: string) => text.split("\n").map((l) => `   ${l}`).join("\n");

/** The steps a reader follows: what each session ended with, and what the gate, triage and closer did. */
function describeStep(entry: HistoryEntry): string[] {
  switch (entry.t) {
    case "terminus":
      return [`${entry.role ?? "worker"} attempt ${entry.attempt} (${entry.sessionKey}): ${entry.status}: ${entry.rationale}`];
    case "gate":
      return [`gate on attempt ${entry.attempt}: ${entry.status}`];
    case "triage":
      return [`triage after attempt ${entry.afterAttempt}: ${entry.verdict} (${entry.rationale})`];
    case "close":
      return [`closer: ${entry.status}`];
    default:
      return [];
  }
}

function onMain(repoPath: string, file: string): string {
  try {
    return execFileSync("git", ["show", `main:${file}`], { cwd: repoPath, encoding: "utf-8", env: cleanGitEnv(), stdio: "pipe" }).trim();
  } catch {
    return "(not on main)";
  }
}

/** Print the script, run one surface with it, then print what the surface recorded and how it finished. */
async function show(name: string, script: MockScript) {
  console.log("Script given to the agent:");
  console.log(indent(JSON.stringify(script, null, 2)));

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `mock-misbehaving-demo-${name}-`));
  const dir = path.join(scratch, "case");
  fs.mkdirSync(dir);
  const repoPath = initTempRepo(`mock-misbehaving-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const { result, journal } = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: path.join(scratch, "wt") },
    header: { surfaceId: name, taskDef: { intent: INTENT }, gateRef, closerRef },
    budgets,
    roleConfigs: { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    triage: () => deterministicRouter,
    script,
  });
  const { history } = await load(dir);

  console.log("What the surface recorded:");
  console.log(indent(history.flatMap(describeStep).join("\n")));
  console.log(`Surface finished: ${result.state}`);
  console.log(`Outcome:          ${result.outcome?.reason ?? "-"}`);
  return { journal, repoPath };
}

async function main(): Promise<void> {
  console.log("=== Agent Mock Slice 4: a pipeline against a misbehaving scripted agent ===\n");

  console.log("--- 1. No expectation matches the prompt ---");
  const noMatch = await show("no-match", {
    expectations: [{ when: { promptContains: "a phrase the harness never sends" }, json: { status: "completed", rationale: "never reached" } }],
  });
  console.log(`Prompts the journal shows matched no expectation: ${noMatch.journal.filter((e) => e.event === "unmatched").length}\n`);

  console.log("--- 2. A reply with no envelope ---");
  await show("no-envelope", { expectations: [{ reply: "I looked around but never reported back." }] });
  console.log("");

  console.log("--- 3. An envelope in the wrong shape for the worker ---");
  console.log("A triage verdict, written straight into json to script a malformed reply on purpose:");
  await show("wrong-shape", { expectations: [{ json: { status: "reroute", rationale: "someone else should take this" } }] });
  console.log("A slip the compiler cannot see, an empty rationale, caught by expectEnvelope as the script is written:");
  try {
    expectEnvelope(workerRoleConfig, { status: "completed", rationale: "" });
    console.log(indent("accepted"));
  } catch (err) {
    console.log(indent((err as Error).message));
  }
  console.log("");

  console.log("--- 4. A scripted failure ---");
  await show("scripted-failure", { expectations: [{ fail: { message: "the session crashed part way through" } }] });
  console.log("");

  console.log("--- 5. The worker escalates for authority ---");
  const authority = await show("authority", {
    expectations: [
      {
        json: expectEnvelope(workerRoleConfig, {
          status: "escalate",
          category: "authority",
          rationale: "deploying needs a production credential this worker was not given",
        }),
      },
    ],
  });
  console.log(`Worker sessions run: ${promptsSent(authority.journal).length}\n`);

  console.log("--- 6. The worker's change fails the gate ---");
  const retried = await show("gate-fail", {
    expectations: [
      // Each session re-reads the script and takes the first expectation that matches,
      // so the retry's expectation, keyed on the failure the gate reported, comes first.
      {
        when: { promptContains: "2 - beta (PASS -> FAIL)" },
        effects: [{ write: { path: "report.tap", content: PASSING_TAP } }, { write: { path: "greeting.txt", content: "hello\n" } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "restored the beta check and wrote greeting.txt" }),
      },
      {
        when: { promptContains: INTENT },
        effects: [{ write: { path: "report.tap", content: FAILING_TAP } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "wrote the greeting, breaking the beta check" }),
      },
    ],
  });
  const landedReport = onMain(retried.repoPath, "report.tap");
  console.log(`report.tap on main:   ${landedReport === PASSING_TAP.trim() ? "passing: the rejected change never landed" : landedReport}`);
  console.log(`greeting.txt on main: ${onMain(retried.repoPath, "greeting.txt")}`);
}

await main();
