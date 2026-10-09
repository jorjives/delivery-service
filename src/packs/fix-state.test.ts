import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, setBaseBranch, setOutcome } from "../case-file.js";
import type { Plain } from "../report/document.js";
import { attempt, closedAt, recordOf, snapshotOf, stoppedAt } from "../report/report-fixtures.js";
import { deriveReport } from "../report/derive.js";
import { runsRoot } from "../run-location.js";
import type { CaseFileOutcome, GateRef, TaskDef } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { FINDING_GATE_REF } from "./finding-gate.js";
import type { Finding } from "./finding.js";
import { carryOver, deriveFindings, fixTasks, hiddenByDefault, readFindingStates, fixRunsOf, lastWords, UNDECIDED, type EarlierChoice, type FindingState, type FixRun, type FixState } from "./fix-state.js";
import { fixTaskFor } from "./fix-task.js";
import { appendLedger, type LedgerEntry } from "./ledger.js";
import { guardListsFor } from "./guards.js";
import { loadReview, listReviews, type ReviewEntry, type SavedReview } from "./review-record.js";
import { FIX_PHASE_FINDINGS, sampleFinding, writeFixPhase, writeReview } from "./review-fixtures.js";
import type { RunRecord } from "../run-records.js";

const AT = "2026-10-05T10:00:00.000Z";
const NPM: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const A = sampleFinding();
const B = sampleFinding({ id: "111111111111", title: "Old payment code" });
const NOTHING_UNCHECKABLE = (): boolean => false;
const NOTHING_EARLIER: ReadonlyMap<string, EarlierChoice> = new Map();
const decide = (ids: string[], choice: "approve" | "skip"): LedgerEntry => ({ t: "decision", at: AT, ids, choice });
const authorise = (ids: string[]): LedgerEntry => ({ t: "authorise", at: AT, ids, verify: NPM });
const plain = (audience: Plain["audience"]): Plain => ({ group: audience === "engineer" ? "needs_an_engineer" : "needs_your_decision", audience, sentence: "s", agentSaid: null, next: [] });
const run = (over: Partial<FixRun>): FixRun => ({ run: "r", standing: "unfinished", closer: "merge-back", plain: null, rounds: [], branch: null, base: null, said: null, ...over });

