/**
 * UAT demo for Close Interface Slice 4: An Extender Writes Their Own Closer
 * From the Guide.
 *
 * Writes a small example closer into a scratch repository, references it by
 * module path, and runs a surface that closes with it. Then swaps in a
 * deliberately broken closer and shows the failure reaching close-triage as a
 * report, not a crash.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip. Triage
 * is the built-in deterministic router, so no agent is involved.
 *
 * Usage: npm run demo:close-slice-4
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create, load, readRef } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance, run, type AdvanceResult } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { deterministicRouter } from "../src/router.js";
import { EscalationPacket } from "../src/triage-role-config.js";
import type { AgentContext, AgentPort, CloseContext, RoleHandle, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 1 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..1\nok 1 - feature\n";

const EXAMPLE_CLOSER = `// closers/announce.mjs: says what it would do, and does nothing.
export default {
  async close(ctx, outcome) {
    switch (outcome.kind) {
      case "accepted":
        return { status: "DONE", detail: "Example closer: would land " + ctx.branch + " on " + ctx.baseBranch + " and notify the team." };
      case "escalated":
        return { status: "DONE", detail: "Example closer: would keep " + ctx.branch + " for whoever takes over, and tidy the worktree." };
      case "aborted":
        return { status: "DONE", detail: "Example closer: would tidy the worktree; nothing is landed." };
    }
  },
};
`;

const BROKEN_CLOSER = `// closers/broken.mjs: fails the way real integrations do.
export default {
  async close() {
    throw new Error("the notification service is unreachable");
  },
};
`;

/** Stands in for a worker that finishes the job. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

async function surfaceWith(
  repo: string,
  surfaceId: string,
  closerRef: CloserRef,
): Promise<{ dir: string; location: SurfaceLocation; ports: SurfacePorts }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close4-demo-case-"));
  const location: SurfaceLocation = {
    repoPath: repo,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close4-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId, taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  return { dir, location, ports: { agent: workingAgent, triage: deterministicRouter, closer: resolveCloser(pinned, repo) } };
}

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 4: a project's own closer ===\n");

  const repo = initTempRepo("close4-demo-repo-", { "report.tap": PASSING_TAP });
  fs.mkdirSync(path.join(repo, "closers"));
  fs.writeFileSync(path.join(repo, "closers", "announce.mjs"), EXAMPLE_CLOSER);
  fs.writeFileSync(path.join(repo, "closers", "broken.mjs"), BROKEN_CLOSER);

  // --- 1 ---
  const exampleRef: CloserRef = { type: "custom", modulePath: "closers/announce.mjs" };
  console.log("--- 1. The example closer ---");
  console.log(`The project keeps its closer in its own repository and names it as data: closerRef = ${JSON.stringify(exampleRef)}`);
  console.log("The path is relative to the repository root, never the worktree the agent edits.\n");
  console.log(EXAMPLE_CLOSER);

  // --- 2 ---
  console.log("--- 2. An accepted surface closes using it ---");
  const accepted = await surfaceWith(repo, "surface-71", exampleRef);
  const result = await run(accepted.dir, accepted.location, accepted.ports);
  const acceptedCase = await load(accepted.dir);
  console.log(`The surface ran to: ${result.state}`);
  console.log(`Closing report: ${acceptedCase.outcome?.reason ?? "(none)"}\n`);

  console.log("The same closer, asked about the other two outcomes:");
  const ctx: CloseContext = {
    worktreePath: accepted.location.worktreePath,
    dir: accepted.dir,
    repoPath: repo,
    branch: "surface/surface-71",
    baseBranch: "main",
  };
  for (const kind of ["escalated", "aborted"] as const) {
    const report = await accepted.ports.closer.close(ctx, { kind });
    console.log(`  ${kind}: ${report.status}: ${report.detail}`);
  }
  console.log("");

  // --- 3 ---
  const brokenRef: CloserRef = { type: "custom", modulePath: "closers/broken.mjs" };
  console.log("--- 3. A deliberately broken closer ---");
  console.log(`A second surface names a closer that throws: closerRef = ${JSON.stringify(brokenRef)}\n`);
  const broken = await surfaceWith(repo, "surface-72", brokenRef);
  let step: AdvanceResult;
  do {
    step = await advance(broken.dir, broken.location, broken.ports);
  } while (step.state !== "CLOSING" && !step.done);
  if (step.state !== "CLOSING") throw new Error(`expected the work to be accepted, reached ${step.state}`);
  step = await advance(broken.dir, broken.location, broken.ports);
  const closeEntry = (await load(broken.dir)).history.find((e) => e.t === "close");
  const report = closeEntry?.t === "close" ? ((await readRef(broken.dir, closeEntry.detailRef)) as { detail?: string }) : {};
  console.log(`Close report: ${closeEntry?.t === "close" ? closeEntry.status : "(none)"}: ${report.detail ?? "(no detail)"}`);
  console.log(`The surface moved to: ${step.state} (close-triage), and nothing crashed.\n`);

  // --- 4 ---
  console.log("--- 4. What happens next ---");
  const final = await run(broken.dir, broken.location, broken.ports);
  const brokenCase = await load(broken.dir);
  console.log(`Triage retried the close while the close budget allowed (${budgets.close.max} retry), then the surface ran to: ${final.state}`);
  const packet = EscalationPacket.parse(await readRef(broken.dir, brokenCase.outcome?.packetRef ?? ""));
  console.log(`Decision:\n  ${packet.decision}`);
  console.log(`Evidence:\n  ${packet.evidence}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
