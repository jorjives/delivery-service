import { describe, expect, it } from "vitest";
import { load, readRef } from "./case-file.js";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { deterministicRouter } from "./router.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import { CloseReport } from "./schema.js";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSupervisorAgainstMock } from "./testing.js";
import type { ScriptedTask, ScriptedTaskResult } from "./testing.js";
import type { BudgetSet, CloserRef, GateRef } from "./schema.js";

// Caps of 1 keep a task that cannot close short: one refused close, one retry, then escalation.
const budgets: BudgetSet = {
  correction: { used: 0, max: 1 },
  gateError: { used: 0, max: 1 },
  gateMaintenance: { used: 0, max: 1 },
  terminus: { used: 0, max: 1 },
  close: { used: 0, max: 1 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

/**
 * How much longer the second task's agent takes to answer. Both working copies
 * are made as the run starts; the gap must outlast one agent session starting
 * and the first task's check and merge, even on a busy machine.
 */
const STAGGER_MS = 2000;

/** A task whose agent waits `delayMs`, writes `<name>.txt` and reports completion. */
function task(name: string, delayMs: number): ScriptedTask {
  return {
    header: { surfaceId: name, taskDef: { intent: `add a ${name} file` }, gateRef, closerRef },
    script: {
      delayMs,
      expectations: [
        {
          effects: [{ write: { path: `${name}.txt`, content: `${name}\n` } }],
          json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: `wrote ${name}.txt` }),
        },
      ],
    },
  };
}

const scratchRepo = (): string => initTempRepo("scripted-supervisor-repo-", { "report.tap": "1..1\nok 1 - greets\n" });

const runTasks = (repoPath: string, slots: number, tasks: ScriptedTask[]): Promise<ScriptedTaskResult[]> =>
  runSupervisorAgainstMock({ repoPath, slots, tasks, budgets, roleConfigs, triage: () => deterministicRouter });

function resultFor(results: ScriptedTaskResult[], surfaceId: string): ScriptedTaskResult {
  const found = results.find((ran) => ran.surfaceId === surfaceId);
  if (found === undefined) throw new Error(`no result for ${surfaceId}`);
  return found;
}

describe("runSupervisorAgainstMock", () => {
  it("with one slot, runs the tasks one after another in list order, whatever their delays, and both land", async () => {
    const repoPath = scratchRepo();
    // The first task is the slow one: if the two ran together, the second would merge first and the first be refused.
    const tasks = [task("hello", STAGGER_MS), task("goodbye", 0)];

    const results = await runTasks(repoPath, 1, tasks);

    expect(results.map((ran) => [ran.surfaceId, ran.result.state])).toEqual([
      ["hello", "CLOSED"],
      ["goodbye", "CLOSED"],
    ]);
    expect(git(repoPath, ["show", "main:hello.txt"])).toBe("hello");
    expect(git(repoPath, ["show", "main:goodbye.txt"])).toBe("goodbye");
  });

  it("gives each task its own journal: only its own prompts, and only its own script used", async () => {
    const repoPath = scratchRepo();
    const tasks = [task("hello", 0), task("goodbye", STAGGER_MS)];

    const results = await runTasks(repoPath, 2, tasks);

    for (const [index, { script, header }] of tasks.entries()) {
      const ran = results[index];
      expect(ran?.surfaceId).toBe(header.surfaceId);
      const journal = ran?.journal ?? [];
      assertFullyConsumed(journal, script);
      const prompts = promptsSent(journal);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain(`add a ${header.surfaceId} file`);
    }
    expect(promptsSent(resultFor(results, "hello").journal).join("\n")).not.toContain("add a goodbye file");
  });

  it.each([
    { first: "hello", second: "goodbye" },
    { first: "goodbye", second: "hello" },
  ])(
    "with two slots, $first answering first is merged and $second is refused because the base moved on",
    async ({ first, second }) => {
      const repoPath = scratchRepo();
      const delayOf = (name: string): number => (name === first ? 0 : STAGGER_MS);
      // List order is the same both times: only the delays decide who reaches the merge first.
      const results = await runTasks(repoPath, 2, [task("hello", delayOf("hello")), task("goodbye", delayOf("goodbye"))]);

      const merged = resultFor(results, first);
      const refused = resultFor(results, second);
      expect(merged.result.state).toBe("CLOSED");
      expect(refused.result.state).toBe("ESCALATED");

      const closes = (await load(refused.dir)).history.flatMap((entry) => (entry.t === "close" ? [entry] : []));
      expect(closes.length).toBeGreaterThan(0);
      for (const close of closes) {
        expect(close.status).toBe("FAIL");
        expect(CloseReport.parse(await readRef(refused.dir, close.detailRef)).detail).toContain("main has moved on");
      }

      expect(git(repoPath, ["show", `main:${first}.txt`])).toBe(first);
      expect(() => git(repoPath, ["show", `main:${second}.txt`])).toThrow();
      // The refused work is kept on its own branch for a person to bring up to date.
      expect(git(repoPath, ["show", `surface/${second}:${second}.txt`])).toBe(second);
      expect(git(repoPath, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    },
  );

  it.each([0, -1, 1.5])("refuses %s slots before anything runs", async (slots) => {
    const repoPath = scratchRepo();

    await expect(runTasks(repoPath, slots, [task("hello", 0)])).rejects.toThrow(
      `slots must be a whole number of 1 or more, but was ${slots}.`,
    );
    expect(git(repoPath, ["branch", "--list", "surface/*"])).toBe("");
  });

  it("refuses two tasks with one surfaceId before anything runs", async () => {
    const repoPath = scratchRepo();

    await expect(runTasks(repoPath, 2, [task("hello", 0), task("hello", 0)])).rejects.toThrow(
      `Each scripted task needs its own surfaceId, but "hello" is used more than once: a task's branch and working copy are named after it.`,
    );
    expect(git(repoPath, ["branch", "--list", "surface/*"])).toBe("");
  });
});
