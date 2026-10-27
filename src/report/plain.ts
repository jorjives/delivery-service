import { USAGE_LIMIT_WORDS } from "../ports.js";
import type { CloserRef, OutcomeCause, Population, UsageLimit } from "../schema.js";
import type { Audience, Plain, PlainGroup } from "./document.js";
import { stripControl } from "./text.js";

/** What `plainOf` reads of a stopped task: facts from its record, never prose to paraphrase. */
export interface PlainFacts {
  runId: string;
  cause: OutcomeCause | null;
  /** Whether the task's last setback was the agent saying it could not finish, rather than the check failing. */
  agentStuck: boolean;
  /** How many times the agent was set to work on the task. */
  attempts: number;
  /** The usage limit that stopped the task's last session, when one did. */
  limit: UsageLimit | null;
  agentSaid: string | null;
  /** Whether the project's list asks for this task, so the owner can amend or remove it there. */
  listed: boolean;
  /** The work-source item this task was, e.g. "backlog:x.md"; null for an ad hoc or list run. */
  item: string | null;
}

/** Every kind of stop the report has words for. Closed, so each table below is total over it. */
type Stop =
  | "say_so"
  | "say_so_in_repair"
  | "asked"
  | "asked_you"
  | "could_not_start"
  | "check_still_fails"
  | "agent_stuck"
  | "never_finished"
  | "usage_limit"
  | "abandoned"
  | "check_cannot_run"
  | "repairs_ran_out"
  | "repair_gave_up"
  | "hand_off_failed"
  | "could_not_decide"
  | "no_working_copy"
  | "landed_outside"
  | "held"
  | "unexplained";

/** Which kind of stop a record's facts describe. A cause this build does not know in full is unexplained, never guessed at. */
function stopOf({ cause, agentStuck, limit }: PlainFacts): Stop {
  if (cause === null) return "unexplained";
  switch (cause.kind) {
    case "authority":
      return cause.role === "gate-maintenance" ? "say_so_in_repair" : "say_so";
    case "triage_escalated":
      return "asked";
    case "decision":
      return "asked_you";
    case "session_not_run":
      return "could_not_start";
    case "triage_abort":
      return "abandoned";
    case "repair_gave_up":
      return "repair_gave_up";
    case "triage_failure":
      return "could_not_decide";
    case "provisioning":
      return "no_working_copy";
    case "landed_outside_closer":
      return "landed_outside";
    case "held":
      return "held";
    case "budget":
      switch (cause.population) {
        case "correction":
          return agentStuck ? "agent_stuck" : "check_still_fails";
        case "terminus":
          return limit === null ? "never_finished" : "usage_limit";
        case "gateError":
          return "check_cannot_run";
        case "gateMaintenance":
          return "repairs_ran_out";
        case "close":
          return "hand_off_failed";
        case undefined:
          return "unexplained";
      }
  }
}

const GROUP: Record<Stop, PlainGroup> = {
  say_so: "needs_your_decision",
  say_so_in_repair: "needs_your_decision",
  asked: "needs_your_decision",
  asked_you: "needs_your_decision",
  could_not_start: "needs_your_decision",
  check_still_fails: "failed_after_attempts",
  agent_stuck: "failed_after_attempts",
  never_finished: "failed_after_attempts",
  usage_limit: "failed_after_attempts",
  abandoned: "abandoned",
  check_cannot_run: "needs_an_engineer",
  repairs_ran_out: "needs_an_engineer",
  repair_gave_up: "needs_an_engineer",
  hand_off_failed: "needs_an_engineer",
  could_not_decide: "needs_an_engineer",
  no_working_copy: "needs_an_engineer",
  landed_outside: "needs_your_decision",
  held: "needs_your_decision",
  unexplained: "stopped",
};

const AUDIENCE: Record<PlainGroup, Audience> = {
  needs_your_decision: "owner",
  failed_after_attempts: "owner",
  abandoned: "owner",
  needs_an_engineer: "engineer",
  stopped: "unknown",
};

export const attemptsWord = (count: number): string => `${count} ${count === 1 ? "attempt" : "attempts"}`;
const timesWord = (count: number): string => (count === 1 ? "once" : `${count} times`);

