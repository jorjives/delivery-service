import { paint, type Tone } from "../paint.js";
import { USAGE_LIMIT_WORDS } from "../ports.js";
import { Population } from "../schema.js";
import { lastActivity, type BudgetRow, type DamagedRecord, type HeldSequence, type ParkedItem, type ReportAfter, type ReportDelivery, type ReportDocument, type ReportRepair, type ReportRun, type ReportSurface, type UsageCoverage, type UsageTotal } from "./document.js";
import { completedWords, landedWords, RETRY_WORDS, whereTheWorkIs, type Landing } from "./plain.js";

export const NO_RUNS_YET = "No runs yet in this folder. Start one with: delivery run";

/** Said above a report of the most recent run when the project has no task list to report on. */
export const NO_TASK_LIST = "This project has no task list, so this is its most recent run.";

/** A task the run set aside while the setup every task shares is repaired. "Paused", never "held": the owner's word. */
export const PAUSED_FOR_REPAIR = "paused while the setup every task shares is repaired";

/**
 * Text from a record with everything that could drive the terminal taken out:
 * escape sequences whole, then any other control character. Line breaks and
 * tabs are kept, because quoted output is read as it was written.
 */
export function stripControl(text: string): string {
  // The pattern is the control characters themselves: matching them is the point.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

/** A file name from the record on one line: a line break in it is shown as a backslash and n, as git shows it, not broken onto a line of its own. */
export function pathName(path: string): string {
  return stripControl(path).replace(/\n/g, "\\n");
}

/** A word for a shell command line to be pasted: left alone when it is plain, single-quoted otherwise. */
function shellQuoted(word: string): string {
  const clean = stripControl(word);
  return /^[\w.:@%+=,/-]+$/.test(clean) ? clean : `'${clean.replace(/'/g, `'\\''`)}'`;
}

/** Words from the record, in quotation marks, with later lines set under the first. */
export function quoted(text: string, indent: string): string {
  return `"${stripControl(text).trim().split("\n").join(`\n${indent}`)}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "02:19", from an ISO 8601 UTC instant by its own digits: no clock and no locale is read. */
export const minuteOf = (iso: string): string => iso.slice(11, 16);

/** "1 Oct 02:19", the same way. */
export const dayAndMinute = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${minuteOf(iso)}`;

/** How long it was between two recorded instants. Never measured against now. */
function elapsed(from: string, to: string): string {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export const tasksWord = (count: number): string => `${count} ${count === 1 ? "task" : "tasks"}`;

/** The part of the report a task is told in. */
export type Section = "needs_you" | "engineers" | "done" | "not_finished" | "not_started";

const SECTIONS: readonly Section[] = ["needs_you", "engineers", "done", "not_finished", "not_started"];

export const HEADING: Record<Section, { title: string; tone: Tone }> = {
  needs_you: { title: "NEEDS YOU", tone: "attention" },
  engineers: { title: "STOPPED, FOR YOUR ENGINEERS", tone: "stopped" },
  done: { title: "DONE", tone: "done" },
  not_finished: { title: "NOT FINISHED", tone: "quiet" },
  not_started: { title: "NOT STARTED", tone: "quiet" },
};

const RUN_AGAIN = "delivery run";

/** Total over the standings, so a new one does not compile until it has a section. */
function sectionOf(surface: ReportSurface): Section {
  switch (surface.standing) {
    case "closed":
      return "done";
    case "escalated":
    case "aborted":
      return surface.plain?.audience === "owner" ? "needs_you" : "engineers";
    case "paused":
    case "unfinished":
    case "queued":
      return "not_finished";
    case "not_started":
      return "not_started";
  }
}

export const label = (surface: ReportSurface): string =>
  `${surface.queue ? `Task ${surface.queue.task} of ${surface.queue.of}` : "Task"}: ${quoted(surface.task, "    ")}`;

/** Which repair it was, in the words both readers are given. Total over the kinds. */
export const REPAIR_OF: Record<ReportRepair["of"], string> = { check: "of the check", setup: "of the setup" };

const stoppedByLimit = (surface: ReportSurface): boolean =>
  surface.cause?.kind === "budget" && surface.cause.population === "terminus" && surface.limit !== null;

/** "3 of 5 tasks completed and merged; 1 needs your decision; 1 failed after 3 attempts." Said only when nothing is still to finish. */
function headline(doc: ReportDocument): string {
  const done = doc.surfaces.filter((surface) => surface.standing === "closed");
  const [first] = done;
  const sameLanding = first?.closer != null && done.every((surface) => surface.closer === first.closer) ? first.closer : null;
  const of = (group: string): ReportSurface[] => doc.surfaces.filter((surface) => surface.plain?.group === group);
  const failed = of("failed_after_attempts").filter((surface) => !stoppedByLimit(surface));
  const limited = doc.surfaces.filter(stoppedByLimit);
  const [onlyFailure] = failed;
  const engineers = doc.surfaces.filter((surface) => sectionOf(surface) === "engineers").length;
  const some = (count: number, one: string, many: string): string[] => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`]);
  return [
    `${done.length} of ${tasksWord(doc.surfaces.length + doc.incomplete.filter((damaged) => damaged.queue !== null).length)} ${sameLanding === null ? "completed" : completedWords(sameLanding, done.length)}`,
    ...some(of("needs_your_decision").length, "needs your decision", "need your decision"),
    ...(failed.length === 1 && onlyFailure
      ? [`1 failed after ${onlyFailure.attempts} ${onlyFailure.attempts === 1 ? "attempt" : "attempts"}`]
      : some(failed.length, "failed", "failed after repeated attempts")),
    ...some(limited.length, "stopped at a usage limit", "stopped at a usage limit"),
    ...some(of("abandoned").length, "was abandoned", "were abandoned"),
    ...some(engineers, "stopped, for your engineers", "stopped, for your engineers"),
    ...some(doc.incomplete.filter((damaged) => damaged.queue !== null).length, "could not be read", "could not be read"),
    ...some(doc.counts.not_started, "not started", "not started"),
  ].join("; ");
}

