/**
 * UAT demo for Single-Surface State Machine Slice 1: Provision a Surface and
 * Reach Its First Decision Point.
 *
 * Points the driver at a fresh case file directory and a real temporary git
 * repository four times: a project whose gate passes cleanly, one whose gate is
 * broken until a scripted repair agent fixes it, one whose repair agent never
 * fixes it, and one with an unusable worktree path.
 *
 * Usage: npx tsx demos/single-surface-slice-1-provisioning.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance } from "../src/surface.js";
import { noopCloser } from "../src/ports.js";
import type { AgentContext, AgentPort, RoleHandle, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate is a plain shell command over the project's TAP output, so "the gate
// itself cannot run" is just a missing report file.
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("triage is not reachable in slice 1")),
};

/** Never called: this project's gate runs fine. */
const idleAgent: AgentPort = {
  invoke: () => Promise.reject(new Error("no repair should be dispatched")),
};

/** Writes the missing report file, so the next baseline succeeds. */
const repairingAgent: AgentPort = {
  invoke: ((_roleCfg: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "report.tap"), PASSING_TAP);
    return Promise.resolve({ status: "completed", rationale: "restored the missing report.tap" });
  }) as AgentPort["invoke"],
};

/** Claims success every time but never actually fixes anything. */
const uselessAgent: AgentPort = {
  invoke: (() =>
    Promise.resolve({ status: "completed", rationale: "claims to have fixed it" })) as AgentPort["invoke"],
};

async function runSurface(
  label: string,
  files: Record<string, string>,
  agent: AgentPort,
  worktreePathOverride?: string,
): Promise<void> {
  console.log(`\n=== ${label} ===`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-case-"));
  const repoPath = initTempRepo("surface-demo-repo-", files);
  const worktreePath =
    worktreePathOverride ??
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-tree-")), "wt");
  const location: SurfaceLocation = { repoPath, worktreePath };
  const ports: SurfacePorts = { agent, triage: unusedTriage, closer: noopCloser };

  await create(
    dir,
    { surfaceId: `demo-${label.split(" ")[0]?.toLowerCase() ?? "surface"}`, taskDef: { intent: "add a feature" }, gateRef },
    budgets,
  );
  console.log("State: PROVISIONING (fresh case file, no worktree)");

  // Slice 1 stops at "ready for a worker": AGENT_ACTIVE has no edge yet.
  for (let step = 0; step < 10; step++) {
    const { state, done } = await advance(dir, location, ports);
    console.log(`State: ${state}`);
    if (done || state === "AGENT_ACTIVE") break;
  }

  const caseFile = await load(dir);
  const repairs = caseFile.history.filter((e) => e.t === "dispatch").length;
  console.log(`Worktree created: ${fs.existsSync(worktreePath)}`);
  console.log(`Baseline captured: ${caseFile.header.baseline !== null}`);
  console.log(`Repair sessions dispatched: ${repairs}`);
  console.log(
    caseFile.outcome
      ? `Outcome: ${caseFile.outcome.kind} — ${caseFile.outcome.reason}`
      : "Outcome: none yet — ready for a worker",
  );
}

async function main(): Promise<void> {
  await runSurface("Healthy gate", { "report.tap": PASSING_TAP }, idleAgent);
  await runSurface("Broken gate, repaired", { "seed.txt": "hello\n" }, repairingAgent);
  await runSurface("Broken gate, never repaired", { "seed.txt": "hello\n" }, uselessAgent);

  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-block-")), "file");
  fs.writeFileSync(blocker, "not a directory\n");
  await runSurface(
    "Unusable worktree path",
    { "report.tap": PASSING_TAP },
    idleAgent,
    path.join(blocker, "wt"),
  );
}

await main();
