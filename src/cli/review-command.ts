import { resolve } from "node:path";
import { resolvePack } from "../packs/manifest.js";
import { fixNowLines, NOT_NOW, opening, RECOVERED, reviewLines, failureSentence, checkLevel } from "../packs/render.js";
import { uncheckable, type SavedReview } from "../packs/review-record.js";
import { runReview } from "../packs/review.js";
import { agentSession } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import type { Ask, ChoiceQuestion, PickQuestion } from "./init.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { fixSettings } from "./fix-command.js";

/** Which problems to fix: every one that can be checked, each picked to start with. */
export const pickQuestion = ({ header, result }: SavedReview): PickQuestion => ({
  message: "Which problems would you like fixed?",
  choices: result.findings.flatMap((finding, index) =>
    uncheckable(header, finding) ? [] : [{ value: String(index + 1), name: `${index + 1}. ${finding.title} (${finding.severity})`, description: `How we will know: ${checkLevel(header, finding.check.kind)}.` }],
  ),
});

export const WHEN_QUESTION: ChoiceQuestion = {
  message: "Fix them now?",
  choices: [
    { value: "now", name: "Fix now", description: "Shows the commands that fix the ones you picked." },
    { value: "later", name: "Not now", description: "Nothing changes. The list stays saved for later." },
  ],
  default: "later",
};

/**
 * `delivery review <pack> [repo]`: say what it is about to do, run the review,
 * and print the list. On a terminal it then offers the owner a choice; in a
 * pipe or with `--json` it never asks. The review's lines are notes, so under
 * `--json` they go to standard error and standard output stays clear.
 */
export async function reviewCommand(packArg: string, repoArg: string | undefined, ctx: CommandContext, ask: Ask): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, repoArg ?? "."));
  const pack = await resolvePack(packArg, ctx.cwd);
  const say = (line: string): void => ctx.report.note(line);

  for (const line of opening(pack.manifest.title)) say(line);
  if (await hasUncommittedChanges(repoPath)) say(UNCOMMITTED_NOTE);

  // The same question `delivery fix` asks, so what the review promises is what the fix does.
  const { verify } = await fixSettings({}, resolve(ctx.cwd, repoArg ?? "."), repoPath, ctx);
  const outcome = await runReview(repoPath, pack, { session: () => agentSession(ctx.env), env: ctx.env, noTests: verify === null });
  if (outcome.kind === "failed") throw new Refusal(failureSentence(outcome.terminus, packArg), EXIT.agentRuntime);

  say("");
  if (outcome.recovered) say(RECOVERED);
  for (const line of reviewLines(outcome.review)) say(line);

  if (ctx.interactive === true && pickQuestion(outcome.review).choices.length > 0) {
    say("");
    const picked = await ask.pick(pickQuestion(outcome.review));
    const when = picked.length === 0 ? "later" : await ask.choose(WHEN_QUESTION);
    for (const line of when === "now" ? fixNowLines(picked.map(Number)) : [NOT_NOW]) say(line);
  }
  return EXIT.ok;
}
