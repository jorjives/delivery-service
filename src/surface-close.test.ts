import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { create, load, readRef } from "./case-file.js";
import { initTempRepo, addLocalOrigin } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import { createGhStandIn } from "./gh-stand-in.js";
import { advance, run, type AdvanceResult } from "./surface.js";
import { resolveCloser } from "./resolve-closer.js";
import { deterministicRouter } from "./router.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { createAgentTriage } from "./triage.js";
import { EscalationPacket } from "./triage-role-config.js";
import { fakeAgentPort } from "./testing.js";
import type { AgentContext, AgentPort, CloseContext, SurfaceLocation, SurfacePorts, TriagePort, TriageTerminus, Terminus } from "./ports.js";
import type { BudgetSet, CloserRef, GateRef, HistoryEntry } from "./schema.js";

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

/** Writes the feature and completes. */
function writeFeature(ctx: AgentContext): Promise<Terminus> {
  writeFileSync(join(ctx.worktreePath, "feature.txt"), "the feature\n");
  return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
}

/** A worker that writes the feature and completes. Any other role must not be asked. */
const worker: AgentPort = fakeAgentPort({ worker: writeFeature });

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

describe("the repair brief on a retried close", () => {
  const brief = {
    problem: "main moved on under the merge",
    dead_ends: "a plain fast-forward was refused",
    scope: "land the accepted change only",
    references: ["close-0"],
    diagnosis: "rebase the surface branch onto main before merging",
  };

  /** A closer that refuses once, then lands, recording the context each accepted close saw. */
  function recordingCloser(): SurfacePorts["closer"] & { seen: CloseContext[] } {
    const seen: CloseContext[] = [];
    return {
      seen,
      close: (ctx, outcome) => {
        if (outcome.kind !== "accepted") return Promise.resolve({ status: "DONE", detail: "torn down" });
        seen.push(ctx);
        return Promise.resolve(
          seen.length === 1 ? { status: "FAIL", detail: "main has moved on" } : { status: "DONE", detail: "landed" },
        );
      },
    };
  }

  function agentWithTriage(triage: () => Promise<TriageTerminus>): AgentPort {
    return fakeAgentPort({ worker: writeFeature, triage });
  }

  it("hands the closer the brief triage's agent wrote for the retry, and none on the first close", async () => {
    const closer = recordingCloser();
    const agent = agentWithTriage(() =>
      Promise.resolve({ status: "retry_close", rationale: "worth one more try", payload: brief }),
    );
    // One close slot: the last slot is where triage's agent is engaged.
    const oneSlot = { ...budgets, close: { used: 0, max: 1 } };
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer };
    const { dir, location } = await toClosing(ports, oneSlot);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    expect(closer.seen).toHaveLength(2);
    expect(closer.seen[0]?.repairBrief).toBeUndefined();
    expect(closer.seen[1]?.repairBrief).toEqual(brief);
  });

  it("hands the closer no brief when the deterministic router ordered the retry", async () => {
    const closer = recordingCloser();
    const ports: SurfacePorts = { agent: worker, triage: deterministicRouter, closer };
    const { dir, location } = await toClosing(ports);

    await run(dir, location, ports);

    expect(closer.seen).toHaveLength(2);
    expect(closer.seen.every((ctx) => !("repairBrief" in ctx))).toBe(true);
  });
});

describe("a project's own closer, referenced by module path", () => {
  const MODULE_PATH = "closers/project-closer.mjs";

  /** A surface whose pinned closerRef names a module written into the repo root, not the worktree. */
  async function surfaceWithCustomCloser(source: string): Promise<{ dir: string; location: SurfaceLocation; ports: SurfacePorts }> {
    const dir = await mkdtemp(join(tmpdir(), "surface-custom-close-case-"));
    const repo = initTempRepo("surface-custom-close-repo-", { "report.tap": PASSING_TAP });
    mkdirSync(join(repo, "closers"));
    writeFileSync(join(repo, MODULE_PATH), source);
    const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-custom-close-tree-")), "wt") };
    const closerRef: CloserRef = { type: "custom", modulePath: MODULE_PATH };
    await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef, closerRef }, budgets);
    const pinned = (await load(dir)).header.closerRef;
    if (!pinned) throw new Error("the closer reference was not pinned");
    return { dir, location, ports: { agent: worker, triage: deterministicRouter, closer: resolveCloser(pinned, repo) } };
  }

  it("closes an accepted surface with the project's closer, recording the closer's own report", async () => {
    const { dir, location, ports } = await surfaceWithCustomCloser(
      `export default { async close(ctx, outcome) { return { status: "DONE", detail: "project closer: " + outcome.kind + " " + ctx.branch + " onto " + ctx.baseBranch }; } };`,
    );

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    const caseFile = await load(dir);
    const detail = "project closer: accepted surface/surface-7 onto main";
    expect(caseFile.outcome?.reason).toBe(detail);
    expect(await closeReports(dir, caseFile.history)).toEqual([{ status: "DONE", detail }]);
  });

  it("sends a closer that throws to close-triage with an error naming the module, instead of crashing", async () => {
    const { dir, location, ports } = await surfaceWithCustomCloser(
      `export default { async close() { throw new Error("the notification service is unreachable"); } };`,
    );
    let step: AdvanceResult;
    do {
      step = await advance(dir, location, ports);
    } while (step.state !== "CLOSING" && !step.done);
    expect(step.state).toBe("CLOSING");

    step = await advance(dir, location, ports);

    expect(step).toEqual({ state: "TRIAGE", done: false });
    const caseFile = await load(dir);
    const [report] = (await closeReports(dir, caseFile.history)) as { status: string; detail: string }[];
    expect(report?.status).toBe("ERROR");
    expect(report?.detail).toContain(MODULE_PATH);
    expect(report?.detail).toContain("the notification service is unreachable");
  });
});

describe("an accepted surface closed by opening a pull request", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ends CLOSED with its branch pushed, a pull request against the base branch, and the address as its report", async () => {
    const standIn = createGhStandIn();
    vi.stubEnv("PATH", `${standIn.binDir}${delimiter}${process.env.PATH ?? ""}`);
    const dir = await mkdtemp(join(tmpdir(), "surface-close-case-"));
    const repo = initTempRepo("surface-close-repo-", { "report.tap": PASSING_TAP });
    const origin = addLocalOrigin(repo);
    const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-close-tree-")), "wt") };
    const closerRef: CloserRef = { type: "open-pr" };
    await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef, closerRef }, budgets);
    const pinned = (await load(dir)).header.closerRef;
    if (!pinned) throw new Error("closerRef was not pinned");

    const result = await run(dir, location, {
      agent: worker,
      triage: deterministicRouter,
      closer: resolveCloser(pinned, repo),
    });

    expect(result.state).toBe("CLOSED");
    expect((await load(dir)).outcome?.reason).toBe("https://github.com/example/project/pull/1");
    expect(git(origin, ["show", `${BRANCH}:feature.txt`])).toBe("the feature");
    expect(standIn.pullRequests()).toEqual([expect.objectContaining({ head: BRANCH, base: "main" })]);
    expect(existsSync(location.worktreePath)).toBe(true);
  });
});
