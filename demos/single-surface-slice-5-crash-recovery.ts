/**
 * UAT demo for Single-Surface State Machine Slice 5: Resume a Surface After a
 * Crash to the Same Outcome.
 *
 * Each scenario runs twice against fresh directories: once straight through,
 * and once stopped after a fixed number of advances and resumed from the same
 * directory as if a new process had picked it up. The two outcomes and the two
 * sets of log-derived budget counts are printed side by side, along with every
 * recovery step the resumed run reported.
 *
 * Usage: npx tsx demos/single-surface-slice-5-crash-recovery.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { create, load, rebuild, updateCursor, deriveBudgetsFromLog } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance, run } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import type {
  AgentContext,
  AgentPort,
  RoleHandle,
  SurfaceLocation,
  SurfacePorts,
  Terminus,
} from "../src/ports.js";
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

async function freshSurface(surfaceId: string): Promise<{ dir: string; location: SurfaceLocation }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-case-"));
  const repoPath = initTempRepo("resume-repo-", { "report.tap": PASSING_TAP });
  const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "resume-tree-")), "wt");
  await create(dir, { surfaceId, taskDef: { intent: "add a feature" }, gateRef }, budgets);
  return { dir, location: { repoPath, worktreePath } };
}

function budgetLine(spent: BudgetSet): string {
  return (Object.keys(spent) as BudgetPopulation[])
    .map((p) => `${p} ${spent[p].used}/${spent[p].max}`)
    .join(", ");
}

async function summarise(dir: string): Promise<{ outcome: string; reason: string; budgets: string }> {
  const caseFile = await load(dir);
  return {
    outcome: caseFile.outcome?.kind ?? "none",
    reason: caseFile.outcome?.reason ?? "",
    budgets: budgetLine(deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets)),
  };
}

interface Scenario {
  title: string;
  scripted: string;
  /** Where the first process is cut off, in whole advances. */
  stopAfter: number;
  /**
   * Kill the first process *inside* its nth agent session instead: the dispatch
   * is on disk and the terminus never arrives, which is the window a clean stop
   * between advances cannot reach.
   */
  killSession?: number;
  /**
   * How else the first process died, for windows neither of the above reaches —
   * a kill between `git worktree add` and the cursor write leaves the surface
   * still PROVISIONING on disk with a worktree already on the path.
   */
  interrupt?: (dir: string) => Promise<void>;
  ports: () => SurfacePorts;
}

/** Ports whose agent dies mid-session on its nth invocation. */
function killingSession(ports: SurfacePorts, n: number): SurfacePorts {
  let calls = 0;
  return {
    ...ports,
    agent: {
      invoke: (roleCfg, ctx) => {
        calls += 1;
        return calls === n
          ? Promise.reject(new Error("session killed by infrastructure"))
          : ports.agent.invoke(roleCfg, ctx);
      },
    },
  };
}

/** An agent that always returns the same terminus, whatever the role. */
function always(terminus: Terminus): SurfacePorts["agent"] {
  return { invoke: (() => Promise.resolve(terminus)) as AgentPort["invoke"] };
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  const straight = await freshSurface("straight");
  await run(straight.dir, straight.location, scenario.ports());
  const uninterrupted = await summarise(straight.dir);

  const stopped = await freshSurface("interrupted");
  const base = scenario.ports();
  const firstProcess = scenario.killSession ? killingSession(base, scenario.killSession) : base;
  const recoveries: string[] = [];
  try {
    for (let step = 0; step < scenario.stopAfter; step++) {
      await advance(stopped.dir, stopped.location, firstProcess);
    }
  } catch {
    // The first process died mid-session. The directory is all that survives.
  }
  if (scenario.interrupt) await scenario.interrupt(stopped.dir);
  // Everything except the directory is thrown away: fresh ports, and a rebuilt
  // cursor, exactly as a new process picking the surface up would have.
  await rebuild(stopped.dir);
  const secondProcess = scenario.ports();
  let result = await advance(stopped.dir, stopped.location, secondProcess);
  if (result.recovery) recoveries.push(result.recovery);
  while (!result.done) {
    result = await advance(stopped.dir, stopped.location, secondProcess);
    if (result.recovery) recoveries.push(result.recovery);
  }
  const resumed = await summarise(stopped.dir);

  // The guarantee is the outcome and the budget counts. The reason is printed
  // for information: a crashed session is honestly described differently from a
  // session that returned a result, and that difference is the point.
  const identical =
    uninterrupted.outcome === resumed.outcome && uninterrupted.budgets === resumed.budgets;

  console.log(`\n=== ${scenario.title} ===`);
  console.log(`Scripted:      ${scenario.scripted}`);
  console.log(
    `Stopped:       ${
      scenario.killSession
        ? `inside agent session ${scenario.killSession}, which was killed outright`
        : `after ${scenario.stopAfter} advance(s)`
    }, then resumed from the directory alone`,
  );
  console.log(`Uninterrupted: ${uninterrupted.outcome} — ${uninterrupted.reason}`);
  console.log(`               ${uninterrupted.budgets}`);
  console.log(`Stop + resume: ${resumed.outcome} — ${resumed.reason}`);
  console.log(`               ${resumed.budgets}`);
  console.log(`Recovery:      ${recoveries.length ? recoveries.join("\n               ") : "none needed at this stopping point"}`);
  console.log(`Identical:     ${identical ? "yes" : "NO — the runs diverged"}`);
  return identical;
}