/** "5 tasks: 1 done, 2 working, 2 waiting to start", for a report on work that has not finished. */
function tally(doc: ReportDocument): string {
  const count = (section: Section): number => doc.surfaces.filter((surface) => sectionOf(surface) === section).length;
  const part = (number: number, words: string): string[] => (number === 0 ? [] : [`${number} ${words}`]);
  return `${tasksWord(doc.surfaces.length)}: ${[
    ...part(count("done"), "done"),
    ...part(count("needs_you"), count("needs_you") === 1 ? "needs you" : "need you"),
    ...part(count("engineers"), "stopped for your engineers"),
    ...part(doc.counts.unfinished, doc.live === true ? "working" : "not finished"),
    ...part(doc.counts.paused, "paused"),
    ...part(doc.counts.queued, "waiting to start"),
    ...part(doc.counts.not_started, "not started"),
  ].join(", ")}`;
}

const waitingIn = (doc: ReportDocument): number => doc.counts.unfinished + doc.counts.paused + doc.counts.queued;

/** The counts a report opens with, without the words around them: the headline once nothing is still to finish, the tally until then. */
export function headlineCounts(doc: ReportDocument): string {
  return waitingIn(doc) === 0 ? headline(doc) : tally(doc);
}

/** What the report is about, as its opening words. Total over the kinds of report. */
const SUBJECT: Record<ReportDocument["kind"], { final: string; going: string; partWay: string; unknown: string }> = {
  list: {
    final: "Your task list",
    going: "Your task list is still being worked on",
    partWay: "Work on your task list stopped part way",
    unknown: "Your task list has not finished",
  },
  run: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
  task: { final: "This run", going: "This run is still going", partWay: "This run stopped part way", unknown: "This run has not finished" },
};

/** That the work stopped part way, and how to carry it on. A run that records why it stopped says how in its own line instead. */
export function stoppedPartWay(doc: ReportDocument): string {
  return `${SUBJECT[doc.kind].partWay} (${tally(doc)}).${doc.run?.cause == null ? ` To carry on: ${RUN_AGAIN}` : ""}`;
}

