import { isAbsolute, posix, resolve } from "node:path";
import { resolvePack, type Pack } from "../packs/manifest.js";
import { projectPath } from "../packs/confirm.js";
import { fixNowLines, NOT_NOW, nothingInPart, onlyPart, opening, outsideProject, PREVIEW_INTRO, RECOVERED, reviewLines, failureSentence, checkLevel } from "../packs/render.js";
import { hiddenByDefault, readFindingStates, UNDECIDED, type FindingState } from "../packs/fix-state.js";
import { uncheckable, type SavedReview } from "../packs/review-record.js";
import { filesToReview, runReview } from "../packs/review.js";
import { resolveBaseRef } from "../provision.js";
import { scanSession, scannerRoleConfig } from "../packs/scanner-role.js";
import { RULE, toolsLine } from "./preview-command.js";
import { findingsDocument } from "../packs/findings-document.js";
import { agentSession } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { git } from "../git-exec.js";
import type { Ask, ChoiceQuestion, PickQuestion } from "./init.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { fixSettings } from "./fix-command.js";

/** Which problems to fix: every one that can be checked and that no earlier review settled, each picked to start with. */
export const pickQuestion = ({ header, result }: SavedReview, states: readonly FindingState[]): PickQuestion => ({
  message: "Which problems would you like fixed?",
  choices: result.findings.flatMap((finding, index) =>
    uncheckable(header, finding) || hiddenByDefault(states[index] ?? UNDECIDED)
      ? []
      : [{ value: String(index + 1), name: `${index + 1}. ${finding.title} (${finding.severity})`, description: `How we will know: ${checkLevel(header, finding.check.kind)}.` }],
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

export interface ReviewCommandOptions {
  /** Review only this part of the project: a folder or file, relative to where the command is typed. */
  path?: string;
  /** Print what the review agent would be told, and start nothing. */
  preview?: boolean;
}

/**
 * A part of the project as git names it, from what the owner typed relative to `startDir`; refused when it leads out.
 * `undefined` when it names the whole project (`--path .` at the top).
 */
export async function partToReview(startDir: string, raw: string): Promise<string | undefined> {
  // posix.join would silently re-root an absolute path under the prefix; refuse it instead, as projectPath does.
  if (isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw new Refusal(outsideProject(raw), EXIT.configuration);
  const prefix = (await git(startDir, ["rev-parse", "--show-prefix"])).trim();
  const joined = posix.normalize(posix.join(prefix, raw.replace(/\\/g, "/"))).replace(/\/$/, "");
  if (joined === ".") return undefined;
  const part = projectPath(joined);
  if (part === undefined) throw new Refusal(outsideProject(raw), EXIT.configuration);
  return part;
}

/**
 * `delivery review <pack> --preview`: what the review agent would be told, from the same `scanSession` and file listing
 * a review uses, at the commit a review would read. Only reads: no agent, no sign-in, no network, nothing written.
 */
async function previewReview(pack: Pack, repoPath: string, scope: string | undefined, ctx: CommandContext): Promise<ExitCode> {
  const files = await filesToReview(repoPath, (await resolveBaseRef(repoPath)).ref, scope);
  if (scope !== undefined && files.length === 0) throw new Refusal(nothingInPart(scope), EXIT.configuration);
  const { systemPrompt, prompt } = scanSession(pack, files, scope);
  const tools = scannerRoleConfig(pack).allowedTools;
  if (ctx.json) {
    ctx.writeLine(JSON.stringify({ systemPrompt, prompt, tools }, null, 2));
    return EXIT.ok;
  }
  const [title] = opening(pack.manifest.title);
  for (const line of [title ?? "", ...(scope === undefined ? [] : [onlyPart(scope)]), ...((await hasUncommittedChanges(repoPath)) ? [UNCOMMITTED_NOTE] : []), PREVIEW_INTRO, RULE, `${systemPrompt}\n\n${prompt}`, RULE, toolsLine(tools)]) {
    ctx.writeLine(line);
  }
  return EXIT.ok;
}

/**
 * `delivery review <pack> [repo]`: say what it is about to do, run the review,
 * and print the list. On a terminal it then offers the owner a choice; in a
 * pipe or with `--json` it never asks. The review's lines are notes, so under
 * `--json` they go to standard error and standard output stays clear.
 */
export async function reviewCommand(packArg: string, repoArg: string | undefined, ctx: CommandContext, ask: Ask, options: ReviewCommandOptions = {}): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, repoArg ?? ".");
  const repoPath = await findRepository(startDir);
  const pack = await resolvePack(packArg, ctx.cwd);
  const say = (line: string): void => ctx.report.note(line);
  const scope = options.path === undefined ? undefined : await partToReview(startDir, options.path);

  if (options.preview === true) return previewReview(pack, repoPath, scope, ctx);

  for (const line of opening(pack.manifest.title, scope)) say(line);
  if (await hasUncommittedChanges(repoPath)) say(UNCOMMITTED_NOTE);

  // The same question `delivery fix` asks, so what the review promises is what the fix does; but a review only reads,
  // so a JavaScript config is never run. ponytail: such a project may be warned it has no tests when its config
  // names a check; `delivery fix` asks again with the whole config, and a wrong warning only holds more fixes.
  const { verify } = await fixSettings({}, startDir, repoPath, ctx, true);
  const outcome = await runReview(repoPath, pack, { session: () => agentSession(ctx.env), env: ctx.env, noTests: verify === null, ...(scope === undefined ? {} : { scope }) });
  if (outcome.kind === "failed") throw new Refusal(failureSentence(outcome.terminus, packArg), EXIT.agentRuntime);
  if (outcome.kind === "empty_scope") throw new Refusal(nothingInPart(outcome.scope), EXIT.configuration);

  say("");
  if (outcome.recovered) say(RECOVERED);
  const { states } = await readFindingStates(repoPath, outcome.review);
  for (const line of reviewLines(outcome.review, states)) say(line);

  if (ctx.json) {
    ctx.writeLine(JSON.stringify(findingsDocument(outcome.review, states), null, 2));
  } else if (ctx.interactive === true && pickQuestion(outcome.review, states).choices.length > 0) {
    say("");
    const picked = await ask.pick(pickQuestion(outcome.review, states));
    const when = picked.length === 0 ? "later" : await ask.choose(WHEN_QUESTION);
    for (const line of when === "now" ? fixNowLines(picked.map(Number)) : [NOT_NOW]) say(line);
  }
  return EXIT.ok;
}
