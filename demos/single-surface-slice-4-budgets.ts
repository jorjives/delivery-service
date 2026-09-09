/**
 * UAT demo for Single-Surface State Machine Slice 4: Stop Cleanly When a Retry
 * Budget Runs Out.
 *
 * One scenario per enforced budget, each scripted so the relevant port never
 * produces a resolving result, printing what the scenario spent against that
 * budget's cap, what every other population did, and the escalation reason.
 * A final block runs one scenario twice — straight through, and stopped
 * partway then resumed from the same directory — to show the cap does not move.
 *
 * Usage: npx tsx demos/single-surface-slice-4-budgets.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load, deriveBudgetsFromLog, rebuild } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance, run } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, CloserPort, SurfaceLocation, SurfacePorts, Terminus } from "../src/ports.js";
import type { BudgetPopulation, BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

/** A fresh case directory, temp repo and worktree path for one scenario. */
async function freshSurface(surfaceId: string): Promise<{ dir: string; location: SurfaceLocation }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-case-"));
  const repoPath = initTempRepo("budget-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "budget-tree-")), "wt");
  await create(dir, { surfaceId, taskDef: { intent: "add a feature" }, gateRef }, budgets);
  return { dir, location: { repoPath, worktreePath } };
}

/** What the log says about a finished surface. */
async function summarise(dir: string): Promise<{
  outcome: string;
  reason: string;
  spent: BudgetSet;
  dispatches: number;
  closes: number;
}> {
  const caseFile = await load(dir);
  return {
    outcome: caseFile.outcome?.kind ?? "none",
    reason: caseFile.outcome?.reason ?? "",
    spent: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
    dispatches: caseFile.history.filter((e) => e.t === "dispatch").length,
    closes: caseFile.history.filter((e) => e.t === "close").length,
  };
}

function budgetLine(spent: BudgetSet): string {
  return (Object.keys(spent) as BudgetPopulation[])
    .map((p) => `${p} ${spent[p].used}/${spent[p].max}`)
    .join(", ");
}

interface Scenario {
  title: string;
  scripted: string;
  population: BudgetPopulation;
  /** What one unit of this population buys, so the printed count reads plainly. */
  burn: string;
  ports: SurfacePorts;
}

async function runScenario(scenario: Scenario): Promise<void> {
  const { dir, location } = await freshSurface(scenario.title.toLowerCase().replace(/\W+/g, "-"));
  await run(dir, location, scenario.ports);
  const { outcome, reason, spent, dispatches, closes } = await summarise(dir);
  const { used, max } = spent[scenario.population];

  console.log(`\n=== ${scenario.title} ===`);
  console.log(`Scripted:  ${scenario.scripted}`);
  console.log(`Capped by: ${scenario.population}, cap ${max}`);
  console.log(`Spent:     ${used} of ${max} (one per ${scenario.burn})`);
  console.log(`Sessions:  ${dispatches} agent session(s), ${closes} close attempt(s)`);
  console.log(`Budgets:   ${budgetLine(spent)}`);
  console.log(`Outcome:   ${outcome} — ${reason}`);
}

/** A worker that always reports the same terminus, whatever the role. */
function alwaysWorker(terminus: Terminus): AgentPort {
  return { invoke: () => Promise.resolve(terminus) };
}

async function main(): Promise<void> {
  console.log("Budget caps for these runs:", budgetLine(budgets));
  console.log(
    "Note: gateError is counted but gated by nothing in this item (design spec, Budgets):",
  );
  console.log(
    "      a gate that cannot run is routed to gate maintenance and paid for there.",
  );

  // 1. correction — the worker is always stuck but says a retry might help.
  await runScenario({
    title: "Correction budget: a worker that is always stuck",
    scripted: "every worker session returns an exhaustion-class escalate",
    population: "correction",
    burn: "retried worker attempt the router authorises",
    ports: {
      agent: alwaysWorker({
        status: "escalate",
        category: "exhaustion",
        rationale: "stuck, try again",
      }),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  });

  // 2. gateMaintenance — the gate can never run again, and no repair fixes it.
  await runScenario({
    title: "Gate-repair budget: a gate that always errors",
    scripted:
      "the worker deletes the file the gate reads; every repair session reports success without restoring it",
    population: "gateMaintenance",
    burn: "repair session dispatched",
    ports: {
      agent: {
        invoke: (roleCfg, ctx) => {
          if (roleCfg.role === "worker") {
            fs.rmSync(path.join(ctx.worktreePath, "report.tap"), { force: true });
            return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
          }
          return Promise.resolve({ status: "completed", rationale: "repaired nothing" });
        },
      },
      triage: deterministicRouter,
      closer: noopCloser,
    },
  });

  // 3. terminus — every worker session ends without a valid result.
  await runScenario({
    title: "Incomplete-terminus budget: a worker that never returns a result",
    scripted: "every worker session ends incomplete (crash, cap or timeout)",
    population: "terminus",
    burn: "incomplete session, the last of which is not retried",
    ports: {
      agent: alwaysWorker({ status: "incomplete", rationale: "hit the turn cap" }),
      triage: deterministicRouter,
      closer: noopCloser,
    },
  });

  // 4. close — the work is fine, the closer never accepts it.
  const rejectingCloser: CloserPort = {
    close: (_ctx, outcome) =>
      Promise.resolve(
        outcome.kind === "accepted"
          ? { status: "FAIL", detail: "not ready to close" }
          : { status: "DONE", detail: "torn down" },
      ),
  };
  await runScenario({
    title: "Close-retry budget: a closer that always rejects the work",
    scripted: "the worker's change passes the gate; every close attempt is rejected",
    population: "close",
    burn: "retried close the router authorises",
    ports: {
      agent: alwaysWorker({ status: "completed", rationale: "clean change" }),
      triage: deterministicRouter,
      closer: rejectingCloser,
    },
  });

  // 5. The same cap, reached across a restart.
  const ports = (): SurfacePorts => ({
    agent: alwaysWorker({
      status: "escalate",
      category: "exhaustion",
      rationale: "stuck, try again",
    }),
    triage: deterministicRouter,
    closer: noopCloser,
  });

  const straight = await freshSurface("resume-reference");
  await run(straight.dir, straight.location, ports());
  const reference = await summarise(straight.dir);

  const stopped = await freshSurface("resume-interrupted");
  const firstProcess = ports();
  for (let step = 0; step < 5; step++) {
    await advance(stopped.dir, stopped.location, firstProcess);
  }
  const midway = await summarise(stopped.dir);
  await rebuild(stopped.dir);
  await run(stopped.dir, stopped.location, ports());
  const resumed = await summarise(stopped.dir);

  console.log("\n=== The same cap, reached across a restart ===");
  console.log(`Stopped at:   ${budgetLine(midway.spent)}`);
  console.log(`Uninterrupted: ${reference.outcome} — ${reference.reason}`);
  console.log(`               ${budgetLine(reference.spent)}, ${reference.dispatches} session(s)`);
  console.log(`Stop + resume: ${resumed.outcome} — ${resumed.reason}`);
  console.log(`               ${budgetLine(resumed.spent)}, ${resumed.dispatches} session(s)`);
}

await main();