/** How to follow what the report is about as it happens: the list by default, anything else by its id. */
function followIt(doc: ReportDocument): string {
  const id = doc.kind === "list" ? undefined : doc.kind === "run" ? doc.run?.runId : doc.surfaces[0]?.run;
  return `Follow it: delivery status --watch${id == null ? "" : ` ${id}`}`;
}

/** The first lines: what happened, counted. Never final-sounding while a task is still to finish. */
function opening(doc: ReportDocument): string[] {
  const words = SUBJECT[doc.kind];
  if (waitingIn(doc) === 0) return doc.surfaces.length === 0 ? [] : [`${words.final}: ${headline(doc)}.`];
  if (doc.live === true) return [`${words.going} (${tally(doc)}). ${followIt(doc)}`];
  if (doc.live === false) return [stoppedPartWay(doc)];
  const unfinished = doc.surfaces.find((surface) => surface.standing === "unfinished");
  const resume = unfinished?.run ? `delivery resume ${unfinished.run}` : undefined;
  return [`${words.unknown} (${tally(doc)}); nothing records whether it is still going.${resume ? ` If it is not, carry on with: ${resume}` : ""}`];
}

/** Items set aside on this machine: what each waits on, and the one command that deals with it. */
export function parkedLines(parked: readonly ParkedItem[]): string[] {
  if (parked.length === 0) return [];
  const line = ({ item, intent, reason, question, attempts }: ParkedItem): string => {
    const shown = pathName(item);
    const name = intent === null ? shown : `${shown} (${pathName(intent)})`;
    const key = shellQuoted(item);
    switch (reason) {
      case "decision":
        return `- ${name}: asked "${question === null ? "the question was not recorded" : stripControl(question)}". Answer with: delivery answer ${key} "your answer"`;
      case "attempts":
        return `- ${name}: ended without being delivered ${attempts} runs in a row. To try again: delivery unpark ${key}`;
      case "escalated":
        return `- ${name}: stopped for you. When you have dealt with it: delivery unpark ${key}`;
      case "held":
        return `- ${name}: finished and checked, waiting for your sign-off. Land it: delivery sign-off ${key}, or set it aside: delivery reject ${key}`;
    }
  };
  return ["", "Parked, skipped until you deal with them:", ...parked.map(line)];
}

/** Sequences held behind an earlier item: which, by what, and what it waits on. */
export function heldLines(held: readonly HeldSequence[]): string[] {
  if (held.length === 0) return [];
  const line = ({ sequence, item, reason }: HeldSequence): string => {
    const head = `- ${pathName(sequence)}: held by ${pathName(item)}`;
    switch (reason) {
      case "parked":
        return `${head}, which is parked (see Parked above).`;
      case "decision":
        return `${head}, which waits for your answer. Answer with: delivery answer ${shellQuoted(item)} "your answer"`;
      case "in_flight":
        return `${head}, which is being worked.`;
    }
  };
  return ["", "Sequences waiting, nothing later in each is started until the item holding it moves on:", ...held.map(line)];
}

/** The delivery branch: what landed on it since it opened, what the closer last did with it, and what blocks it. */
export function deliveryLines(delivery: ReportDelivery | null): string[] {
  if (delivery === null) return [];
  const when = (at: string): string => `${dayAndMinute(at)} UTC`;
  return [
    "",
    `Delivery branch ${pathName(delivery.branch)}, for ${pathName(delivery.base)}, open since ${when(delivery.openedAt)}:`,
    ...(delivery.landed.length === 0
      ? ["- nothing has landed on it yet"]
      : delivery.landed.map((task) => `- ${when(task.at)}: ${stripControl(task.intent)} (${pathName(task.item)}, run ${pathName(task.run)})`)),
    delivery.closer === null ? "Your closer has not taken it yet." : `Your closer, ${when(delivery.closer.at)}: ${stripControl(delivery.closer.detail)}`,
    ...(delivery.blocked === null ? [] : [`Blocked, ${when(delivery.blocked.at)}: ${stripControl(delivery.blocked.reason)}`]),
  ];
}

const STEP_WORDS = { done: "done", failed: "did not work", skipped: "skipped", pending: "waiting" } as const;

