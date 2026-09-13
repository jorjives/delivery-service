/**
 * UAT demo for Close Interface Slice 5: Accepted Work Opens a Pull Request.
 *
 * Accepts a surface with the open-pr closer named as data, prints its closing
 * report, closes it again to show the open pull request is reused, then runs a
 * second surface while the gh stand-in behaves as if GitHub sign-in has expired.
 *
 * Needs only `git` and `node`: a stand-in executable named gh is put first on
 * PATH, and origin is a bare repository on this machine, so there is no network
 * and no GitHub account involved.
 *
 * Usage: npm run demo:close-slice-5
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, readRef } from "../src/case-file.js";
import { addLocalOrigin, initTempRepo } from "../src/temp-repo.js";
import { createGhStandIn } from "../src/gh-stand-in.js";
import { cleanGitEnv } from "../src/git-env.js";
import { run } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { branchName } from "../src/provision.js";
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
const closerRef: CloserRef = { type: "open-pr" };

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

async function startSurface(repo: string, surfaceId: string): Promise<{ dir: string; location: SurfaceLocation; ports: SurfacePorts }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close5-demo-case-"));
  const location: SurfaceLocation = {
    repoPath: repo,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close5-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId, taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  return { dir, location, ports: { agent: workingAgent, triage: deterministicRouter, closer: resolveCloser(pinned, repo) } };
}

async function main(): Promise<void> {
  const standIn = createGhStandIn();
  process.env.PATH = `${standIn.binDir}${path.delimiter}${process.env.PATH ?? ""}`;

  console.log("=== Close Interface Slice 5: accepted work opens a pull request ===\n");
  console.log(`The project names its closer as data: closerRef = ${JSON.stringify(closerRef)}\n`);
  console.log("This demo uses no network and no GitHub account. A stand-in executable named gh is put");
  console.log(`first on PATH (${standIn.command}), in place of the real GitHub command-line tool,`);
  console.log("and origin is a bare repository on this machine. A real project that selects this");
  console.log("closer needs gh installed and signed in (gh auth login); no other project does.\n");

  const repo = initTempRepo("close5-demo-repo-", { "report.tap": PASSING_TAP });
  const origin = addLocalOrigin(repo);

  // --- An accepted surface ---
  const first = await startSurface(repo, "surface-81");
  const firstResult = await run(first.dir, first.location, first.ports);
  const firstCase = await load(first.dir);
  const branch = branchName("surface-81");

  console.log("--- 1. The accepted surface's closing report ---");
  console.log(`The surface ran to: ${firstResult.state}`);
  console.log(`Closing report: ${firstCase.outcome?.reason}\n`);

  console.log("--- 2. What arrived ---");
  console.log(`${branch} on origin holds: ${git(origin, ["show", `${branch}:feature.txt`])}`);
  for (const pr of standIn.pullRequests()) {
    console.log(`Pull request ${pr.url}: ${pr.head} into ${pr.base}, titled "${pr.title}"`);
  }
  console.log(`Worktree still on disk, for follow-up commits: ${fs.existsSync(first.location.worktreePath)}\n`);

  // --- The same close, repeated ---
  const repeat = await first.ports.closer.close(
    {
      worktreePath: first.location.worktreePath,
      dir: first.dir,
      repoPath: repo,
      branch,
      baseBranch: firstCase.header.baseBranch ?? "",
    },
    { kind: "accepted" },
  );

  console.log("--- 3. Closing the same surface again ---");
  console.log(`Repeat close: ${repeat.status}: ${repeat.detail}`);
  console.log(`Pull requests the stand-in now holds: ${standIn.pullRequests().length}\n`);

  // --- A second surface, while GitHub sign-in has expired ---
  standIn.setMode("expired");
  const second = await startSurface(repo, "surface-82");
  const secondResult = await run(second.dir, second.location, second.ports);
  const secondCase = await load(second.dir);

  console.log("--- 4. A second surface, after GitHub sign-in has expired ---");
  console.log("The stand-in now answers every call the way gh does when its sign-in has expired.");
  let attempt = 0;
  for (const entry of secondCase.history) {
    if (entry.t === "close") {
      attempt += 1;
      const report = (await readRef(second.dir, entry.detailRef)) as { detail?: string };
      console.log(`Close attempt ${attempt}: ${entry.status}: ${report.detail ?? "(no detail)"}`);
    } else if (entry.t === "triage") {
      console.log(`  Triage: ${entry.verdict} (${entry.rationale})`);
    }
  }
  console.log(`The surface ran to: ${secondResult.state}`);
  const packet = EscalationPacket.parse(await readRef(second.dir, secondCase.outcome?.packetRef ?? ""));
  console.log(`Escalation evidence: ${packet.evidence}`);
  console.log(`Pull requests the stand-in holds: ${standIn.pullRequests().length} (none opened for surface-82)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
