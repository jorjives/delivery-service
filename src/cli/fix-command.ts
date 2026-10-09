import { resolve } from "node:path";
import { git } from "../git-exec.js";
import { atOrAbove, thresholdOf, type SignOffThreshold } from "../packs/finding.js";
import { checkFinding } from "../packs/finding-check.js";
import { thresholdLine } from "../packs/render.js";
import { FINDING_GATE_REF } from "../packs/finding-gate.js";
import { FINDING_CLOSER_REF } from "../packs/finding-closer.js";
import type { FixTask } from "../packs/fix-task.js";
import { readFindingStates } from "../packs/fix-state.js";
import { findingsDocument } from "../packs/findings-document.js";
import { appendLedger, allowedTestEdits } from "../packs/ledger.js";
import { guardListsFor } from "../packs/guards.js";
import { planConfig, writePlan } from "../packs/plan.js";
import { listLines } from "../packs/render.js";
import { uncheckable } from "../packs/review-record.js";
import type { CloserRef, GateRef, TaskDef } from "../schema.js";
import { loadConfig, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { finishedReview } from "./findings-command.js";
import { findRepository, hasUncommittedChanges, NO_CHECK, UNCOMMITTED_NOTE } from "./project.js";
import { refuseIfRunGoing, runQueue } from "./queue.js";
import { checkCustomModules, resolveProject, type ProjectSettings } from "./settings.js";

export interface FixOptions {
  repo?: string;
  concurrency?: string;
  /** How serious a problem must be for its fix to wait for sign-off; absent: the pack's own. Recorded with the authorisation. */
  signOffThreshold?: SignOffThreshold;
}

export const NOTHING_APPROVED = "Nothing is approved to fix yet. Choose with: delivery findings approve 1 3, or delivery findings approve --all";
export const ALL_FINISHED = "Every problem you approved has already been dealt with. See where each one ended up with: delivery findings";
export const fixingLine = (count: number, concurrency: number): string =>
  `Fixing ${count} ${count === 1 ? "problem" : "problems"} you approved, up to ${concurrency} at once. Watch it with: delivery status --watch`;
export const alreadyFixedLine = (count: number): string =>
  `${count} ${count === 1 ? "problem you approved is" : "problems you approved are"} already fixed: the code ${count === 1 ? "it points" : "they point"} at is no longer in your project.`;

/** How a fix lands when the project names no closer: merged into the branch it came from. */
const MERGE_BACK: CloserRef = { type: "merge-back" };

/** The project's check as a fix pins it: a module of the project's own by its full path, since a fix's check is loaded from the harness, not the project. */
const pinned = (gate: GateRef, repoPath: string): GateRef => (gate.type === "custom" ? { ...gate, modulePath: resolve(repoPath, gate.modulePath) } : gate);

/** The project's closer as a fix pins it: a module of the project's own by its full path, since a fix's closer is loaded from the harness. */
const pinnedCloser = (closer: CloserRef, repoPath: string): CloserRef => (closer.type === "custom" ? { ...closer, modulePath: resolve(repoPath, closer.modulePath) } : closer);

/**
 * The project's settings for its fixes: its own configuration only (never a plan), merging back unless it names
 * another closer; and the project's own check of a fix, pinned by its full path, or null when no test command can
 * be found. With none, a fix is judged by its own check alone (the finding gate needs no project check) and always
 * waits for sign-off.
 */
export async function fixSettings(options: FixOptions, startDir: string, repoPath: string, ctx: CommandContext, dataOnly = false): Promise<{ config: DeliveryConfig; project: ProjectSettings; verify: GateRef | null }> {
  const config = await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env, dataOnly });
  const landing = { ...config, closer: config.closer ?? MERGE_BACK };
  const settle = (from: DeliveryConfig): Promise<ProjectSettings> => resolveProject({ concurrency: options.concurrency }, { env: ctx.env, repoPath, config: from });
  try {
    const project = await settle(landing);
    return { config, project, verify: pinned(project.gateRef, repoPath) };
  } catch (err) {
    if (!(err instanceof Refusal && err.message === NO_CHECK)) throw err;
  }
  // Every fix is judged by the harness's own check anyway; with no tests it is the only one.
  return { config, project: await settle({ ...landing, gate: FINDING_GATE_REF }), verify: null };
}

/**
 * `delivery fix`: fix every problem approved in the latest review, each an
 * ordinary task in its own working copy, judged by its own check and the
 * project's tests (if you have any), and landed by the project's way of landing work or kept for sign-off. Run again,
 * it works only on approved problems not yet finished: each task is identified
 * by its content, so a finished fix is never started twice.
 */