/** After-landing steps: for each batch shown, what landed and what became of each step, and what the next run does about any left. */
export function afterLines(after: readonly ReportAfter[]): string[] {
  if (after.length === 0) return [];
  const lines: string[] = [];
  for (const batch of after) {
    lines.push("", `After landing ${batch.commit.slice(0, 7)} on ${pathName(batch.branch)}, ${dayAndMinute(batch.at)} UTC (batch ${stripControl(batch.batch)}):`);
    for (const step of batch.steps) {
      const words = STEP_WORDS[step.status];
      lines.push(`- ${stripControl(step.label)}: ${step.detail === null || step.detail === "" ? words : `${words}: ${stripControl(step.detail)}`}`);
    }
  }
  if (after.some((batch) => batch.steps.some((step) => step.status === "pending" || step.status === "failed"))) {
    lines.push("The next `delivery run --sources` tries the waiting steps first, from the one that did not work; `delivery drop-after` gives them up.");
  }
  return lines;
}

/** The ledger sections every report and status ends with: parked items, the delivery branch, after-landing steps. */
export function ledgerLines(doc: Pick<ReportDocument, "parked" | "held" | "delivery" | "after">): string[] {
  return [...parkedLines(doc.parked), ...heldLines(doc.held), ...deliveryLines(doc.delivery), ...afterLines(doc.after)];
}

export function incompleteLines(doc: ReportDocument): string[] {
  const others = doc.surfaces.length;
  const rest = others === 0 ? "nothing else could be read" : `the other ${tasksWord(others)} ${others === 1 ? "is" : "are"} reported below`;
  return doc.incomplete.map((damaged: DamagedRecord) =>
    damaged.queue
      ? `Incomplete report: the record for task ${damaged.queue.task} is damaged (${damaged.file}); ${rest}.`
      : `Incomplete report: the record of run ${damaged.run} is damaged (${damaged.file}); ${others === 0 ? "nothing else could be read" : "what could be read is reported below"}.`,
  );
}

const lastActivityWords = (doc: ReportDocument): string => {
  const at = lastActivity(doc);
  return `last activity ${at === null ? "not recorded" : `${dayAndMinute(at)} UTC`}`;
};

/** When the work ran. A run of several at once has times of its own; a list worked one task at a time has only its tasks'. */
function whenLines(doc: ReportDocument): string[] {
  const { run } = doc;
  if (run) {
    const shape = `up to ${tasksWord(run.concurrency)} at once`;
    if (run.startedAt === null) return [`Run ${run.runId}, start time not recorded, ${shape}.`];
    return run.finishedAt === null
      ? [`Run ${run.runId}, started ${dayAndMinute(run.startedAt)} UTC, ${shape}; ${lastActivityWords(doc)}.`]
      : [`Run ${run.runId}, ${dayAndMinute(run.startedAt)} to ${minuteOf(run.finishedAt)} UTC (${elapsed(run.startedAt, run.finishedAt)}), ${shape}.`];
  }
  const ran = doc.surfaces.filter((surface) => surface.run !== null);
  if (ran.length === 0) return [];
  const started = ran.flatMap((surface) => (surface.startedAt === null ? [] : [surface.startedAt])).sort().at(0);
  return [`Started ${started === undefined ? "at a time not recorded" : `${dayAndMinute(started)} UTC`}; ${lastActivityWords(doc)}.`];
}

/** Whether the main folder was protected while the agent worked. Any task without the fence decides it; a report of runs recorded before the fence says nothing. */
function fenceLines(doc: ReportDocument): string[] {
  const fences = doc.surfaces.flatMap((surface) => (surface.fence === null ? [] : [surface.fence]));
  if (fences.length === 0) return [];
  const absent = fences.find((fence) => !fence.present);
  if (absent === undefined) return ["Your main folder was protected while the agent worked."];
  return [`Your main folder was not protected while the agent worked (${absent.reason ?? "why was not recorded"}).`];
}

