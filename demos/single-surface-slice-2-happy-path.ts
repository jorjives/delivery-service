/**
 * UAT demo for Single-Surface State Machine Slice 2: Drive a Worker's Change
 * Through the Gate to a Decision.
 *
 * Provisions a fresh surface against a real temporary git repository,
 * dispatches a scripted worker that produces a clean change, and lets the
 * driver run to completion unattended — printing every state on the way.
 *
 * Usage: npx tsx demos/single-surface-slice-2-happy-path.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance } from "../src/surface.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";
import { fakeAgentPort } from "../src/testing.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate is a plain shell command over the project's TAP output.
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

const unusedTriage: SurfacePorts["triage"] = {
  triage: () => Promise.reject(new Error("no setback in the happy path — triage is slice 3")),
};

/** Adds a file to the worktree and leaves the gate passing. */
const cleanWorker: AgentPort = fakeAgentPort({
  worker: (ctx) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the change\n");
    return Promise.resolve({ status: "completed", rationale: "added the feature" });
  },
});

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-case-"));
  const repoPath = initTempRepo("surface-demo-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "surface-demo-tree-")),
    "wt",
  );
  const location: SurfaceLocation = { repoPath, worktreePath };
  const ports: SurfacePorts = { agent: cleanWorker, triage: unusedTriage, closer: noopCloser };

  await create(
    dir,
    { surfaceId: "demo-happy-path", taskDef: { intent: "add a feature" }, gateRef },
    budgets,
  );

  console.log("=== Happy path: nothing to done, unattended ===");
  console.log("State: PROVISIONING (fresh case file, no worktree)");

  let done = false;
  while (!done) {
    const step = await advance(dir, location, ports);
    console.log(`State: ${step.state}`);
    done = step.done;
  }

  const caseFile = await load(dir);
  console.log(`\nWorktree created:   ${fs.existsSync(worktreePath)}`);
  console.log(`Worker's change:    ${fs.existsSync(path.join(worktreePath, "feature.txt"))}`);
  console.log(`Baseline captured:  ${caseFile.header.baseline?.status ?? "none"}`);
  console.log(`History:            ${caseFile.history.map((e) => e.t).join(" -> ")}`);
  console.log(
    `Outcome:            ${caseFile.outcome?.kind ?? "none"} — ${caseFile.outcome?.reason ?? ""}`,
  );
}

await main();
