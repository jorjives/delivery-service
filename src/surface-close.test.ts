import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, readRef } from "./case-file.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import { advance, run, type AdvanceResult } from "./surface.js";
import { deterministicRouter } from "./router.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { EscalationPacket } from "./triage-role-config.js";
import type { AgentContext, AgentPort, SurfaceLocation, SurfacePorts, TriagePort } from "./ports.js";
import type { BudgetSet, GateRef, HistoryEntry } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const BRANCH = "surface/surface-7";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** A worker that writes the feature and completes. Any other role must not be asked. */
const worker: AgentPort = {
  invoke: ((role: { role: string }, ctx: AgentContext) => {
    if (role.role !== "worker") return Promise.reject(new Error(`${role.role} was not expected here`));
    writeFileSync(join(ctx.worktreePath, "feature.txt"), "the feature\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

/**
 * Provision a surface against a fresh repo and advance it until the work is
 * accepted and the close is next, so a test can change the world before it.
 */
async function toClosing(
  ports: SurfacePorts,
  budgetSet: BudgetSet = budgets,
): Promise<{ dir: string; repo: string; location: SurfaceLocation }> {
  const dir = await mkdtemp(join(tmpdir(), "surface-close-case-"));
  const repo = initTempRepo("surface-close-repo-", { "report.tap": PASSING_TAP });
  const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-close-tree-")), "wt") };
  await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef }, budgetSet);
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
  } while (result.state !== "CLOSING" && !result.done);
  expect(result.state).toBe("CLOSING");
  return { dir, repo, location };
}

function moveMainOn(repo: string): void {
  writeFileSync(join(repo, "hotfix.txt"), "someone else's change\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "main moved on"]);
}

async function closeReports(dir: string, history: HistoryEntry[]): Promise<unknown[]> {
  return Promise.all(history.flatMap((e) => (e.t === "close" ? [readRef(dir, e.detailRef)] : [])));
}

async function packetOf(dir: string): Promise<EscalationPacket> {
  const { outcome } = await load(dir);
  expect(outcome?.kind).toBe("escalated");
  return EscalationPacket.parse(await readRef(dir, outcome?.packetRef ?? ""));
}

describe("a close that cannot complete, with the real merge-back closer", () => {
  const ports: SurfacePorts = { agent: worker, triage: deterministicRouter, closer: createMergeBackCloser() };

  it("re-runs the real closer while close budget remains, each retry refusing the same way and changing nothing", async () => {
    const { dir, repo, location } = await toClosing(ports);
    moveMainOn(repo);
    const movedTip = git(repo, ["rev-parse", "main"]);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("ESCALATED");
    const { history } = await load(dir);
    const reports = await closeReports(dir, history);
    // The first close plus one retry per close slot.
    expect(reports).toHaveLength(budgets.close.max + 1);
    for (const report of reports) {
      expect(report).toEqual(reports[0]);
      expect(report).toMatchObject({ status: "FAIL" });
    }
    expect(history.filter((e) => e.t === "triage").map((e) => e.t === "triage" && e.verdict)).toEqual([
      "retry_close", "retry_close", "retry_close", "escalate",
    ]);
    expect(git(repo, ["rev-parse", "main"])).toBe(movedTip);
    expect(git(repo, ["rev-list", "--count", `main..${BRANCH}`])).toBe("1");
  });

  it("escalates with the closer's own report as evidence and a decision about the close", async () => {
    const { dir, repo, location } = await toClosing(ports);
    moveMainOn(repo);
    const shortTip = git(repo, ["rev-parse", "--short", "main"]);

    await run(dir, location, ports);

    const packet = await packetOf(dir);
    const { history } = await load(dir);
    const lastReport = (await closeReports(dir, history)).at(-1) as { detail: string };
    expect(packet.evidence).toBe(lastReport.detail);
    expect(packet.evidence).toContain("main has moved on");
    expect(packet.evidence).toContain(shortTip);
    expect(packet.decision).toContain("No close retry budget remains (3/3 used)");
    expect(packet.decision).toContain("choose a different close");
    // Stopped surface tidies up: worktree gone, branch with the work kept.
    expect(existsSync(location.worktreePath)).toBe(false);
    expect(git(repo, ["branch", "--list", BRANCH, "--format=%(refname:short)"])).toBe(BRANCH);
  });

  it("ends closed normally when a retry finds the base branch back in a mergeable state", async () => {
    const { dir, repo, location } = await toClosing(ports);
    const seedTip = git(repo, ["rev-parse", "main"]);
    moveMainOn(repo);
    // Stands in for an operator who undoes the stray commit while the close is being retried.
    let undone = false;
    const operatorUndoes: TriagePort = {
      triage: (input) => {
        if (!undone) {
          git(repo, ["reset", "-q", "--hard", seedTip]);
          undone = true;
        }
        return deterministicRouter.triage(input);
      },
    };

    const result = await run(dir, location, { ...ports, triage: operatorUndoes });

    expect(result.state).toBe("CLOSED");
    expect(result.outcome?.reason).toMatch(/Fast-forwarded main/);
    expect(git(repo, ["show", "main:feature.txt"])).toBe("the feature");
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "close").map((e) => e.t === "close" && e.status)).toEqual(["FAIL", "DONE"]);
  });

  it.each([
    ["a refusal", "FAIL", moveMainOn],
    ["an environment error", "ERROR", (repo: string) => git(repo, ["checkout", "-q", "-b", "elsewhere"])],
  ] as const)("routes %s to close-failure handling and never back to a worker", async (_kind, status, breakIt) => {
    const { dir, repo, location } = await toClosing(ports);
    breakIt(repo);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("ESCALATED");
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "close").every((e) => e.t === "close" && e.status === status)).toBe(true);
    const triages = history.filter((e) => e.t === "triage");
    expect(triages.every((e) => e.t === "triage" && e.trigger === "close_failure")).toBe(true);
    expect(triages.some((e) => e.t === "triage" && e.verdict === "reroute")).toBe(false);
    // The worker ran once, before acceptance, and was never dispatched again.
    expect(history.filter((e) => e.t === "dispatch")).toHaveLength(1);
  });
});