/** Why a run of several at once stopped when no task caused it. Total over the causes a run records. */
function runStopLines(run: ReportRun | null): string[] {
  switch (run?.cause) {
    case undefined:
    case null:
      return [];
    case "shared_environment":
      return [`The run stopped because the setup every task shares could not be repaired; no task caused this. Once it is fixed, carry on with: ${RUN_AGAIN}`];
    case "usage_limit":
      return [
        `The run stopped because a usage limit was reached${run.limit === null ? "" : `: ${USAGE_LIMIT_WORDS[run.limit]}`}; no task caused this. Once the limit no longer applies, carry on with: ${RUN_AGAIN}`,
      ];
  }
}

/** "To act:" with its steps, numbered only when there is more than one. Indented under a task in the report; flush left in `status`. */
export function toAct(next: string[], indent = "    "): string[] {
  const [only] = next;
  if (only === undefined) return [];
  if (next.length === 1) return [`${indent}To act: ${only}`];
  return next.map((step, index) => `${indent}${index === 0 ? "To act:" : "       "} ${index + 1}. ${step}`);
}

/** A stopped task: the kind of stop, the agent's own words, where the work is, and what to do. */
function stoppedItem(surface: ReportSurface): string[] {
  const { plain } = surface;
  if (plain === null || surface.run === null) return [`  ${label(surface)}`];
  const landing: Landing = surface.closer ?? "commit-to-branch";
  return [
    `  ${label(surface)}`,
    `    ${plain.sentence}`,
    ...(plain.group === "stopped" ? [`    The run recorded this reason: ${surface.reason === null ? "not recorded" : quoted(surface.reason, "    ")}`] : []),
    `    The agent said: ${plain.agentSaid === null ? "not recorded" : quoted(plain.agentSaid, "    ")}`,
    ...(plain.audience === "owner" ? [`    Where the work is: ${whereTheWorkIs(landing, surface.base)}`] : []),
    ...toAct(plain.next),
    ...(plain.audience === "engineer" ? [] : [`    Full account: delivery status ${surface.run}`]),
  ];
}

export const doneItem = (surface: ReportSurface): string =>
  `  ${label(surface)}: ${landedWords(surface.closer ?? "commit-to-branch", surface.branch, surface.base)}${surface.finishedAt === null ? "" : ` at ${minuteOf(surface.finishedAt)}`}`;

/** A task that has not finished, and how to carry it on when nothing says it is still going. */
function unfinishedItem(surface: ReportSurface, live: boolean | null): string[] {
  const standing =
    surface.standing === "queued"
      ? "waiting to start"
      : surface.standing === "paused"
        ? PAUSED_FOR_REPAIR
        : live === true
          ? "working"
          : "not finished";
  return [
    `  ${label(surface)}: ${standing}`,
    ...(surface.standing === "unfinished" && live === null && surface.run ? [`    If it is no longer going, carry on with: delivery resume ${surface.run}`] : []),
  ];
}

/** Why the tasks with no run were left, and how to carry on. A list worked one task at a time stops at the first task that does not finish. */
function notStartedReason(doc: ReportDocument): string[] {
  const damaged = doc.incomplete.flatMap((record) => (record.queue ? [record.queue.task] : [])).sort((a, b) => a - b).at(0);
  const stuck = doc.surfaces.find((surface) => surface.queue !== null && surface.standing !== "closed" && surface.standing !== "not_started");
  const ahead = stuck?.queue?.task;
  // A run of several at once does not stop at a task, so nothing is waiting behind one.
  if (doc.run !== null || (ahead === undefined && damaged === undefined)) return ["  These have not been started yet. To start them: delivery run"];
  if (damaged !== undefined && (ahead === undefined || damaged < ahead)) {
    return [`  These are waiting behind task ${damaged}, whose record is damaged. They are left alone until that is put right.`];
  }
  const behind = `  These are waiting behind task ${ahead}.`;
  if (stuck === undefined || sectionOf(stuck) === "not_finished") return [`${behind} It has not finished, so they have been left alone.`];
  const left = "The harness does not skip a task that stopped, so it left these alone.";
  return sectionOf(stuck) === "needs_you"
    ? [`${behind} ${left} Amend or remove task ${ahead}, then run \`delivery run\` to carry on with them.`]
    : [`${behind} ${left} Once task ${ahead} has been dealt with, run \`delivery run\` to carry on with them.`];
}