describe("where each problem stands", () => {
  it("is not yet decided until the owner says, and the owner's latest choice wins", () => {
    expect(deriveFindings([A, B], [], new Map(), NOTHING_UNCHECKABLE, NOTHING_EARLIER).map((s) => s.state)).toEqual(["proposed", "proposed"]);
    expect(deriveFindings([A, B], [decide([A.id, B.id], "approve"), decide([B.id], "skip")], new Map(), NOTHING_UNCHECKABLE, NOTHING_EARLIER).map((s) => s.state)).toEqual(["approved", "skipped"]);
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
    expect(deriveFindings([A], [decide([A.id], "approve"), authorise([A.id])], fixes, NOTHING_UNCHECKABLE, NOTHING_EARLIER)[0]).toEqual({ state, fix, refused: false, cause: null, signOff: null, earlier: null });
  });

  it("is already fixed when its code was gone before its fix started, whatever else is recorded", () => {
    const entries: LedgerEntry[] = [decide([A.id], "approve"), authorise([A.id]), { t: "fix_observed", at: AT, id: A.id, outcome: "already_resolved", commit: "c" }];
    expect(deriveFindings([A], entries, new Map(), NOTHING_UNCHECKABLE, NOTHING_EARLIER)[0]?.state).toBe("already_resolved");
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

  it("name the review they were authorised from, so a problem found again in a later review is fixed again rather than matched to its earlier fix", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    await writeReview(repo, { reviewId: "code-20261001T100000Z", findings: [A] });
    await writeReview(repo, { reviewId: "code-20261005T101500Z", findings: [A] });
    const [later, earlier] = await listReviews(repo);
    if (later?.state !== "done" || earlier?.state !== "done") throw new Error("no review");
    const tasksOf = async (entry: Extract<ReviewEntry, { state: "done" }>, review: string) =>
      fixTasks(await loadReview(entry), [decide([A.id], "approve"), { t: "authorise", at: AT, ids: [A.id], verify: NPM, review }]);

    const [first] = await tasksOf(earlier, "code-20261001T100000Z");
    const [second] = await tasksOf(later, "code-20261005T101500Z");

    expect(first).toEqual(fixTaskFor("code", A, NPM, undefined, undefined, "code-20261001T100000Z"));
    expect(first?.tags.review).toBe("code-20261001T100000Z");
    expect(second).not.toEqual(first);
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
    expect(deriveFindings([A], [decide([A.id], "approve"), authorise([A.id])], new Map([[A.id, fix]]), NOTHING_UNCHECKABLE, NOTHING_EARLIER)[0]).toMatchObject({ refused, cause });
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
    const closed = { run: "r", standing: "closed" as const, closer: "commit-to-branch" as const, plain: null, rounds: [], branch: "surface/r", base: "main", said: null };
    const held: LedgerEntry = { t: "authorise", at: AT, ids: [A.id], verify: NPM, threshold: "high", hold: { [A.id]: true }, landing: { type: "merge-back" } };
    expect(deriveFindings([A], [decide([A.id], "approve"), held], new Map([[A.id, closed]]), NOTHING_UNCHECKABLE, NOTHING_EARLIER)[0]?.state).toBe("held");
    expect(deriveFindings([A], [decide([A.id], "approve"), { ...held, hold: { [A.id]: false } }], new Map([[A.id, closed]]), NOTHING_UNCHECKABLE, NOTHING_EARLIER)[0]?.state).toBe("fixed");
  });

  it("gives each fix task the release it was authorised with", () => {
    const review = { header: { pack: { name: "security", categories: [], guards: undefined } }, result: { findings: [A], unconfirmed: [], notShown: 0, notes: "" } } as unknown as SavedReview;
    const entries: LedgerEntry[] = [decide([A.id], "approve"), { t: "authorise", at: AT, ids: [A.id], verify: NPM, threshold: "high", hold: { [A.id]: true }, landing: { type: "merge-back" } }];
    expect(fixTasks(review, entries)[0]?.authorisation).toEqual({ verify: NPM, hold: true, landing: { type: "merge-back" } });
  });

  it.each<[LedgerEntry[], FixState]>([
    [[], "held"],
    [[{ t: "signed_off", at: AT, id: A.id } as const], "held"],
    [[{ t: "landed", at: AT, id: A.id, commit: "abc", closer: { type: "merge-back" } as const } as const], "signed_off_landed"],
    [[{ t: "not_landed", at: AT, id: A.id, reason: "check_failed" as const, detail: "npm test" } as const], "signed_off_failed"],
    [[{ t: "rejected", at: AT, id: A.id } as const], "rejected"],
  ])("a held fix after %j is %s", (after, state) => {
    const closed = { run: "r", standing: "closed" as const, closer: "commit-to-branch" as const, plain: null, rounds: [], branch: "surface/r", base: "main", said: null };
    const held: LedgerEntry = { t: "authorise", at: AT, ids: [A.id], verify: NPM, threshold: "high", hold: { [A.id]: true }, landing: { type: "merge-back" } };
    const [at] = deriveFindings([A], [decide([A.id], "approve"), held, ...after], new Map([[A.id, closed]]), NOTHING_UNCHECKABLE, NOTHING_EARLIER);
    expect(at?.state).toBe(state);
    expect(at?.signOff).toEqual(after.find((entry) => entry.t !== "signed_off") ?? null);
  });
});

/** A fix's run record as a report reads it: the task it ran is the fix task itself, tags and all. */
const fixRecord = (task: TaskDef, over: Parameters<typeof recordOf>[0]): RunRecord => {
  const record = recordOf(over);
  return { ...record, caseFile: { ...record.caseFile, header: { ...record.caseFile.header, taskDef: task } } };
};

describe("each problem's fix, read from one snapshot", () => {
  const task = fixTaskFor("code", A, NPM);

  it("is the report's telling of its task, with what each check round newly failed and the agent's last finished words", () => {
    const record = fixRecord(task, {
      runId: "fix-a-20261005T110000Z",
      task: task.intent,
      history: [
        ...attempt(1, "first go"),
        { t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "finding:0123456789ab:resolved", detailRef: "g1" }] },
        ...attempt(2, "Clamped the total at zero."),
      ],
      outcome: closedAt("2026-10-05T11:05:00.000Z"),
    });
    const snapshot = snapshotOf({ list: [task], records: [record] });

    const fixes = fixRunsOf(snapshot, deriveReport(snapshot));

    expect(fixes.get(A.id)).toMatchObject({ run: "fix-a-20261005T110000Z", standing: "closed", rounds: [["finding:0123456789ab:resolved"]], said: "Clamped the total at zero." });
  });

  it("is waiting to start, with no rounds and no words, before its run exists", () => {
    const snapshot = snapshotOf({ list: [task] });
    expect(fixRunsOf(snapshot, deriveReport(snapshot)).get(A.id)).toMatchObject({ run: null, standing: "not_started", rounds: [], said: null });
  });

  it("leaves out a task that is not a problem's fix", () => {
    const snapshot = snapshotOf({ list: [{ intent: "Add a contact form" }] });
    expect(fixRunsOf(snapshot, deriveReport(snapshot)).size).toBe(0);
  });
});

