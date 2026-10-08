import { mkdir } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, setBaseBranch, setOutcome } from "../case-file.js";
import { runsRoot } from "../run-location.js";
import { attempt, closedAt, failedCheck, stoppedAt } from "../report/report-fixtures.js";
import { FORBIDDEN } from "../report/report-fixtures.js";
import type { CaseFileOutcome, GateRef, HistoryEntry, TaskDef } from "../schema.js";
import type { MockExpectation, MockScript } from "../mock-script.js";
import { initTempRepo } from "../temp-repo.js";
import type { Finding, Unconfirmed, ScanEnvelope } from "./finding.js";
import { FINDING_CLOSER_REF } from "./finding-closer.js";
import { fixTasks } from "./fix-state.js";
import { appendLedger, readLedger } from "./ledger.js";
import { planConfig, writePlan } from "./plan.js";
import { listReviews, loadReview, saveResult, startReview, type PinnedPack, type ReviewHeader } from "./review-record.js";

/** Test and demo support: the example project with planted flaws. */
export const EXAMPLE_DIR = fileURLToPath(new URL("../../examples/code-review-example/", import.meta.url));

/** A fresh git repository holding the example's files in one commit on `main`. */
export function exampleRepo(prefix = "code-review-example-"): string {
  const files = Object.fromEntries(readdirSync(EXAMPLE_DIR).map((name) => [name, readFileSync(join(EXAMPLE_DIR, name), "utf-8")]));
  return initTempRepo(prefix, files);
}

/** What a code review of the example finds, as the agent would reply: three real problems, and one about a file that is not there. */
export const EXAMPLE_SCAN: ScanEnvelope = {
  findings: [
    {
      title: "The price shown at checkout can be negative",
      category: "correctness",
      severity: "high",
      where: { path: "checkout.js" },
      problem: "A discount larger than the price makes the total negative, so the shop would pay the customer.",
      whyItMatters: "Wrong totals cost money and trust.",
      fixedLooksLike: "A total never goes below zero.",
      anchor: "return price - discount;",
      check: { kind: "anchor-gone" },
      detail: "total() subtracts without a floor; clamp with Math.max(0, price - discount).",
    },
    {
      title: "A missing or broken settings file stops the shop with an unhelpful error",
      category: "error-handling",
      severity: "medium",
      where: { path: "settings.js" },
      problem: "If the settings file is missing or not valid, the shop stops with a technical error instead of saying which file is wrong.",
      whyItMatters: "Whoever runs the shop cannot tell what to fix.",
      fixedLooksLike: "A missing or broken settings file gives a clear message naming the file.",
      anchor: 'return JSON.parse(readFileSync(path, "utf-8"));',
      check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["settings.js"] },
    },
    {
      title: "Old code for a payment provider you no longer use",
      category: "dead-code",
      severity: "low",
      where: { path: "legacy-gateway.js" },
      problem: "Nothing calls this file any more.",
      whyItMatters: "It is extra code to look after, and it could confuse the next person.",
      fixedLooksLike: "The file is removed and everything still works.",
      anchor: "export function chargeWithLegacyGateway(card, amount) {",
      check: { kind: "none" },
    },
    {
      title: "Prices are rounded the wrong way",
      category: "correctness",
      severity: "medium",
      where: { path: "pricing.js" },
      problem: "Prices are rounded down.",
      whyItMatters: "Totals come out a penny short.",
      fixedLooksLike: "Prices are rounded to the nearest penny.",
      anchor: "return Math.floor(price * 100) / 100;",
      check: { kind: "anchor-gone" },
    },
  ],
  notes: "",
};

/** The password planted in the example's payments.js: what no output may ever show. */
export const PAYMENTS_PASSWORD = "pay-live-7Hq2xV9rLm4K";

/** A scripted security review of the example: a critical password in the code, and a library version with a known weakness. */
export const EXAMPLE_SECURITY_SCAN: ScanEnvelope = {
  findings: [
    {
      title: "A password for the payments service is written in the code",
      category: "secrets",
      severity: "critical",
      where: { path: "payments.js" },
      problem: "The password the shop uses to take payments is written into payments.js.",
      whyItMatters: "Anyone who can read this code can use the payments service as you, including people who should not see it, such as past contractors.",
      fixedLooksLike: "The password is not in the code, and the code reads it from somewhere private instead.",
      anchor: `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`,
      check: { kind: "anchor-gone" },
      outsideStep: "The password has already been seen by everyone with access to the project: change it at the payments provider. Only a person can do that.",
    },
    {
      title: "An old version of the minimist library with a known weakness",
      category: "dependencies",
      severity: "medium",
      where: { path: "package-lock.json" },
      problem: "The project installs minimist 1.2.5, which lets specially made input change how every object in the program behaves.",
      whyItMatters: "Someone who controls that input could make the shop misbehave in ways that are hard to spot. Nothing in the shop passes outside input to it today.",
      fixedLooksLike: "minimist is at version 1.2.6 or later.",
      anchor: '"node_modules/minimist": {',
      check: { kind: "dependency-absent", package: "minimist", version: "1.2.5" },
    },
  ],
  notes: "",
};