function sectionLines(doc: ReportDocument, section: Section, colour: boolean): string[] {
  const surfaces = doc.surfaces.filter((surface) => sectionOf(surface) === section);
  if (surfaces.length === 0) return [];
  const { title, tone } = HEADING[section];
  const body = ((): string[] => {
    switch (section) {
      case "needs_you":
      case "engineers":
        return surfaces.flatMap((surface, index) => [...(index === 0 ? [] : [""]), ...stoppedItem(surface)]);
      case "done":
        return surfaces.map(doneItem);
      case "not_finished":
        return surfaces.flatMap((surface) => unfinishedItem(surface, doc.live));
      case "not_started":
        return [...surfaces.map((surface) => `  ${label(surface)}`), ...notStartedReason(doc)];
    }
  })();
  return ["", paint(colour, tone, `${title} (${surfaces.length})`), ...body];
}

/** The retries of several tasks added up, kind by kind, in the fixed order of the kinds. */
export function budgetTotals(surfaces: ReportSurface[]): BudgetRow[] {
  return Population.options.map((population) => {
    const rows = surfaces.flatMap((surface) => surface.budgets.filter((row) => row.population === population));
    return { population, used: rows.reduce((sum, row) => sum + row.used, 0), max: rows.reduce((sum, row) => sum + row.max, 0) };
  });
}