describe("the agent's last words on a fix", () => {
  it("are its last finished attempt's, never a repair's or an attempt that gave up", () => {
    expect(lastWords([...attempt(1, "Moved the key."), ...attempt(2, "I cannot go on.", "exhaustion")])).toBe("Moved the key.");
    expect(lastWords(attempt(1, "I cannot go on.", "exhaustion"))).toBeNull();
    expect(lastWords([{ t: "terminus", role: "gate-maintenance", attempt: 1, sessionKey: "g", status: "completed", rationale: "put the helper back" }])).toBeNull();
  });
});

describe("a problem nobody has decided on", () => {
  it("is not yet decided, with no fix", () => {
    expect(UNDECIDED).toEqual({ state: "proposed", fix: undefined, refused: false, cause: null, signOff: null, earlier: null });
  });
});

describe("a problem with no specific check where one is needed", () => {
  const blocked = (finding: Finding): boolean => finding.id === B.id;

  it("needs the owner's decision, and is never just not yet decided or approved", () => {
    expect(deriveFindings([A, B], [], new Map(), blocked, NOTHING_EARLIER).map((at) => at.state)).toEqual(["proposed", "needs_decision"]);
    expect(deriveFindings([A, B], [decide([A.id, B.id], "approve")], new Map(), blocked, NOTHING_EARLIER).map((at) => at.state)).toEqual(["approved", "needs_decision"]);
  });

  it("is skipped when the owner skips it", () => {
    expect(deriveFindings([B], [decide([B.id], "skip")], new Map(), blocked, NOTHING_EARLIER).map((at) => at.state)).toEqual(["skipped"]);
  });

  it("is approved once the owner approves it without a check", () => {
    const blocked = (finding: Finding): boolean => finding.id === B.id;
    const anyway: LedgerEntry = { t: "decision", at: AT, ids: [B.id], choice: "approve", allowUnchecked: true };
    expect(deriveFindings([B], [anyway], new Map(), blocked, NOTHING_EARLIER).map((at) => at.state)).toEqual(["approved"]);
  });
});

