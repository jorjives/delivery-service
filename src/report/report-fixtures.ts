import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, initialCaseFile, setBaseBranch, setOutcome } from "../case-file.js";
import { runsRoot } from "../run-location.js";
import type { RunRecord } from "../run-records.js";
import type { CaseFileOutcome, CloserRef, CreateHeader, GateRef, HistoryEntry, OutcomeCause, RunEntry, RunFile, RunOutcome } from "../schema.js";
import type { RecordSnapshot } from "./snapshot.js";

/** Test support: one task's run, as much of it as a report reads. No `outcome` leaves it unfinished. */
export interface TaskRun {
  runId: string;
  task: string;
  history?: HistoryEntry[];
  outcome?: CaseFileOutcome;
  /** Absent: no closer pinned, as in a record from before closers were. */
  closerRef?: CloserRef;
}

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

const headerOf = ({ runId, task, closerRef }: TaskRun): CreateHeader => ({
  surfaceId: runId,
  taskDef: { intent: task },
  gateRef: GATE,
  ...(closerRef ? { closerRef } : {}),
});

/** Test support: a run's record as `loadSnapshot` would read it, built in memory. */
export function recordOf(run: TaskRun, repoPath = "/repo"): RunRecord {
  const caseFile = initialCaseFile(headerOf(run), DEFAULT_BUDGETS);
  return {
    runId: run.runId,
    repoPath,
    dir: join(runsRoot(repoPath), run.runId),
    caseFile: { ...caseFile, header: { ...caseFile.header, baseBranch: "main" }, history: run.history ?? [], ...(run.outcome ? { outcome: run.outcome } : {}) },
  };
}

/** Test support: the same record on disk, written the way a run writes it. */
export async function writeRecord(repoPath: string, run: TaskRun): Promise<string> {
  const dir = join(runsRoot(repoPath), run.runId);
  await mkdir(dir, { recursive: true });
  await create(dir, headerOf(run), DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  for (const entry of run.history ?? []) await appendEntry(dir, entry);
  if (run.outcome) await setOutcome(dir, run.outcome);
  return dir;
}

/**
 * Test support: damage a record's log the way a bad disk does, in the middle. A
 * torn last line is not damage: the journal drops it, as after a crash.
 */
export async function damageLog(dir: string): Promise<void> {
  await writeFile(join(dir, "log.jsonl"), `this is not a log line\n${JSON.stringify(attempt(1, "x")[0])}\n`);
}

/** One session of the agent on the task: set to work, and how it ended in its own words. */
export function attempt(number: number, said: string, ending: "completed" | "authority" | "exhaustion" = "completed"): HistoryEntry[] {
  const sessionKey = `worker-${number}-0`;
  return [
    { t: "dispatch", role: "worker", attempt: number, sessionKey },
    ending === "completed"
      ? { t: "terminus", role: "worker", attempt: number, sessionKey, status: "completed", rationale: said }
      : { t: "terminus", role: "worker", attempt: number, sessionKey, status: "escalate", category: ending, rationale: said },
  ];
}

/** A check that failed after an attempt, and the round that sent the agent back or gave up. */
export function failedCheck(number: number, verdict: "reroute" | "escalate"): HistoryEntry[] {
  return [
    { t: "gate", attempt: number, status: "FAIL", newFailures: [{ id: "footer-links", detailRef: `gate-${number}` }] },
    { t: "triage", afterAttempt: number, trigger: "gate_fail", verdict, rationale: `gate_fail: ${verdict}`, artifactRef: `triage-${number - 1}` },
  ];
}

export const closedAt = (at: string): CaseFileOutcome => ({ kind: "closed", source: "closer", reason: "the closer accepted the work", at });

export const stoppedAt = (at: string, cause: OutcomeCause | undefined, reason = "recorded reason", kind: "escalated" | "aborted" = "escalated"): CaseFileOutcome => ({
  kind,
  source: "worker",
  reason,
  at,
  ...(cause ? { cause } : {}),
});

/** A run of several at once taking a task into a slot. */
export const fill = (slot: number, surfaceId: string, task: string): RunEntry => ({ t: "slot_fill", slot, surfaceId, taskDef: { intent: task } });

/** Test support: the record of a run of several at once, built in memory. No `outcome` leaves it unfinished. */
export function runFileOf(runId: string, history: RunEntry[], outcome?: RunOutcome): RunFile {
  const tasks = history.filter((entry) => entry.t === "slot_fill").length;
  return { header: { runId, repoPath: "/repo", concurrency: 2, tasks, runBudgetMax: { gateMaintenance: 2 } }, history, ...(outcome ? { outcome } : {}) };
}

/** The words the owner is never shown: the harness's own names for things. */
export const FORBIDDEN = /\b(surfaces?|budgets?|gates?|triage|authority|terminus|breaker|escalat\w*|workers?|router|slots?|populations?|degraded|verdicts?|repair sessions?)\b/i;

/** A small project's list, and the ids its runs were given. */
export const FORM = "Add a contact form";
export const FOOTER = "Fix the broken footer links";
export const HOMEPAGE = "Replace the old homepage";
export const BANNER = "Add a cookie banner";

export const ID = {
  form: "add-a-contact-form-20261001T020100Z",
  footer: "fix-the-broken-footer-links-20261001T022000Z",
  homepage: "replace-the-old-homepage-20261001T030000Z",
  banner: "add-a-cookie-banner-20261001T031000Z",
  run: "run-20261001T020000Z",
} as const;

const MERGE: CloserRef = { type: "merge-back" };

/** Delivered at the first attempt and merged. */
export const formDone = recordOf({ runId: ID.form, task: FORM, closerRef: MERGE, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

/** Four attempts, the check failing after each, until the corrections ran out. */
export const footerFailed = recordOf({
  runId: ID.footer,
  task: FOOTER,
  closerRef: MERGE,
  history: [
    ...attempt(1, "first go"),
    ...failedCheck(1, "reroute"),
    ...attempt(2, "second go"),
    ...failedCheck(2, "reroute"),
    ...attempt(3, "third go"),
    ...failedCheck(3, "reroute"),
    ...attempt(4, "I fixed 4 of the 6 links.\nThe other 2 point at pages that no longer exist."),
    ...failedCheck(4, "escalate"),
  ],
  outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (3/3)"),
});

/** Stopped at once for the owner's say-so. */
export const homepageAsks = recordOf({
  runId: ID.homepage,
  task: HOMEPAGE,
  closerRef: MERGE,
  history: attempt(1, "This would delete 14 published pages. I need the owner to confirm.", "authority"),
  outcome: stoppedAt("2026-10-01T03:04:00.000Z", { kind: "authority", role: "worker" }, "worker escalated: authority"),
});

/** Set to work, and nothing since. */
export const footerWorking = recordOf({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: attempt(1, "first go") });

/** Test support: what `loadSnapshot` would return for the four-task list, nothing run and nothing going unless said. */
export const snapshotOf = (over: Partial<RecordSnapshot> = {}): RecordSnapshot => ({
  subject: { kind: "list" },
  live: false,
  list: [FORM, FOOTER, HOMEPAGE, BANNER].map((intent) => ({ intent })),
  records: [],
  runs: [],
  damaged: [],
  ...over,
});