export async function fixCommand(options: FixOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const say = (line: string): void => ctx.report.note(line);
  await refuseIfRunGoing(repoPath);
  const review = await finishedReview(repoPath);
  const { findings } = review.result;

  const { entries, states } = await readFindingStates(repoPath, review);
  const fresh = findings.filter((_, index) => states[index]?.state === "approved");
  if (fresh.length === 0 && !states.some((at) => at.state === "fixing")) {
    if (states.some((at) => at.state !== "proposed" && at.state !== "skipped" && at.state !== "needs_decision")) {
      say(ALL_FINISHED);
      // Standard output under --json is one JSON object per line (the steps); the closing document is one more line.
      if (ctx.json) ctx.writeLine(JSON.stringify(findingsDocument(review, states)));
      return EXIT.ok;
    }
    throw new Refusal(NOTHING_APPROVED, EXIT.configuration);
  }

  const { config, project, verify } = await fixSettings(options, startDir, repoPath, ctx);
  if (fresh.length > 0) {
    const threshold = options.signOffThreshold === undefined ? (review.header.pack.hold ?? null) : thresholdOf(options.signOffThreshold);
    if (options.signOffThreshold !== undefined) say(thresholdLine(threshold));
    // The owner let these fixes change existing tests: recorded with the authorisation, and each always waits for sign-off.
    const testEdits = allowedTestEdits(entries);
    const edits = fresh.filter((finding) => testEdits.has(finding.id)).map((finding) => finding.id);
    // With nothing to check a fix broke nothing else, now or when the review was made, or when the owner approved it without a check, the owner is the final check of every fix.
    await appendLedger(review.dir, {
      t: "authorise",
      ids: fresh.map((finding) => finding.id),
      verify,
      guards: guardListsFor(review.header.pack.guards),
      threshold,
      ...(edits.length === 0 ? {} : { allowTestEdits: edits }),
      hold: Object.fromEntries(fresh.map((finding) => [finding.id, verify === null || review.header.noTests === true || uncheckable(review.header, finding) || testEdits.has(finding.id) || atOrAbove(finding.severity, threshold)])),
      landing: pinnedCloser(project.closerRef, repoPath),
      review: review.header.reviewId,
    });
  }

  // Every problem now "fixing": new ones, and any an interrupted run left under way (those resume, and are never skipped).
  const now = await readFindingStates(repoPath, review);
  const fixing = new Set(findings.filter((_, index) => now.states[index]?.state === "fixing").map((finding) => finding.id));
  const pending = now.tasks.filter((task) => fixing.has(task.finding.id));
  let exitCode: ExitCode = EXIT.ok;
  if (pending.length > 0) {
    const plan = planConfig(now.tasks, project, config, review.header.pack.fixInstructions);
    await writePlan(review.dir, plan);
    await checkCustomModules(FINDING_GATE_REF, project.closerRef, repoPath);
    if (await hasUncommittedChanges(repoPath)) say(UNCOMMITTED_NOTE);
    say(fixingLine(pending.length, project.concurrency));

    // The precondition: asked as each fix is about to start, against the main copy as every earlier fix left it
    // (a merge-back lands on the checked-out branch before the next slot fills), so it also catches one fix
    // removing the code another approved problem pointed at. The tasks are `FixTask`s, so each carries its problem.
    let gone = 0;
    const skip = async (task: TaskDef): Promise<boolean> => {
      const { finding } = task as FixTask;
      const commit = await git(repoPath, ["rev-parse", "HEAD"]);
      if ((await checkFinding(finding, { repoPath, commit })) !== "resolved") return false;
      await appendLedger(review.dir, { t: "fix_observed", id: finding.id, outcome: "already_resolved", commit });
      gone += 1;
      return true;
    };
    exitCode = await runQueue(pending, { ...project, gateRef: FINDING_GATE_REF, closerRef: FINDING_CLOSER_REF, roleOverrides: plan.roles }, { repoPath, carryOn: true, skip }, ctx);
    if (gone > 0) {
      say(alreadyFixedLine(gone));
      // Problems passed over have no task any more (`fixTasks`), so the plan the reading commands show drops them.
      await writePlan(review.dir, planConfig((await readFindingStates(repoPath, review)).tasks, project, config, review.header.pack.fixInstructions));
    }
  }

  const after = await readFindingStates(repoPath, review);
  say("");
  for (const line of listLines(review, after.states)) say(line);
  // Standard output under --json is one JSON object per line (the steps); the closing document is one more line.
  if (ctx.json) ctx.writeLine(JSON.stringify(findingsDocument(review, after.states)));
  return exitCode;
}
