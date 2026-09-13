/**
 * UAT demo for Close Interface Slice 2: Work Can Be Left on Its Own Branch, and
 * Stopped Surfaces Tidy Up.
 *
 * Closes one accepted surface with the commit-to-branch closer named as data,
 * then runs a second surface that escalates, showing that its scratch worktree
 * is removed while its branch is kept for whoever takes it over. Finally it
 * tears the same stopped surface down a second time, to show that a repeat is
 * harmless.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip.
 *
 * Usage: npx tsx demos/close-interface-slice-2-branch-and-teardown.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { cleanGitEnv } from "../src/git-env.js";
import { run } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { teardownWorktree } from "../src/closer-support.js";
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
const closerRef: CloserRef = { type: "commit-to-branch" };

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

/**
 * Stands in for a worker that cannot finish and hands the task back. It commits
 * what it managed, which is why the kept branch is worth anything: teardown
 * removes the scratch directory, so uncommitted work in it goes with it.
 */
const stuckAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "half-done.txt"), "as far as I got\n");
    git(ctx.worktreePath, ["add", "-A"]);
    git(ctx.worktreePath, ["commit", "-m", "as far as I got"]);
    return Promise.resolve({
      status: "escalate",
      category: "authority",
      rationale: "Finishing this needs the deploy key, which I do not hold.",
    });
  }) as AgentPort["invoke"],
};

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("no setback is expected in this demo")),
};

function newTree(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close2-demo-tree-")), "wt");
}

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 2: a branch per task, and stopped surfaces tidied up ===\n");
  console.log("The project names its closer as data — no closer code is written here:");
  console.log(`  closerRef = ${JSON.stringify(closerRef)}\n`);
  console.log("Everything happens in a scratch repository on this machine. No remote is involved");
  console.log("at any point: nothing is pushed and no base branch is merged.\n");

  const repo = initTempRepo("close2-demo-repo-", { "report.tap": PASSING_TAP });
  const mainTipBefore = git(repo, ["rev-parse", "--short", "main"]);

  // --- An accepted surface, closed onto its own branch ---
  const acceptedDir = fs.mkdtempSync(path.join(os.tmpdir(), "close2-demo-case-"));
  const acceptedTree = newTree();
  const acceptedLocation: SurfaceLocation = { repoPath: repo, worktreePath: acceptedTree };

  await create(
    acceptedDir,
    { surfaceId: "surface-51", taskDef: { goal: "add the feature" }, gateRef, closerRef },
    budgets,
  );
  const acceptedPinned = (await load(acceptedDir)).header.closerRef;
  if (!acceptedPinned) throw new Error("the closer reference was not pinned in the header");

  const acceptedResult = await run(acceptedDir, acceptedLocation, {
    agent: workingAgent,
    triage: unusedTriage,
    closer: resolveCloser(acceptedPinned, repo),
  });
  const acceptedCase = await load(acceptedDir);

  console.log("--- 1. The accepted surface's closing report ---");
  console.log(`Closer resolved from the pinned header: ${JSON.stringify(acceptedPinned)}`);
  console.log(`The surface ran to: ${acceptedResult.state}`);
  console.log(`Closing report: ${acceptedCase.outcome?.reason}\n`);

  console.log("--- 2. The repository after it ---");
  console.log(`Branches now:            ${git(repo, ["branch", "--format=%(refname:short)"]).split("\n").join(" | ")}`);
  console.log(`Work on surface/surface-51: ${git(repo, ["show", "surface/surface-51:feature.txt"])}`);
  console.log(`main was ${mainTipBefore}, and is now: ${git(repo, ["rev-parse", "--short", "main"])}`);
  console.log(`feature.txt on main: ${git(repo, ["ls-tree", "--name-only", "main", "feature.txt"]) || "(not there — main is untouched)"}`);
  console.log(`Scratch worktree still on disk: ${fs.existsSync(acceptedTree)}\n`);

  // --- A second surface, which escalates ---
  const stuckDir = fs.mkdtempSync(path.join(os.tmpdir(), "close2-demo-case-"));
  const stuckTree = newTree();
  const stuckLocation: SurfaceLocation = { repoPath: repo, worktreePath: stuckTree };

  await create(
    stuckDir,
    { surfaceId: "surface-52", taskDef: { goal: "add the other feature" }, gateRef, closerRef },
    budgets,
  );
  const stuckPinned = (await load(stuckDir)).header.closerRef;
  if (!stuckPinned) throw new Error("the closer reference was not pinned in the header");
  const stuckResult = await run(stuckDir, stuckLocation, {
    agent: stuckAgent,
    triage: unusedTriage,
    closer: resolveCloser(stuckPinned, repo),
  });
  const stuckCase = await load(stuckDir);

  console.log("--- 3. A second surface, which gives up ---");
  console.log(`The surface ran to: ${stuckResult.state}`);
  console.log(`Why: ${stuckCase.outcome?.reason}\n`);

  console.log("--- 4. What it left behind ---");
  console.log(`Its scratch worktree still on disk: ${fs.existsSync(stuckTree)}`);
  console.log(`Worktrees git knows about: ${git(repo, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).join(" | ")}`);
  console.log(`Branches now:              ${git(repo, ["branch", "--format=%(refname:short)"]).split("\n").join(" | ")}`);
  console.log(`Its half-finished work is still on surface/surface-52: ${git(repo, ["show", "surface/surface-52:half-done.txt"])}`);
  console.log("(Teardown removes the scratch directory and commits nothing, so the branch carries");
  console.log(" exactly what the worker committed before it gave up.)\n");

  console.log("--- 5. Tearing the same stopped surface down a second time ---");
  console.log("A teardown failure is only logged, never re-triaged, so a repeat is the only");
  console.log("thing that ever tries again — and it has to be harmless.\n");
  const stuckBranchTip = git(repo, ["rev-parse", "--short", "surface/surface-52"]);
  const repeat = await teardownWorktree(
    {
      dir: stuckDir,
      repoPath: repo,
      worktreePath: stuckTree,
      branch: "surface/surface-52",
      baseBranch: stuckCase.header.baseBranch ?? "",
    },
    { kind: "escalated" },
  );
  console.log(`Second teardown: ${repeat.status} — ${repeat.detail}`);
  console.log(`surface/surface-52 was ${stuckBranchTip}, and is now: ${git(repo, ["rev-parse", "--short", "surface/surface-52"])}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
