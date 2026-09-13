/**
 * UAT demo for Close Interface Slice 3: A Close That Cannot Complete Is
 * Retried, Then Handed to a Person With the Reason.
 *
 * Accepts a surface with the merge-back closer, then commits to main in the
 * same scratch repository before the close runs, so the accepted work can no
 * longer fast-forward. Prints each close attempt, the escalation packet, and
 * the repository afterwards.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip. Triage
 * is the built-in deterministic router, so no agent is involved.
 *
 * Usage: npm run demo:close-slice-3
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, readRef } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { cleanGitEnv } from "../src/git-env.js";
import { advance, run, type AdvanceResult } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { deterministicRouter } from "../src/router.js";
import { EscalationPacket } from "../src/triage-role-config.js";
import type { AgentContext, AgentPort, RoleHandle, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const closerRef: CloserRef = { type: "merge-back" };
const BRANCH = "surface/surface-61";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** Stands in for a worker that finishes the job. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 3: a close that cannot complete ===\n");
  console.log(`The project names its closer as data: closerRef = ${JSON.stringify(closerRef)}`);
  console.log("Triage is the built-in deterministic router: it retries a failed close while the");
  console.log(`close budget remains (${budgets.close.max} retries), then escalates. Everything happens in a`);
  console.log("scratch repository on this machine; nothing is pushed.\n");

  const repo = initTempRepo("close3-demo-repo-", { "report.tap": PASSING_TAP });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close3-demo-case-"));
  const location: SurfaceLocation = {
    repoPath: repo,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close3-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId: "surface-61", taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  const ports: SurfacePorts = { agent: workingAgent, triage: deterministicRouter, closer: resolveCloser(pinned) };

  // --- Accept the work, stopping just before the close ---
  let step: AdvanceResult;
  do {
    step = await advance(dir, location, ports);
  } while (step.state !== "CLOSING" && !step.done);
  if (step.state !== "CLOSING") throw new Error(`expected the work to be accepted, reached ${step.state}`);

  fs.writeFileSync(path.join(repo, "hotfix.txt"), "a change someone else landed on main\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "Someone else's hotfix"]);
  const movedTip = git(repo, ["rev-parse", "--short", "main"]);

  console.log("--- 1. The work is accepted, then main moves on ---");
  console.log(`The gate accepted the worker's change on ${BRANCH}.`);
  console.log(`Before the close runs, this demo commits a hotfix to main, which is now at ${movedTip}.`);
  console.log(`${BRANCH} does not contain it, so main can no longer be fast-forwarded onto the work.\n`);

  const result = await run(dir, location, ports);
  const caseFile = await load(dir);

  console.log("--- 2. Each close attempt, and what triage did about it ---");
  let attempt = 0;
  for (const entry of caseFile.history) {
    if (entry.t === "close") {
      attempt += 1;
      const report = (await readRef(dir, entry.detailRef)) as { detail?: string };
      console.log(`Close attempt ${attempt}: ${entry.status}: ${report.detail ?? "(no detail)"}`);
    } else if (entry.t === "triage") {
      console.log(`  Triage: ${entry.verdict} (${entry.rationale})`);
    }
  }
  const dispatches = caseFile.history.filter((e) => e.t === "dispatch").length;
  console.log(`\nWorker sessions dispatched in total: ${dispatches} (the accepted work was never sent back).\n`);

  console.log("--- 3. The escalation packet ---");
  console.log(`The surface ran to: ${result.state}`);
  const packet = EscalationPacket.parse(await readRef(dir, caseFile.outcome?.packetRef ?? ""));
  console.log(`Decision:\n  ${packet.decision}`);
  console.log(`Evidence:\n  ${packet.evidence}`);
  console.log(`Already tried:\n  ${packet.dead_ends.split("\n").join("\n  ")}`);
  console.log(`Why now:\n  ${packet.why_now}`);
  console.log(`Sessions to consult: ${packet.references.join(", ")}\n`);

  console.log("--- 4. The repository afterwards ---");
  console.log(`main history:\n  ${git(repo, ["log", "--oneline", "main"]).split("\n").join("\n  ")}`);
  console.log(`main is still at ${git(repo, ["rev-parse", "--short", "main"])}, the hotfix: the harness added nothing to it.`);
  console.log(`Branches now: ${git(repo, ["branch", "--format=%(refname:short)"]).split("\n").join(" | ")}`);
  console.log(`The accepted work, still on ${BRANCH}: ${git(repo, ["log", "--oneline", `main..${BRANCH}`])}`);
  console.log(`Scratch worktree still on disk: ${fs.existsSync(location.worktreePath)} (tidied up on escalation; the branch is kept).`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
