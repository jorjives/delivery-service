import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setBaseBranch, setOutcome } from "../case-file.js";
import type { Plain } from "../report/document.js";
import { closedAt, stoppedAt } from "../report/report-fixtures.js";
import { runsRoot } from "../run-location.js";
import type { CaseFileOutcome, GateRef, TaskDef } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { FINDING_GATE_REF } from "./finding-gate.js";
import { deriveFindings, readFindingStates, type FixRun } from "./fix-state.js";
import { fixTaskFor } from "./fix-task.js";
import { appendLedger, type LedgerEntry } from "./ledger.js";
import { loadReview, listReviews } from "./review-record.js";
import { sampleFinding, writeReview } from "./review-fixtures.js";

const AT = "2026-10-05T10:00:00.000Z";
const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const A = sampleFinding();
const B = sampleFinding({ id: "111111111111", title: "Old payment code" });
const decide = (ids: string[], choice: "approve" | "skip"): LedgerEntry => ({ t: "decision", at: AT, ids, choice });
const authorise = (ids: string[]): LedgerEntry => ({ t: "authorise", at: AT, ids, verify: NPM });
const plain = (audience: Plain["audience"]): Plain => ({ group: audience === "engineer" ? "needs_an_engineer" : "needs_your_decision", audience, sentence: "s", agentSaid: null, next: [] });
const run = (over: Partial<FixRun>): FixRun => ({ run: "r", standing: "unfinished", closer: "merge-back", plain: null, ...over });

describe("where each problem stands", () => {
  it("is not yet decided until the owner says, and the owner's latest choice wins", () => {
    expect(deriveFindings([A, B], [], new Map()).map((s) => s.state)).toEqual(["proposed", "proposed"]);
    expect(deriveFindings([A, B], [decide([A.id, B.id], "approve"), decide([B.id], "skip")], new Map()).map((s) => s.state)).toEqual(["approved", "skipped"]);
  });

  it.each([
    [undefined, "fixing"],
    [run({ standing: "not_started", run: null }), "fixing"],
    [run({ standing: "unfinished" }), "fixing"],
    [run({ standing: "closed" }), "fixed"],
    [run({ standing: "escalated", plain: plain("owner") }), "unfixable"],
    [run({ standing: "aborted", plain: plain("owner") }), "unfixable"],
    [run({ standing: "escalated", plain: plain("engineer") }), "stopped"],
    [run({ standing: "aborted", plain: plain("engineer") }), "stopped"],
  ])("once authorised, follows its fix's run: %j is %s", (fix, state) => {
    const fixes = new Map(fix === undefined ? [] : [[A.id, fix]]);
    expect(deriveFindings([A], [decide([A.id], "approve"), authorise([A.id])], fixes)[0]).toEqual({ state, fix });
  });

  it("is already fixed when its code was gone before its fix started, whatever else is recorded", () => {
    const entries: LedgerEntry[] = [decide([A.id], "approve"), authorise([A.id]), { t: "fix_observed", at: AT, id: A.id, outcome: "already_resolved", commit: "c" }];
    expect(deriveFindings([A], entries, new Map())[0]?.state).toBe("already_resolved");
  });
});

async function fixRun(repo: string, runId: string, taskDef: TaskDef, outcome: CaseFileOutcome): Promise<void> {
  const dir = join(runsRoot(repo), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef, gateRef: FINDING_GATE_REF, closerRef: { type: "merge-back" } }, DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  await setOutcome(dir, outcome);
}

describe("where each problem stands, read from the project", () => {
  it("matches each authorised problem to its fix's run by the task it ran", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    const dir = await writeReview(repo, { findings: [A, B] });
    await appendLedger(dir, { t: "decision", ids: [A.id, B.id], choice: "approve" });
    await appendLedger(dir, { t: "authorise", ids: [A.id, B.id], verify: NPM });
    await fixRun(repo, "fix-a-20261005T110000Z", fixTaskFor("code", A, NPM), closedAt("2026-10-05T11:05:00.000Z"));
    await fixRun(repo, "fix-b-20261005T110100Z", fixTaskFor("code", B, NPM), stoppedAt("2026-10-05T11:06:00.000Z", undefined));
    const [entry] = await listReviews(repo);
    if (entry?.state !== "done") throw new Error("no review");

    const { tasks, states } = await readFindingStates(repo, await loadReview(entry));

    expect(tasks).toEqual([fixTaskFor("code", A, NPM), fixTaskFor("code", B, NPM)]);
    expect(states.map((s) => s.state)).toEqual(["fixed", "unfixable"]);
    expect(states[0]?.fix).toMatchObject({ run: "fix-a-20261005T110000Z", closer: "merge-back" });
  });
});