/** A length of time as a person says it: seconds under a minute, minutes and seconds under an hour, else hours and minutes. */
export function durationWords(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** An estimated cost in US dollars, to the cent; a cost too small to show in cents is said to be under one. */
export const costWords = (usd: number): string => (usd > 0 && usd < 0.005 ? "under USD 0.01" : `USD ${usd.toFixed(2)}`);

/**
 * What the agent sessions behind something took and cost, always with how many
 * sessions the figure covers, so a partial figure never reads as the whole.
 * Nothing recorded reads as not recorded, never as zero. Information only.
 */
export function usageSentence({ usage, usageRecorded }: { usage: UsageTotal | null; usageRecorded: UsageCoverage }, subject: string): string {
  if (usage === null) return `Time and cost were not recorded for ${subject}.`;
  const { recorded, sessions } = usageRecorded;
  return `Time and cost, recorded for ${recorded} of ${sessions} agent ${sessions === 1 ? "session" : "sessions"}: ${durationWords(usage.durationMs)} of session time; ${costWords(usage.costUsd)}, estimated by the agent runtime.`;
}

/**
 * What some agent sessions took and cost, under `subject`: none run, not recorded, the whole, or how many sessions the
 * figure covers. Never zero for lack of data. Information only.
 */
export function costLine(subject: string, { usage, usageRecorded }: { usage: UsageTotal | null; usageRecorded: UsageCoverage }): string {
  const { recorded, sessions } = usageRecorded;
  if (sessions === 0) return `${subject}: none has run yet.`;
  if (usage === null) return `${subject}: time not recorded; cost not recorded.`;
  const cover = recorded === sessions ? "" : `, recorded for ${recorded} of ${sessions} agent ${sessions === 1 ? "session" : "sessions"}`;
  return `${subject}${cover}: ${durationWords(usage.durationMs)} of session time; ${costWords(usage.costUsd)}, estimated by the agent runtime.`;
}

/**
 * Each repair that changed a file the check runs: which task and which files, that this report cannot tell whether
 * the change was safe, and where to see it. Nothing when no repair recorded one: a repair is shown, never judged.
 */
function worthALookLines(doc: ReportDocument, colour: boolean): string[] {
  const items = doc.surfaces.flatMap((surface) => {
    const { run } = surface;
    if (run === null) return [];
    return surface.repairs.flatMap((repair) => {
      const touched = repair.files.filter((file) => file.touchesCheck);
      if (touched.length === 0) return [];
      return [
        `  A repair ${REPAIR_OF[repair.of]} changed ${touched.length === 1 ? "a file" : "files"} the check runs (${touched.map((file) => `"${pathName(file.path)}"`).join(", ")}) during ${surface.queue ? `task ${surface.queue.task}` : "this task"}.`,
        "    This report shows what changed; it cannot tell you whether the change was safe.",
        `    See it: delivery status ${run} --repairs`,
      ];
    });
  });
  const guardsOff = doc.surfaces.flatMap((surface) =>
    surface.guards === null || surface.guards.off.length === 0
      ? []
      : [`  ${surface.queue ? `Task ${surface.queue.task} of ${surface.queue.of}` : "This task"} ran with these test guards turned off: ${surface.guards.off.join(", ")}. What they would have caught was not checked.`],
  );
  const all = [...items, ...guardsOff];
  return all.length === 0 ? [] : ["", paint(colour, "attention", "WORTH A LOOK"), ...all];
}

/**
 * Retries used, and the time and cost of the agent sessions with how many sessions that covers, in the owner's vocabulary,
 * for whoever adjusts the limits, then where this report was saved when it was. Nothing when no task has a run to count and
 * nothing was saved.
 */
function tuningLines(doc: ReportDocument, colour: boolean, saved: string | undefined): string[] {
  const ran = doc.surfaces.filter((surface) => surface.budgets.length > 0);
  const sums = budgetTotals(ran).map((row) => `${RETRY_WORDS[row.population]} ${row.used} of ${row.max}`);
  const usage = ran.length === 0 ? [] : [usageSentence(doc, "this run")];
  const lines = [
    ...(ran.length === 0
      ? []
      : [
          `  Retries used across ${ran.length === 1 ? "this task" : "these tasks"}: ${sums.join("; ")}.`,
          ...(doc.run ? [`  Repairs of the setup every task shares: ${doc.run.runBudgets.gateMaintenance.used} of ${doc.run.runBudgets.gateMaintenance.max}.`] : []),
        ]),
    ...usage.map((line) => `  ${line}`),
    ...(saved === undefined ? [] : [`  ${saved}`]),
  ];
  return lines.length === 0 ? [] : ["", paint(colour, "quiet", "FOR WHOEVER TUNES THIS"), ...lines];
}

/** How to read more about what a report is about: the list by default, anything else by its id. */
export function reportPointer(doc: ReportDocument): string {
  const id = doc.kind === "list" ? undefined : doc.kind === "run" ? doc.run?.runId : doc.surfaces[0]?.run;
  return `Run \`delivery report${id == null ? "" : ` ${id}`}\` for what to do.`;
}

/**
 * What a command that has just stopped working on something says of it in one sentence: the counts the report
 * opens with. It never wonders whether the work is still going, because the command saying it is the work.
 */
export function closingSentence(doc: ReportDocument): string {
  return `${SUBJECT[doc.kind].final}: ${headlineCounts(doc)}.`;
}

/** Where to go from here: only commands that exist. */
function nextLine(doc: ReportDocument): string {
  const [only] = doc.surfaces;
  if (doc.run) return `Next: delivery status ${doc.run.runId} (detail), delivery status --all (every run)`;
  if (doc.kind === "task" && only?.run) return `Next: delivery status ${only.run} (detail), delivery report (your task list)`;
  return "Next: delivery status --all (every run)";
}

/**
 * The report as a person reads it: plain lines, one fact per line, no columns
 * and no wrapping, so it reads the same at any width, in a pipe and in a screen
 * reader. Pure: the same document always gives the same text. Every sentence
 * outside quotation marks is from a fixed table; words from the record appear
 * only quoted, with control characters taken out.
 *
 * Sections: NEEDS YOU, STOPPED, DONE, NOT FINISHED, NOT STARTED, a "WORTH A LOOK"
 * alert when a repair changed a file the check runs or a task turned a test guard off,
 * retries and time used, and next steps. `saved` is one sentence about the copy of this
 * report kept on disk: where it
 * was saved, or that it could not be. Left out, the report says nothing of one.
 */
export function renderText(doc: ReportDocument, { colour, saved }: { colour: boolean; saved?: string }): string[] {
  return [
    ...incompleteLines(doc),
    ...opening(doc),
    ...whenLines(doc),
    ...fenceLines(doc),
    ...runStopLines(doc.run),
    ...SECTIONS.flatMap((section) => sectionLines(doc, section, colour)),
    ...worthALookLines(doc, colour),
    ...tuningLines(doc, colour, saved),
    ...ledgerLines(doc),
    "",
    nextLine(doc),
  ];
}