describe("what earlier reviews carry", () => {
  const S = (state: FixState): FindingState => ({ ...UNDECIDED, state });
  const C = sampleFinding({ id: "222222222222" });
  const D = sampleFinding({ id: "333333333333" });

  it("carries a skip, a decline and a fix; a later decided state wins, and an undecided one keeps what came before", () => {
    const older = { findings: [A, B, C, D], states: [S("skipped"), S("rejected"), S("fixed"), S("approved")] };
    const newer = { findings: [A, B, C], states: [S("proposed"), S("approved"), S("needs_decision")] };
    expect(carryOver([older, newer])).toEqual(new Map([[A.id, "skipped"], [C.id, "fixed"]]));
  });

  it.each([
    ["skipped", "skipped"],
    ["rejected", "declined"],
    ["fixed", "fixed"],
    ["signed_off_landed", "fixed"],
    ["already_resolved", "fixed"],
  ] as const)("carries %s as %s", (state, carried) => {
    expect(carryOver([{ findings: [A], states: [S(state)] }]).get(A.id)).toBe(carried);
  });

  it.each(["approved", "fixing", "held", "unfixable", "stopped", "signed_off_failed"] as const)("carries nothing for %s", (state) => {
    expect(carryOver([{ findings: [A], states: [S("skipped")] }, { findings: [A], states: [S(state)] }]).has(A.id)).toBe(false);
  });

  it("carries nothing for a fix that only opened a pull request, since its flagged code was never removed", () => {
    const opened = { ...S("fixed"), fix: { closer: "open-pr" } as FixRun };
    expect(carryOver([{ findings: [A], states: [opened] }]).has(A.id)).toBe(false);
  });

  it("keeps an earlier skip or decline as skipped and offers a problem fixed earlier again as come back, until this review decides", () => {
    const earlier = new Map<string, EarlierChoice>([[A.id, "skipped"], [B.id, "declined"], [C.id, "fixed"]]);
    const read = (entries: LedgerEntry[]) => deriveFindings([A, B, C], entries, new Map(), NOTHING_UNCHECKABLE, earlier).map(({ state, earlier: e }) => [state, e]);
    expect(read([])).toEqual([["skipped", "skipped"], ["skipped", "declined"], ["proposed", "fixed"]]);
    expect(read([decide([A.id, C.id], "approve")])).toEqual([["approved", null], ["skipped", "declined"], ["approved", null]]);
  });

  it("never offers again a problem fixed earlier that this review did not find", () => {
    // A review lists only problems whose flagged code it found (confirm.test.ts: "flagged code that is not in the file" is not offered),
    // so a fixed problem whose code is still gone is never in the list, whatever earlier reviews carry.
    const states = deriveFindings([A], [], new Map(), NOTHING_UNCHECKABLE, new Map<string, EarlierChoice>([[D.id, "fixed"]]));
    expect(states).toEqual([UNDECIDED]);
  });

  it("hides by default only a problem skipped because of an earlier review", () => {
    expect(hiddenByDefault({ ...S("skipped"), earlier: "declined" })).toBe(true);
    expect(hiddenByDefault(S("skipped"))).toBe(false);
    expect(hiddenByDefault({ ...S("proposed"), earlier: "fixed" })).toBe(false);
  });

  it("reads what earlier reviews of the same pack decided, and nothing from another pack's", async () => {
    const repo = initTempRepo("fix-state-", { "a.js": "x\n" });
    // Security review 1: problem 1 waiting for sign-off, 2 and 3 merged, 4 could not be fixed, 5 stopped, 6 skipped.
    const first = await writeFixPhase(repo);
    await appendLedger(first, { t: "rejected", id: FIX_PHASE_FINDINGS[0]?.id ?? "" });
    // A code review in between skips problem 4: another pack, so it carries nothing to a security review.
    const code = await writeReview(repo, { reviewId: "code-20261008T090000Z", findings: FIX_PHASE_FINDINGS });
    await appendLedger(code, { t: "decision", ids: [FIX_PHASE_FINDINGS[3]?.id ?? ""], choice: "skip" });
    await writeReview(repo, { reviewId: "security-20261009T100000Z", findings: FIX_PHASE_FINDINGS, pack: { title: "Security review", hold: "high", consequenceLabel: "what-could-happen" } });
    const [latest] = await listReviews(repo);
    if (latest?.state !== "done") throw new Error("no review");

    const { states } = await readFindingStates(repo, await loadReview(latest));

    expect(states.map(({ state, earlier }) => [state, earlier])).toEqual([
      ["skipped", "declined"],
      ["proposed", "fixed"],
      ["proposed", "fixed"],
      ["proposed", null],
      ["proposed", null],
      ["skipped", "skipped"],
    ]);
  });
});
