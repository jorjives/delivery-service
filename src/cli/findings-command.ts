import { resolve } from "node:path";
import { DamagedReview } from "../errors.js";
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

export const noSuchProblem = (asked: string, count: number): string =>
  `There is no problem ${asked} in the latest review: it lists ${count}. See the list with: delivery findings`;

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
