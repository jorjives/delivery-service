import { resolve } from "node:path";
import { DamagedReview } from "../errors.js";
import { appendLedger, authorisations, readLedger } from "../packs/ledger.js";
import { readFindingStates } from "../packs/fix-state.js";
import { findingLines, listLines, NO_REVIEW_YET, unconfirmedLines, unfinishedReview } from "../packs/render.js";
import { listReviews, loadReview } from "../packs/review-record.js";
import type { SavedReview } from "../packs/review-record.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";

export interface FindingsOptions {
  repo?: string;
  unconfirmed?: boolean;
}

export interface DecideOptions {
  repo?: string;
  all?: boolean;
}

export const noSuchProblem = (asked: string, count: number): string =>
  `There is no problem ${asked} in the latest review: it lists ${count}. See the list with: delivery findings`;

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
 * or the ones that could not be confirmed. Only reads.
 */
export async function findingsCommand(number: string | undefined, options: FindingsOptions, ctx: CommandContext): Promise<ExitCode> {
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
  if (number === undefined) {
    const { states } = await readFindingStates(repoPath, review);
    for (const line of listLines(review, states)) say(line);
    return EXIT.ok;
  }
  const count = review.result.findings.length;
  const n = /^\d+$/.test(number) ? Number(number) : 0;
  if (n < 1 || n > count) throw new Refusal(noSuchProblem(number, count), EXIT.configuration);
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
  let chosen: number[];
  if (options.all === true) {
    if (numbers.length > 0) throw new Refusal(ALL_AND_NUMBERS, EXIT.configuration);
    chosen = findings.map((_, index) => index + 1).filter(open);
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
  }
  await appendLedger(review.dir, { t: "decision", ids: chosen.map((n) => findings[n - 1]?.id ?? ""), choice });
  if (choice === "skip") {
    ctx.report.note(skippedLine(chosen));
    return EXIT.ok;
  }
  for (const n of chosen) if (findings[n - 1]?.check.kind === "none") ctx.report.note(testsOnlyApproved(n));
  ctx.report.note(approvedLine(chosen));
  return EXIT.ok;
}
