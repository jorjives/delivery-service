import { resolve } from "node:path";
import { DamagedReview } from "../errors.js";
import { appendLedger, authorisations, readLedger } from "../packs/ledger.js";
import { keptChanges } from "../packs/kept-changes.js";
import { UNDECIDED, keptFix, readFindingStates } from "../packs/fix-state.js";
import { findingsDocument, findingsSchema } from "../packs/findings-document.js";
import { CHANGES_NOTE, CHANGES_WHICH, findingLines, listLines, NO_REVIEW_YET, noKeptFix, unconfirmedLines, unfinishedReview, stateWords, uncheckedRefused, uncheckedApproved } from "../packs/render.js";
import { listReviews, loadReview, uncheckable } from "../packs/review-record.js";
import type { SavedReview } from "../packs/review-record.js";
import { literalsOf, maskIn } from "../packs/secrets.js";
import { stripControl } from "../report/text.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";

export interface FindingsOptions {
  repo?: string;
  unconfirmed?: boolean;
  changes?: boolean;
  /** Print the published schema of `--json`'s document instead of any problems. */
  schema?: boolean;
  /** Also list problems skipped or declined in an earlier review, which are left out by default. */
  includeSkipped?: boolean;
}

export const SCHEMA_ALONE = "Use `--schema` on its own: it prints the schema of the data, not the problems, so it takes no number and no other option.";

export interface DecideOptions {
  repo?: string;
  all?: boolean;
  allowUnchecked?: boolean;
}

export const noSuchProblem = (asked: string, count: number): string =>
  `There is no problem ${asked} in the latest review: it lists ${count}. See the list with: delivery findings`;

/** The problem `asked` names, counted from 1, or a refusal naming how many the review lists. */
export function problemNumber(asked: string, count: number): number {
  const n = /^\d+$/.test(asked) ? Number(asked) : 0;
  if (n < 1 || n > count) throw new Refusal(noSuchProblem(asked, count), EXIT.configuration);
  return n;
}