const NOT_YOURS = "This is a problem with the setup, not a decision for you.";

/** What kind of stop it was, in fixed words. The only figures are counts from the record. */
const SENTENCE: Record<Stop, (facts: PlainFacts) => string> = {
  say_so: () => "Needs your decision. The agent stopped and said it could not go on without your say-so.",
  say_so_in_repair: () => "Needs your decision. While repairing the check, the agent stopped and said it could not go on without your say-so.",
  asked: () => "Needs your decision. The agent stopped and asked for a person to decide.",
  asked_you: ({ cause }) => `Needs your answer. The agent asked: ${cause?.kind === "decision" ? stripControl(cause.question ?? "the question was not recorded") : "the question was not recorded"}`,
  could_not_start: () => "Needs you. The agent could not be started, which usually means a sign-in or credential only you can supply.",
  check_still_fails: ({ attempts }) =>
    `Failed after ${attemptsWord(attempts)}. The agent tried ${timesWord(attempts)} and the check you set up still does not pass.`,
  agent_stuck: ({ attempts }) => `Failed after ${attemptsWord(attempts)}. The agent tried ${timesWord(attempts)} and said it could not finish the task.`,
  never_finished: ({ attempts }) =>
    `Failed after ${attemptsWord(attempts)}. The agent was started ${timesWord(attempts)} and each time stopped without finishing.`,
  // `limit` is non-null whenever the stop is `usage_limit`; the fallback keeps the table free of assertions.
  usage_limit: ({ limit }) => `Stopped because a usage limit was reached: ${limit === null ? "which one was not recorded" : USAGE_LIMIT_WORDS[limit]}.`,
  abandoned: () => "Abandoned. The agent judged that this task cannot be done as it is written.",
  check_cannot_run: () => `The check you set up could not be run, even after trying it again. ${NOT_YOURS}`,
  repairs_ran_out: () => `The check you set up could not be run, and repairing it did not work. ${NOT_YOURS}`,
  repair_gave_up: () => `The check you set up could not be repaired automatically. ${NOT_YOURS}`,
  hand_off_failed: () => `The work passed the check you set up, but it could not be handed off. ${NOT_YOURS}`,
  could_not_decide: () => `After a setback, the harness could not work out what to do next. ${NOT_YOURS}`,
  no_working_copy: () => `A working copy of your project could not be set up, so the agent never started. ${NOT_YOURS}`,
  landed_outside: () => "Needs your attention. The agent opened a pull request for this task itself, so its work was not landed by the harness.",
  held: () => "Waiting for your sign-off. The fix is finished and passes its checks, but the problem it fixes is serious, so it does not land until you say so.",
  unexplained: () => "Stopped. The record does not say what kind of stop this was.",
};

/** The route that works for each kind of stop. A finished task is never resumed, and running an unchanged list again only retells it. */
type Route = "decide" | "answer" | "reword" | "sign_in" | "wait" | "engineer" | "landed" | "sign_off" | "none";

const ROUTE: Record<Stop, Route> = {
  say_so: "decide",
  say_so_in_repair: "decide",
  asked: "decide",
  asked_you: "answer",
  could_not_start: "sign_in",
  check_still_fails: "reword",
  agent_stuck: "reword",
  never_finished: "reword",
  usage_limit: "wait",
  abandoned: "reword",
  check_cannot_run: "engineer",
  repairs_ran_out: "engineer",
  repair_gave_up: "engineer",
  hand_off_failed: "engineer",
  could_not_decide: "engineer",
  no_working_copy: "engineer",
  landed_outside: "landed",
  held: "sign_off",
  unexplained: "none",
};

const RUN_LIST = "Run: delivery run";
// ponytail: `--task` matches a list entry written as a sentence. An entry written as an object with extra keys is not
// matched by it, so the list would retell the old outcome; say so here if such lists turn up.
const RUN_AGAIN_ALONE = 'Run this task again on its own: delivery run --task "the task, exactly as it is written"';
const THEN_THE_LIST = "Then carry on with your list: delivery run";
const RUN_REWORDED = 'delivery run --task "the reworded task"';