/** A claude-mock script whose one session replies with `envelope`. */
export function scanScript(envelope: unknown, extra: Partial<MockExpectation> = {}): MockScript {
  return { expectations: [{ json: envelope, ...extra }] };
}

/** Test support: one confirmed problem, as a finished review holds it. */
export function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "0123456789ab",
    title: "The price shown at checkout can be negative",
    category: "correctness",
    severity: "high",
    where: { path: "checkout.js", line: 3, endLine: 3 },
    problem: "A discount larger than the price makes the total negative.",
    whyItMatters: "Wrong totals cost money and trust.",
    fixedLooksLike: "A total never goes below zero.",
    anchor: "return price - discount;",
    check: { kind: "anchor-gone" },
    source: "reviewer",
    ...overrides,
  };
}

/** Test support: a code review's record on disk, exactly as a review leaves it, without an agent. `finished: false` stops before the list is saved. */
export async function writeReview(
  repoPath: string,
  {
    reviewId = "code-20261005T101500Z",
    findings = [],
    unconfirmed = [],
    notShown = 0,
    finished = true,
    pack = {},
  }: { reviewId?: string; findings?: Finding[]; unconfirmed?: Unconfirmed[]; notShown?: number; finished?: boolean; pack?: Partial<PinnedPack> } = {},
): Promise<string> {
  const header: ReviewHeader = {
    reviewId,
    pack: {
      name: reviewId.split("-")[0] ?? "code",
      version: "1.0.0",
      title: "Code review",
      hash: "0".repeat(64),
      maxFindings: 40,
      categories: [{ id: "correctness", title: "Wrong results" }, { id: "error-handling", title: "Missing handling of things going wrong" }, { id: "dead-code", title: "Code nothing uses" }],
      ...pack,
    },
    repoPath,
    commit: "1".repeat(40),
    fileCount: 4,
    startedAt: "2026-10-05T10:15:00.000Z",
    endedAt: "2026-10-05T10:19:12.000Z",
  };
  const dir = await startReview(repoPath, header, { envelope: { findings: [], notes: "" } });
  if (finished) await saveResult(dir, { findings, unconfirmed, notShown, notes: "" });
  return dir;
}

const [SECRET, LIBRARY] = EXAMPLE_SECURITY_SCAN.findings;

