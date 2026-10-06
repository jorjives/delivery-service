import { resolve } from "node:path";
import { keptFix, readFindingStates, type FindingState } from "../packs/fix-state.js";
import { appendLedger, type NotLandedReason } from "../packs/ledger.js";
import { CHECKING_SIGN_OFF, NOT_LANDED_WHY, PR_OPENED, STATE_WORDS, stateWords } from "../packs/render.js";
import { signOff } from "../packs/sign-off.js";
import { stripControl } from "../report/text.js";
import type { SavedReview } from "../packs/review-record.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { finishedReview, problemNumber } from "./findings-command.js";
import { findRepository } from "./project.js";

export interface SignOffOptions {
  repo?: string;
}

export const SIGN_OFF_BUSY = "Fixes are being made in this project right now. Sign off once they have finished; see where they are with: delivery status";
export const notWaiting = (number: number, words: string): string => `Problem ${number} is not waiting for your sign-off: it is ${words}. See where each stands with: delivery findings`;
export const alreadyMerged = (number: number): string => `Problem ${number} is already fixed and merged. Nothing was changed.`;
export const mergedLine = (number: number, words: string): string => `Passed. Problem ${number}: ${words}.`;
export const notMergedLine = (number: number, reason: NotLandedReason, branch: string): string => `Problem ${number} was not merged: ${NOT_LANDED_WHY[reason]}. The fix is kept on branch ${branch}.`;
export const declinedLine = (number: number, branch: string): string => `Declined the fix for problem ${number}. Nothing was merged; the fix is kept on branch ${branch} for an engineer.`;

/** A problem waiting for sign-off, or one whose sign-off failed: the only ones the owner can sign off or decline. */
const decidable = (at: FindingState): boolean => at.state === "held" || at.state === "signed_off_failed";

async function kept(number: string, options: SignOffOptions, ctx: CommandContext): Promise<{ repoPath: string; review: SavedReview; n: number; at: FindingState }> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const review = await finishedReview(repoPath);
  const n = problemNumber(number, review.result.findings.length);
  const { states } = await readFindingStates(repoPath, review);
  const at = states[n - 1];
  if (at === undefined) throw new Refusal(notWaiting(n, STATE_WORDS.proposed), EXIT.configuration);
  return { repoPath, review, n, at };
}

/** `delivery findings sign-off <n>`: re-check a kept fix on the current main copy and merge it. Safe to repeat. */
export async function signOffCommand(number: string, options: SignOffOptions, ctx: CommandContext): Promise<ExitCode> {
  const say = (line: string): void => ctx.report.note(line);
  const { repoPath, review, n, at } = await kept(number, options, ctx);
  if (at.state === "signed_off_landed") {
    say(alreadyMerged(n));
    return EXIT.ok;
  }
  const fix = keptFix(at);
  if (!decidable(at) || fix === undefined) throw new Refusal(notWaiting(n, stateWords(at)), EXIT.configuration);
  const finding = review.result.findings[n - 1];
  if (finding === undefined) throw new Refusal(notWaiting(n, stateWords(at)), EXIT.configuration);
  say(CHECKING_SIGN_OFF);
  const outcome = await signOff(repoPath, review.dir, finding.id, fix, ctx.env);
  if (outcome.kind === "busy") throw new Refusal(SIGN_OFF_BUSY, EXIT.configuration);
  if (outcome.kind === "landed") {
    say(mergedLine(n, outcome.closer.type === "open-pr" ? PR_OPENED : STATE_WORDS.signed_off_landed));
    return EXIT.ok;
  }
  say(notMergedLine(n, outcome.reason, fix.branch));
  say(`For engineers: ${stripControl(outcome.detail)}`);
  return EXIT.escalated;
}

/** `delivery findings reject <n>`: decline a kept fix. Nothing is merged and the branch is kept. */
export async function rejectCommand(number: string, options: SignOffOptions, ctx: CommandContext): Promise<ExitCode> {
  const { review, n, at } = await kept(number, options, ctx);
  const fix = keptFix(at);
  const finding = review.result.findings[n - 1];
  if (!decidable(at) || fix === undefined || finding === undefined) throw new Refusal(notWaiting(n, stateWords(at)), EXIT.configuration);
  await appendLedger(review.dir, { t: "rejected", id: finding.id });
  ctx.report.note(declinedLine(n, fix.branch));
  return EXIT.ok;
}
