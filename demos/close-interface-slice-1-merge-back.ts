/**
 * UAT demo for Close Interface Slice 1: Accepted Work Is Merged Into the Base
 * Branch.
 *
 * Creates a scratch git repository, starts a surface in its own worktree,
 * writes a change into that worktree as a stand-in worker, and accepts it with
 * the merge-back closer selected by name. Then replays the close as if the
 * process had crashed immediately after the merge.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip.
 *
 * Usage: npx tsx demos/close-interface-slice-1-merge-back.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { cleanGitEnv } from "../src/git-env.js";
import { run } from "../src/surface.js";
import { provisionWorktree } from "../src/provision.js";
import { resolveCloser } from "../src/resolve-closer.js";
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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** Stands in for a worker: writes the change the project asked for. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("no setback is expected in this demo")),
};

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 1: accepted work merged into the base branch ===\n");
  console.log("The project names its closer as data — no closer code is written here:");
  console.log(`  closerRef = ${JSON.stringify(closerRef)}\n`);
  console.log("The merge lands on the LOCAL base branch in this scratch repository.");
  console.log("Nothing is pushed anywhere: no remote is involved at any point.\n");

  const repo = initTempRepo("close-demo-repo-", { "report.tap": PASSING_TAP });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close-demo-case-"));
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close-demo-tree-")), "wt");
  const location: SurfaceLocation = { repoPath: repo, worktreePath };

  await create(dir, { surfaceId: "surface-42", taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);

  // The closer is pinned in the header at create, then resolved from what is on
  // disk — so changing the project's configuration now cannot redirect this
  // surface to a different closer, however long it sits before it closes.
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  console.log(`Closer pinned in the case file header: ${JSON.stringify(pinned)}`);
  console.log("The closer below is resolved from the pinned header, not from configuration.\n");

  const ports: SurfacePorts = {
    agent: workingAgent,
    triage: unusedTriage,
    closer: resolveCloser(pinned, repo),
  };
  const result = await run(dir, location, ports);

  const caseFile = await load(dir);
  const closeEntry = caseFile.history.filter((e) => e.t === "close").at(-1);
  console.log(`--- 1. The surface ran to ${result.state} ---`);
  console.log(`Base branch pinned at provisioning: ${caseFile.header.baseBranch}`);
  console.log(`Close report status:                ${closeEntry?.status}`);
  console.log(`Closing report: ${caseFile.outcome?.reason}\n`);

  console.log("--- 2. The repository afterwards ---");
  console.log(`main's history:   ${git(repo, ["log", "--oneline", "main"]).split("\n").join(" | ")}`);
  console.log(`feature.txt on main: ${git(repo, ["show", "main:feature.txt"])}`);
  console.log(`Surface branches left: ${git(repo, ["branch", "--list", "surface/*"]) || "(none)"}`);
  console.log(`Scratch worktree still on disk: ${fs.existsSync(worktreePath)}\n`);

  console.log("--- 3. Replaying the close, as if the process had crashed just after merging ---");
  // The crash window the UAT asks for: the merge landed, cleanup never ran. A
  // second surface, closed with the branch kept, leaves exactly that state
  // behind, so closing it again is the replay.
  console.log("A close that keeps its branch leaves exactly the crash state behind — merged,");
  console.log("but not cleaned up — so closing it a second time IS the replay.\n");
  const keepBranch: CloserRef = { type: "merge-back", deleteBranch: false };
  const secondTree = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close-demo-tree-")), "wt");
  const { baseBranch } = await provisionWorktree(dir, repo, secondTree, "surface-43");
  fs.writeFileSync(path.join(secondTree, "second.txt"), "more accepted work\n");
  const secondCtx = { dir, repoPath: repo, worktreePath: secondTree, branch: "surface/surface-43", baseBranch };

  const first = await resolveCloser(keepBranch, repo).close(secondCtx, { kind: "accepted" });
  console.log(`First close:  ${first.status} — ${first.detail}`);
  const commitsBefore = git(repo, ["rev-list", "--count", "main"]);

  const replay = await resolveCloser(keepBranch, repo).close(secondCtx, { kind: "accepted" });
  console.log(`Replayed:     ${replay.status} — ${replay.detail}`);
  console.log(`Commits on main before replay: ${commitsBefore}, after: ${git(repo, ["rev-list", "--count", "main"])}`);
  console.log(`main's history: ${git(repo, ["log", "--oneline", "main"]).split("\n").join(" | ")}\n`);

  console.log("--- 4. Replaying the first surface's close, after its cleanup had finished ---");
  const afterCleanup = await resolveCloser(closerRef, repo).close(
    {
      dir,
      repoPath: repo,
      worktreePath,
      branch: `surface/${caseFile.header.surfaceId}`,
      baseBranch: caseFile.header.baseBranch ?? "",
    },
    { kind: "accepted" },
  );
  console.log(`Replayed close status: ${afterCleanup.status}`);
  console.log(`Replayed close report: ${afterCleanup.detail}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