async function main(): Promise<void> {
  console.log("Each scenario runs twice: straight through, and stopped mid-run then resumed.");

  const scenarios: Scenario[] = [
    {
      title: "Stopped mid provision",
      scripted:
        "a clean worker change; the first process is killed after `git worktree add` but before the cursor advanced",
      stopAfter: 1,
      interrupt: (dir) => updateCursor(dir, { state: "PROVISIONING", worktreeRef: "" }),
      ports: () => ({
        agent: always({ status: "completed", rationale: "clean change" }),
        triage: deterministicRouter,
        closer: noopCloser,
      }),
    },
    {
      title: "Stopped mid worker attempt",
      scripted:
        "every worker session ends without a valid result, to the terminus cap; the second session is killed outright",
      stopAfter: 20,
      killSession: 2,
      ports: () => ({
        agent: always({ status: "incomplete", rationale: "hit the turn cap" }),
        triage: deterministicRouter,
        closer: noopCloser,
      }),
    },
    {
      title: "Stopped mid repair attempt",
      scripted:
        "the worker deletes the file the gate reads; every repair session ends without a result, to the repair cap; the first repair session is killed outright",
      stopAfter: 20,
      killSession: 2,
      ports: () => ({
        agent: {
          invoke: ((roleCfg: RoleHandle, ctx: AgentContext) => {
            if (roleCfg.role === "worker") {
              fs.rmSync(path.join(ctx.worktreePath, "report.tap"), { force: true });
              return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
            }
            // Every repair session ends without a result, so the killed one and
            // a returned one leave the same history. A killed session whose
            // scripted result WOULD have resolved is a different history by
            // construction — it loses that session's consequences — and no
            // resume can conjure them back; the guarantee is that a crash
            // repeats nothing and loses nothing already recorded.
            return Promise.resolve({ status: "incomplete", rationale: "the repair session hit its cap" });
          }) as AgentPort["invoke"],
        },
        triage: deterministicRouter,
        closer: noopCloser,
      }),
    },
    {
      title: "Stopped mid triage",
      scripted:
        "the work passes the gate; every close attempt is rejected, to the close cap; stopped with the triage verdict recorded and its retried close not yet carried out",
      // provision, baseline, worker, gate, rejected close, triage.
      stopAfter: 6,
      ports: () => ({
        agent: always({ status: "completed", rationale: "clean change" }),
        triage: deterministicRouter,
        closer: {
          close: (_ctx, outcome) =>
            Promise.resolve(
              outcome.kind === "accepted"
                ? { status: "FAIL", detail: "not ready to close" }
                : { status: "DONE", detail: "torn down" },
            ),
        },
      }),
    },
  ];

  let allIdentical = true;
  for (const scenario of scenarios) {
    allIdentical = (await runScenario(scenario)) && allIdentical;
  }

  console.log(
    `\nEvery scenario identical across the stop-and-resume: ${allIdentical ? "yes" : "NO"}`,
  );
  if (!allIdentical) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
