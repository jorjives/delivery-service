/**
 * UAT demo for Single-Surface State Machine Slice 3: Route a Setback Back Into
 * the Loop Instead of Giving Up.
 *
 * Four scenarios against fresh surfaces — a gate failure, a gate error, a
 * rejected close, and a stuck worker — each printing the states the driver
 * moves through, the router's verdicts, and the final outcome.
 *
 * Usage: npx tsx demos/single-surface-slice-3-setbacks.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import type {
  AgentPort,
  CloserPort,
  SurfaceLocation,
  SurfacePorts,
  Terminus,
} from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";
import { fakeAgentPort } from "../src/testing.js";

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

/** Write the gate's input file in the worktree. */
function tap(worktreePath: string, contents: string): void {
  fs.writeFileSync(path.join(worktreePath, "report.tap"), contents);
}

/**
 * An agent that runs the next scripted worker step per worker dispatch, and a
 * fixed repair step for every gate-maintenance dispatch.
 */
function agentOf(
  workerSteps: ((worktreePath: string) => Terminus)[],
  repair?: (worktreePath: string) => Terminus,
): AgentPort {
  let i = 0;
  return fakeAgentPort({
    worker: (ctx) => {
      const step = workerSteps[Math.min(i, workerSteps.length - 1)];
      i += 1;
      if (!step) throw new Error("no worker step scripted");
      return Promise.resolve(step(ctx.worktreePath));
    },
    "gate-maintenance": repair && ((ctx) => Promise.resolve(repair(ctx.worktreePath))),
  });
}

async function runScenario(
  title: string,
  setback: string,
  ports: SurfacePorts,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setback-case-"));
  const repoPath = initTempRepo("setback-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "setback-tree-")), "wt");
  const location: SurfaceLocation = { repoPath, worktreePath };

  await create(dir, { surfaceId: title.toLowerCase().replace(/\W+/g, "-"), taskDef: { intent: "add a feature" }, gateRef }, budgets);

  console.log(`\n=== ${title} ===`);
  console.log(`Setback:  ${setback}`);
  const states = ["PROVISIONING"];
  let done = false;
  while (!done) {
    const step = await advance(dir, location, ports);
    states.push(step.state);
    done = step.done;
  }

  const caseFile = await load(dir);
  const verdicts = caseFile.history
    .filter((e) => e.t === "triage")
    .map((e) => `${e.trigger} -> ${e.verdict}`);

  console.log(`States:   ${states.join(" -> ")}`);
  console.log(`Router:   ${verdicts.length ? verdicts.join(", ") : "(never consulted)"}`);
  console.log(`Attempts: ${caseFile.history.filter((e) => e.t === "dispatch").length} dispatched`);
  console.log(`Outcome:  ${caseFile.outcome?.kind ?? "none"} — ${caseFile.outcome?.reason ?? ""}`);
}

async function main(): Promise<void> {
  // 1. The worker's change fails the gate; the router reroutes; attempt 2 passes.
  await runScenario(
    "Gate failure, fixed on the retried attempt",
    "the worker's first change regresses a passing assertion",
    {
      agent: agentOf([
        (wt) => { tap(wt, FAILING_TAP); return { status: "completed", rationale: "broke beta" }; },
        (wt) => { tap(wt, PASSING_TAP); return { status: "completed", rationale: "fixed beta" }; },
      ]),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  );

  // 2. The worker's change stops the gate running at all. The gate is rechecked,
  //    free, until its recheck budget is spent; then a repair restores it, and
  //    the SAME attempt is re-checked against the SAME baseline.
  await runScenario(
    "Gate error, repaired then re-checked",
    "the worker's change removes the file the gate reads, so the gate cannot run, even on recheck",
    {
      agent: agentOf(
        [(wt) => { fs.rmSync(path.join(wt, "report.tap")); return { status: "completed", rationale: "worked, broke the gate" }; }],
        (wt) => { tap(wt, PASSING_TAP); return { status: "completed", rationale: "restored report.tap" }; },
      ),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  );

  // 3. The closer rejects the first close, accepts the retried one.
  let closes = 0;
  const fussyCloser: CloserPort = {
    close: (_ctx, outcome) => {
      if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
      closes += 1;
      return Promise.resolve(
        closes === 1
          ? { status: "FAIL", detail: "the surface is not ready to close yet" }
          : { status: "DONE", detail: "closed on the retried attempt" },
      );
    },
  };
  await runScenario(
    "Close rejected once, accepted on retry",
    "the closer reports the surface is not actually ready",
    {
      agent: agentOf([() => ({ status: "completed", rationale: "clean change" })]),
      triage: deterministicRouter,
      closer: fussyCloser,
    },
  );

  // 4. The worker reports it is stuck but retryable; the retried attempt lands.
  await runScenario(
    "Stuck worker, succeeds on the retried attempt",
    "the worker reports an exhaustion-class escalate — stuck, but a retry might help",
    {
      agent: agentOf([
        () => ({ status: "escalate", category: "exhaustion", rationale: "ran out of road, a retry might get there" }),
        () => ({ status: "completed", rationale: "got there on the retried attempt" }),
      ]),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  );
}

await main();
