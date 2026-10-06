import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, setBaseBranch, setOutcome } from "../case-file.js";
import type { Plain } from "../report/document.js";
import { closedAt, stoppedAt } from "../report/report-fixtures.js";
import { runsRoot } from "../run-location.js";
import type { CaseFileOutcome, GateRef, TaskDef } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { FINDING_GATE_REF } from "./finding-gate.js";
import { deriveFindings, fixTasks, readFindingStates, type FixRun } from "./fix-state.js";
import { fixTaskFor } from "./fix-task.js";
import { appendLedger, type LedgerEntry } from "./ledger.js";
import { guardListsFor } from "./guards.js";
import { loadReview, listReviews } from "./review-record.js";
import { sampleFinding, writeReview } from "./review-fixtures.js";

const AT = "2026-10-05T10:00:00.000Z";
const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const A = sampleFinding();
const B = sampleFinding({ id: "111111111111", title: "Old payment code" });
const decide = (ids: string[], choice: "approve" | "skip"): LedgerEntry => ({ t: "decision", at: AT, ids, choice });
const authorise = (ids: string[]): LedgerEntry => ({ t: "authorise", at: AT, ids, verify: NPM });
const plain = (audience: Plain["audience"]): Plain => ({ group: audience === "engineer" ? "needs_an_engineer" : "needs_your_decision", audience, sentence: "s", agentSaid: null, next: [] });
const run = (over: Partial<FixRun>): FixRun => ({ run: "r", standing: "unfinished", closer: "merge-back", plain: null, rounds: [], branch: null, base: null, ...over });

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
    expect(deriveFindings([A], [decide([A.id], "approve"), authorise([A.id])], fixes)[0]).toEqual({ state, fix, refused: false, cause: null });
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

describe("the fix tasks", () => {
  it("carry the guards pinned with their authorisation, and whether the problem's fix changes tests", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    const TESTS_PROBLEM = sampleFinding({ id: "333333333333", category: "tests" });
    await writeReview(repo, { findings: [A, TESTS_PROBLEM] });
    const guards = guardListsFor(undefined);
    const entries: LedgerEntry[] = [decide([A.id, TESTS_PROBLEM.id], "approve"), { t: "authorise", at: AT, ids: [A.id, TESTS_PROBLEM.id], verify: NPM, guards }];
    const [entry] = await listReviews(repo);
    if (entry?.state !== "done") throw new Error("no review");
    const review = await loadReview(entry);
    const withTests = { ...review, header: { ...review.header, pack: { ...review.header.pack, categories: [...review.header.pack.categories, { id: "tests", title: "Tests", changesTests: true as const }] } } };

    expect(fixTasks(withTests, entries)).toEqual([
      fixTaskFor("code", A, NPM, { ...guards, testsCategory: false }),
      fixTaskFor("code", TESTS_PROBLEM, NPM, { ...guards, testsCategory: true }),
    ]);
  });

  it("carry no guards when the authorisation predates them, so the earlier fix's run is still recognised", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    await writeReview(repo, { findings: [A] });
    const [entry] = await listReviews(repo);
    if (entry?.state !== "done") throw new Error("no review");
    expect(fixTasks(await loadReview(entry), [decide([A.id], "approve"), authorise([A.id])])).toEqual([fixTaskFor("code", A, NPM)]);
  });
});

describe("reading gate rounds and refusals", () => {
  // The cause is the one deterministic signal: unfixable, and the last round refused only a modified existing test.
  it.each([
    [[["guard:tests-untouched"], []], "closed", true, null],
    [[["guard:tests-unchanged"]], "escalated", true, "needs_test_change"],
    [[["guard:tests-unchanged", "finding:0123456789ab:resolved"]], "escalated", true, "needs_test_change"],
    [[["guard:tests-unchanged"], ["guard:tests-unchanged"]], "escalated", true, "needs_test_change"],
    [[["guard:tests-untouched"]], "escalated", true, null], // deleted a test, then gave up: a cheat, not a need
    [[["guard:tests-unchanged", "guard:no-skips"]], "escalated", true, null], // skipped a test, then gave up
    [[["guard:tests-unchanged", "guard:check-untouched"]], "escalated", true, null],
    [[["guard:tests-unchanged", "guard:ignored:vitest.config.ts"]], "escalated", true, null],
    [[["guard:tests-unchanged"], ["finding:0123456789ab:resolved"]], "escalated", true, null], // the last round was something else
    [[["guard:check-untouched"]], "escalated", true, null],
    [[["finding:0123456789ab:resolved"]], "escalated", false, null],
  ])("reads refusals from its fix's gate rounds: %j ending %s", (rounds, standing, refused, cause) => {
    const fix = run({ standing: standing as FixRun["standing"], plain: standing === "closed" ? null : plain("owner"), rounds });
    expect(deriveFindings([A], [decide([A.id], "approve"), authorise([A.id])], new Map([[A.id, fix]]))[0]).toMatchObject({ refused, cause });
  });

  it("appends a gate entry to the fix and reads the refusal", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    const dir = await writeReview(repo, { findings: [A, B] });
    await appendLedger(dir, { t: "decision", ids: [A.id, B.id], choice: "approve" });
    await appendLedger(dir, { t: "authorise", ids: [A.id, B.id], verify: NPM });
    await fixRun(repo, "fix-a-20261005T110000Z", fixTaskFor("code", A, NPM), closedAt("2026-10-05T11:05:00.000Z"));
    await fixRun(repo, "fix-b-20261005T110100Z", fixTaskFor("code", B, NPM), stoppedAt("2026-10-05T11:06:00.000Z", undefined));
    await appendEntry(join(runsRoot(repo), "fix-b-20261005T110100Z"), { t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "guard:tests-unchanged", detailRef: "g1" }], class: "fail" });
    const [entry] = await listReviews(repo);
    if (entry?.state !== "done") throw new Error("no review");

    const { states } = await readFindingStates(repo, await loadReview(entry));

    expect(states[1]).toMatchObject({ refused: true, cause: "needs_test_change" });
    expect(states[0]).toMatchObject({ refused: false, cause: null });
  });
});

describe("holding fixes for sign-off", () => {
  it("is waiting for sign-off when a held fix has passed, and fixed when one that is not held has", () => {
    const closed = { run: "r", standing: "closed" as const, closer: "commit-to-branch" as const, plain: null, rounds: [], branch: "surface/r", base: "main" };
    const held = { t: "authorise" as const, at: AT, ids: [A.id], verify: NPM, threshold: "high" as const, hold: { [A.id]: true }, landing: { type: "merge-back" } };
    expect(deriveFindings([A], [decide([A.id], "approve"), held as any], new Map([[A.id, closed]]))[0]?.state).toBe("held");
    expect(deriveFindings([A], [decide([A.id], "approve"), { ...held, hold: { [A.id]: false } } as any], new Map([[A.id, closed]]))[0]?.state).toBe("fixed");
  });

  it("gives each fix task the release it was authorised with", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    const entry = await writeReview(repo, { findings: [A] });
    const entries: LedgerEntry[] = [decide([A.id], "approve"), { t: "authorise", at: AT, ids: [A.id], verify: NPM, threshold: "high" as any, hold: { [A.id]: true }, landing: { type: "merge-back" } }];
    expect(fixTasks(await loadReview(entry), entries as any)[0]?.authorisation).toEqual({ verify: NPM, hold: true, landing: { type: "merge-back" } });
  });
});
