import { resolve } from "node:path";
import { git } from "../git-exec.js";
import { checkFinding } from "../packs/finding-check.js";
import { FINDING_GATE_REF } from "../packs/finding-gate.js";
import type { FixTask } from "../packs/fix-task.js";
import { readFindingStates } from "../packs/fix-state.js";
import { appendLedger } from "../packs/ledger.js";
import { planConfig, writePlan } from "../packs/plan.js";
import { listLines } from "../packs/render.js";
import type { CloserRef, GateRef, TaskDef } from "../schema.js";
import { loadConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { finishedReview } from "./findings-command.js";
import { findRepository, hasUncommittedChanges, NO_CHECK, UNCOMMITTED_NOTE } from "./project.js";
import { refuseIfRunGoing, runQueue } from "./queue.js";
import { checkCustomModules, resolveProject, type ProjectSettings } from "./settings.js";

export interface FixOptions {
  repo?: string;
  concurrency?: string;
}

export const NOTHING_APPROVED = "Nothing is approved to fix yet. Choose with: delivery findings approve 1 3, or delivery findings approve --all";
export const ALL_FINISHED = "Every problem you approved has already been dealt with. See where each one ended up with: delivery findings";
export const NO_FIX_CHECK =
  "I couldn't find your project's tests to check each fix against. Add a `test` script to your `package.json`, or set `gate` in delivery.config.json.";
export const fixingLine = (count: number, concurrency: number): string =>
  `Fixing ${count} ${count === 1 ? "problem" : "problems"} you approved, up to ${concurrency} at once. Watch it with: delivery status --watch`;
export const alreadyFixedLine = (count: number): string =>
  `${count} ${count === 1 ? "problem you approved is" : "problems you approved are"} already fixed: the code ${count === 1 ? "it points" : "they point"} at is no longer in your project.`;

/** How a fix lands when the project names no closer: merged into the branch it came from. */
const MERGE_BACK: CloserRef = { type: "merge-back" };

/** The project's check as a fix pins it: a module of the project's own by its full path, since a fix's check is loaded from the harness, not the project. */
const pinned = (gate: GateRef, repoPath: string): GateRef => (gate.type === "custom" ? { ...gate, modulePath: resolve(repoPath, gate.modulePath) } : gate);

/** The project's settings for its fixes: its own configuration only (never a plan), merging back unless it names another closer. */
async function fixSettings(options: FixOptions, startDir: string, repoPath: string, ctx: CommandContext) {
  const config = await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env });
  try {
    const project: ProjectSettings = await resolveProject({ concurrency: options.concurrency }, { env: ctx.env, repoPath, config: { ...config, closer: config.closer ?? MERGE_BACK } });
    return { config, project };
  } catch (err) {
    if (err instanceof Refusal && err.message === NO_CHECK) throw new Refusal(NO_FIX_CHECK, EXIT.configuration, "gate");
    throw err;
  }
}

/**
 * `delivery fix`: fix every problem approved in the latest review, each an
 * ordinary task in its own working copy, judged by its own check and the
 * project's tests, and landed by the project's way of landing work. Run again,
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

  const { states } = await readFindingStates(repoPath, review);
  const fresh = findings.filter((_, index) => states[index]?.state === "approved");
  if (fresh.length === 0 && !states.some((at) => at.state === "fixing")) {
    if (states.some((at) => at.state !== "proposed" && at.state !== "skipped")) {
      say(ALL_FINISHED);
      return EXIT.ok;
    }
    throw new Refusal(NOTHING_APPROVED, EXIT.configuration);
  }

  const { config, project } = await fixSettings(options, startDir, repoPath, ctx);
  if (fresh.length > 0) await appendLedger(review.dir, { t: "authorise", ids: fresh.map((finding) => finding.id), verify: pinned(project.gateRef, repoPath) });

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
    exitCode = await runQueue(pending, { ...project, gateRef: FINDING_GATE_REF, roleOverrides: plan.roles }, { repoPath, carryOn: true, skip }, ctx);
    if (gone > 0) {
      say(alreadyFixedLine(gone));
      // Problems passed over have no task any more (`fixTasks`), so the plan the reading commands show drops them.
      await writePlan(review.dir, planConfig((await readFindingStates(repoPath, review)).tasks, project, config, review.header.pack.fixInstructions));
    }
  }

  const after = await readFindingStates(repoPath, review);
  say("");
  for (const line of listLines(review, after.states)) say(line);
  return exitCode;
}