/** What an honest agent does with the example's security problems: reads the password from the environment, and moves minimist to a version without the weakness. */
export const SECURITY_FIXES: MockScript = {
  expectations: [
    {
      when: { promptContains: SECRET?.title ?? "" },
      effects: [{ edit: { path: "payments.js", old: `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, new: "const PAYMENTS_PASSWORD = process.env.PAYMENTS_PASSWORD;" } }],
      json: { status: "completed", rationale: "The password is read from PAYMENTS_PASSWORD in the environment." },
    },
    {
      when: { promptContains: LIBRARY?.title ?? "" },
      effects: [
        { edit: { path: "package-lock.json", old: '"version": "1.2.5"', new: '"version": "1.2.6"' } },
        { edit: { path: "package-lock.json", old: '"minimist": "1.2.5"', new: '"minimist": "1.2.6"' } },
        { edit: { path: "package.json", old: '"minimist": "1.2.5"', new: '"minimist": "1.2.6"' } },
      ],
      json: { status: "completed", rationale: "minimist is at 1.2.6." },
    },
  ],
};

const [CHECKOUT, SETTINGS, GATEWAY] = EXAMPLE_SCAN.findings;
const EXAMPLE_TEST = readFileSync(join(EXAMPLE_DIR, "checkout.test.js"), "utf-8");

/**
 * Demo and test support: a fix agent that cheats on two of the example's three
 * real problems (deletes the test; skips it and changes the test script),
 * makes the honest minimal test edit on the third, and, told its fix was
 * refused, gives up. The retry is first so it wins over the cheat once a
 * refusal is in the prompt.
 */
export const CHEATING_FIXES: MockScript = {
  expectations: [
    { when: { promptContains: "\n- guard:" }, json: { status: "escalate", category: "authority", rationale: "The tests would have to change for this fix to pass." } },
    {
      when: { promptContains: CHECKOUT?.title ?? "" },
      effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }, { delete: { path: "checkout.test.js" } }],
      json: { status: "completed", rationale: "clamped the total and removed a test that no longer applied" },
    },
    {
      when: { promptContains: SETTINGS?.title ?? "" },
      effects: [
        { edit: { path: "settings.js", old: 'return JSON.parse(readFileSync(path, "utf-8"));', new: 'const text = readFileSync(path, "utf-8");\n  return JSON.parse(text);' } },
        { write: { path: "checkout.test.js", content: EXAMPLE_TEST.replace("test(", "test.skip(") } },
        { write: { path: "package.json", content: '{\n  "name": "code-review-example",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test || true" }\n}\n' } },
      ],
      json: { status: "completed", rationale: "read the file first, skipped a slow test and made the tests more forgiving" },
    },
    {
      // The honest move when only a test change would do: the smallest edit, and say so. It is refused, and the agent stops.
      when: { promptContains: GATEWAY?.title ?? "" },
      effects: [{ write: { path: "checkout.test.js", content: `${EXAMPLE_TEST}// the old gateway's totals are exact now\n` } }],
      json: { status: "completed", rationale: "Only a change to the test would cover the old gateway." },
    },
  ],
};

/** Words a review never says to its owner: the report's forbidden words, and the ones the task-packs vocabulary adds. Strip `delivery findings` (a command name) before matching. */
export const PACK_FORBIDDEN = new RegExp(
  `${FORBIDDEN.source}|\\b(findings?|assertions?|delta|anchors?|scanner|scan agent|lockfiles?|transitive|CVSS|CVEs?|exploits?|held|landed|closed)\\b`,
  "i",
);

const NPM_TEST: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** Test support: a security review's six problems, most serious first, as a fix phase leaves them. */
export const FIX_PHASE_FINDINGS: Finding[] = [
  sampleFinding({ id: "f00000000001", title: "A password for the payments service is written in the code", severity: "critical", whyItMatters: "Anyone who can read this code can use the payments service as you.", outsideStep: "Change the payments password at the provider." }),
  sampleFinding({ id: "f00000000002", title: "Settings errors are unhelpful", severity: "medium", check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync", paths: ["settings.js"] } }),
  sampleFinding({ id: "f00000000003", title: "Old payment code nothing uses", severity: "medium", check: { kind: "none" } }),
  sampleFinding({ id: "f00000000004", title: "The price shown at checkout can be negative", severity: "low" }),
  sampleFinding({ id: "f00000000005", title: "Totals are rounded the wrong way", severity: "low" }),
  sampleFinding({ id: "f00000000006", title: "Debug logging is left on", severity: "low" }),
];

/** One fix's run record, exactly as `delivery fix` leaves it: the fix task as its task, the harness's own check and closer pinned. */
async function writeFixRun(repo: string, runId: string, taskDef: TaskDef, history: HistoryEntry[], outcome: CaseFileOutcome | undefined): Promise<void> {
  const dir = join(runsRoot(repo), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef, gateRef: NPM_TEST, closerRef: FINDING_CLOSER_REF }, DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  for (const entry of history) await appendEntry(dir, entry);
  if (outcome !== undefined) await setOutcome(dir, outcome);
}

/**
 * Test support: the security review after its fix phase, as the records leave it, with no agent: problem 1 is fixed
 * and waiting for sign-off, 2 and 3 are merged, 4 could not be fixed, 5 was stopped by a check that could not run, and
 * 6 was skipped. `interrupted` leaves problem 5's fix with no outcome, as a fix phase stopped part way does. Returns the
 * review's folder.
 */
export async function writeFixPhase(repo: string, { interrupted = false }: { interrupted?: boolean } = {}): Promise<string> {
  const dir = await writeReview(repo, { reviewId: "security-20261005T101500Z", findings: FIX_PHASE_FINDINGS, pack: { title: "Security review", hold: "high", consequenceLabel: "what-could-happen" } });
  const ids = FIX_PHASE_FINDINGS.map((finding) => finding.id);
  const approved = ids.slice(0, 5);
  await appendLedger(dir, { t: "decision", ids: approved, choice: "approve" });
  await appendLedger(dir, { t: "decision", ids: ids.slice(5), choice: "skip" });
  await appendLedger(dir, { t: "authorise", ids: approved, verify: NPM_TEST, threshold: "high", hold: Object.fromEntries(approved.map((id, index) => [id, index === 0])), landing: { type: "merge-back" } });
  const [entry] = await listReviews(repo);
  if (entry?.state !== "done") throw new Error("the review was not written");
  const tasks = fixTasks(await loadReview(entry), await readLedger(dir));
  await writePlan(dir, planConfig(tasks, { gateRef: NPM_TEST, closerRef: { type: "merge-back" }, budgets: DEFAULT_BUDGETS, concurrency: 1 }, {}, undefined));
  const runs: [HistoryEntry[], CaseFileOutcome | undefined][] = [
    [attempt(1, "Read the key from PAYMENTS_KEY."), closedAt("2026-10-05T11:05:00.000Z")],
    [attempt(1, "Wrapped the settings read with a clear message."), closedAt("2026-10-05T11:08:00.000Z")],
    [attempt(1, "Removed the unused payment code."), closedAt("2026-10-05T11:11:00.000Z")],
    [[...attempt(1, "I could not find where the total is worked out."), ...failedCheck(1, "escalate")], stoppedAt("2026-10-05T11:15:00.000Z", { kind: "budget", population: "correction" })],
    [attempt(1, "Rounded half up."), interrupted ? undefined : stoppedAt("2026-10-05T11:19:00.000Z", { kind: "budget", population: "gateError" })],
  ];
  for (const [index, task] of tasks.entries()) {
    const [history, outcome] = runs[index] ?? [[], undefined];
    await writeFixRun(repo, `fix-${index + 1}-20261005T11${String(index).padStart(2, "0")}00Z`, task, history, outcome);
  }
  return dir;
}