/** Numbers as a sentence lists them: 1, 3 and 4. */
export const numberList = (numbers: readonly number[]): string =>
  numbers.length < 2 ? String(numbers[0] ?? "") : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1) ?? ""}`;

export const approvedLine = (numbers: readonly number[]): string => `Approved ${numberList(numbers)}. Start fixing with: delivery fix`;
export const skippedLine = (numbers: readonly number[]): string => `Skipped ${numberList(numbers)}: nothing will be done about ${numbers.length === 1 ? "it" : "them"}.`;
export const testsOnlyApproved = (number: number): string => `Problem ${number} is tests only: it cannot be proved fixed except by your existing tests.`;
export const alreadyTakenOn = (number: number): string => `Problem ${number} is already being fixed or has finished, so your choice for it cannot change now. See where it stands with: delivery findings`;
export const NOTHING_CHOSEN = "Say which problems, by their numbers in the list, for example: delivery findings approve 1 3, or delivery findings approve --all";
export const ALL_AND_NUMBERS = "Give either problem numbers or --all, not both.";
export const NOTHING_LEFT = "Every problem in the list is already being fixed or has finished. See where each stands with: delivery findings";
export const ALL_UNCHECKED = "Name each problem to approve without a check by its number: --allow-unchecked does not go with --all.";

/** The latest review, finished, for a command that acts on it: a refusal naming the command to run when there is none or it was stopped part way. */
export async function finishedReview(repoPath: string): Promise<SavedReview> {
  const [latest] = await listReviews(repoPath);
  if (latest === undefined) throw new Refusal(NO_REVIEW_YET, EXIT.configuration);
  if (latest.state === "damaged") throw new DamagedReview(latest.file);
  if (latest.state === "unfinished") throw new Refusal(unfinishedReview(latest.header.pack.name), EXIT.configuration);
  return loadReview(latest);
}

/**
 * `delivery findings [n]`: the latest review's problems, one of them in full,
 * or the ones that could not be confirmed; with `--json`, the whole list as one `delivery.findings/1` document. Only reads.
 */
export async function findingsCommand(number: string | undefined, options: FindingsOptions, ctx: CommandContext): Promise<ExitCode> {
  // The schema is the same wherever it is asked for.
  if (options.schema === true) {
    if (number !== undefined || options.unconfirmed === true || options.changes === true) throw new Refusal(SCHEMA_ALONE, EXIT.configuration);
    ctx.writeLine(JSON.stringify(findingsSchema(), null, 2));
    return EXIT.ok;
  }

  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const say = (line: string): void => ctx.report.note(line);
  const [latest] = await listReviews(repoPath);
  if (latest === undefined) {
    say(NO_REVIEW_YET);
    return EXIT.ok;
  }
  if (latest.state === "damaged") throw new DamagedReview(latest.file);
  if (latest.state === "unfinished") {
    say(unfinishedReview(latest.header.pack.name));
    return EXIT.ok;
  }
  const review = await loadReview(latest);
  if (options.unconfirmed === true) {
    for (const line of unconfirmedLines(review)) say(line);
    return EXIT.ok;
  }
  if (options.changes === true) {
    if (number === undefined) throw new Refusal(CHANGES_WHICH, EXIT.configuration);
    const n = problemNumber(number, review.result.findings.length);
    const { states } = await readFindingStates(repoPath, review);
    const at = states[n - 1];
    const fix = at === undefined ? undefined : keptFix(at);
    const kept = fix !== undefined && (at?.state === "held" || at?.state === "signed_off_failed" || at?.state === "rejected");
    if (!kept || at === undefined) throw new Refusal(noKeptFix(n, stateWords(at ?? UNDECIDED)), EXIT.configuration);
    const finding = review.result.findings[n - 1];
    const hide = (text: string): string => stripControl(finding === undefined ? text : maskIn(text, literalsOf(finding)));
    const { stat, patch } = await keptChanges(repoPath, fix);
    say(CHANGES_NOTE);
    say("");
    for (const line of hide(stat).split("\n")) say(line);
    say("");
    for (const line of hide(patch).trimEnd().split("\n")) say(line);
    return EXIT.ok;
  }
  if (number === undefined) {
    const { states } = await readFindingStates(repoPath, review);
    if (ctx.json) {
      ctx.writeLine(JSON.stringify(findingsDocument(review, states), null, 2));
      return EXIT.ok;
    }
    for (const line of listLines(review, states, { includeSkipped: options.includeSkipped === true })) say(line);
    return EXIT.ok;
  }
  const count = review.result.findings.length;
  const n = problemNumber(number, count);
  for (const line of findingLines(review, n)) say(line);
  return EXIT.ok;
}

/**
 * `delivery findings approve|skip`: record the owner's choice for exactly the
 * problems named, by their identities, in the latest review's ledger. Every
 * number is checked before anything is written. A problem `delivery fix` has
 * already taken on keeps its choice.
 */
export async function decideCommand(choice: "approve" | "skip", numbers: string[], options: DecideOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const review = await finishedReview(repoPath);
  const { findings } = review.result;
  const takenOn = authorisations(await readLedger(review.dir));
  const open = (n: number): boolean => !takenOn.has(findings[n - 1]?.id ?? "");
  const blocked = (n: number): boolean => {
    const finding = findings[n - 1];
    return finding !== undefined && uncheckable(review.header, finding);
  };
  let chosen: number[];
  if (options.all === true) {
    if (options.allowUnchecked === true) throw new Refusal(ALL_UNCHECKED, EXIT.configuration);
    if (numbers.length > 0) throw new Refusal(ALL_AND_NUMBERS, EXIT.configuration);
    chosen = findings.map((_, index) => index + 1).filter((n) => open(n) && (choice === "skip" || !blocked(n)));
    if (chosen.length === 0) {
      ctx.report.note(NOTHING_LEFT);
      return EXIT.ok;
    }
  } else {
    if (numbers.length === 0) throw new Refusal(NOTHING_CHOSEN, EXIT.configuration);
    chosen = [
      ...new Set(
        numbers.map((asked) => {
          const n = /^\d+$/.test(asked) ? Number(asked) : 0;
          if (n < 1 || n > findings.length) throw new Refusal(noSuchProblem(asked, findings.length), EXIT.configuration);
          return n;
        }),
      ),
    ];
    const taken = chosen.find((n) => !open(n));
    if (taken !== undefined) throw new Refusal(alreadyTakenOn(taken), EXIT.configuration);
    const unchecked = choice === "approve" && options.allowUnchecked !== true ? chosen.find(blocked) : undefined;
    if (unchecked !== undefined) throw new Refusal(uncheckedRefused(unchecked), EXIT.configuration);
  }
  await appendLedger(review.dir, { t: "decision", ids: chosen.map((n) => findings[n - 1]?.id ?? ""), choice, ...(options.allowUnchecked === true ? { allowUnchecked: true as const } : {}) });
  if (choice === "skip") {
    ctx.report.note(skippedLine(chosen));
    return EXIT.ok;
  }
  for (const n of chosen) {
    if (blocked(n)) ctx.report.note(uncheckedApproved(n));
    else if (findings[n - 1]?.check.kind === "none") ctx.report.note(testsOnlyApproved(n));
  }
  ctx.report.note(approvedLine(chosen));
  return EXIT.ok;
}