/** What to do about it, in order. `listed` decides whether the task is amended in the list or typed again. */
const NEXT: Record<Route, (facts: PlainFacts) => string[]> = {
  decide: ({ listed }) =>
    listed
      ? ["Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.", RUN_LIST]
      : [`Decide. To say yes, run the task again with the permission in its wording: ${RUN_REWORDED}. To say no, do nothing more.`],
  answer: ({ item, runId }) => {
    const key = item ?? runId;
    return [`Answer it: delivery answer ${key} "your answer"`, "Then run: delivery run --sources"];
  },
  reword: ({ listed }) =>
    listed ? ["Reword the task, or remove it from your list.", RUN_LIST] : [`Reword the task and run it again: ${RUN_REWORDED}`],
  sign_in: ({ listed }) => ["Check that the agent can sign in on this machine.", RUN_AGAIN_ALONE, ...(listed ? [THEN_THE_LIST] : [])],
  wait: ({ listed }) => ["Wait until the limit no longer applies.", RUN_AGAIN_ALONE, ...(listed ? [THEN_THE_LIST] : [])],
  engineer: ({ runId }) => [`Pass this to whoever maintains your checks: delivery status ${runId}`],
  landed: ({ cause }) => [`Look at the pull request the agent opened: ${cause?.pullRequest ?? "its address was not recorded"}. Close it, or review and merge it yourself.`],
  sign_off: ({ item, runId }) =>
    item !== null
      ? [`Read what it changed: delivery backlog ${item}`, `Land it: delivery sign-off ${item}`, `Or set it aside: delivery reject ${item}`]
      : [`Read what it changed: delivery status ${runId}`],
  none: () => [],
};

/** A stopped task in the owner's words. Total: every record gets a group, and one with no cause gets no advice. */
export function plainOf(facts: PlainFacts): Plain {
  const stop = stopOf(facts);
  const group = GROUP[stop];
  return { group, audience: AUDIENCE[group], sentence: SENTENCE[stop](facts), agentSaid: facts.agentSaid, next: NEXT[ROUTE[stop]](facts) };
}

/** How a project lands its work. `ReportSurface.closer`, without the null a task with no run has. */
export type Landing = CloserRef["type"] | "delivery-branch";

const NOT_RECORDED = "not recorded";

/** Where a delivered task's work went. Total over the ways of landing work, so a new one does not compile until it has words. */
export function landedWords(closer: Landing, branch: string | null, base: string | null): string {
  switch (closer) {
    case "merge-back":
      return `merged into ${base ?? `your base branch (${NOT_RECORDED})`}`;
    case "commit-to-branch":
      return `committed on branch ${branch ?? NOT_RECORDED}`;
    case "open-pr":
      return `on branch ${branch ?? NOT_RECORDED}, with a pull request open`;
    case "custom":
      return "your own closer handled this task; check what it did";
    case "delivery-branch":
      return `landed on ${base ?? `the delivery branch (${NOT_RECORDED})`}`;
  }
}

/** What "completed" meant for the `count` tasks that were delivered, when they all landed the same way. Total over the ways of landing work. */
export function completedWords(closer: Landing, count: number): string {
  switch (closer) {
    case "merge-back":
      return "completed and merged";
    case "commit-to-branch":
      return count === 1 ? "completed and committed to its own branch" : "completed and committed to their own branches";
    case "open-pr":
      return count === 1 ? "completed, with a pull request open" : "completed, each with a pull request open";
    case "custom":
      return "completed";
    case "delivery-branch":
      return "completed and landed on the delivery branch";
  }
}

/** Where a stopped task's work is: only what the way of landing work guarantees, never that work was kept or that nothing changed. */
export function whereTheWorkIs(closer: Landing, base: string | null): string {
  if (closer === "custom") return "your own closer was told this task stopped; check what it did.";
  return base === null ? `${NOT_RECORDED}.` : `this task's changes were not added to ${base}.`;
}

/** The five kinds of retry, as the owner reads them. */
export const RETRY_WORDS: Record<Population, string> = {
  correction: "agent corrections",
  gateError: "check re-runs",
  gateMaintenance: "check repairs",
  terminus: "agent restarts",
  close: "hand-off retries",
};
