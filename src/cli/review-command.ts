import { isAbsolute, posix, resolve } from "node:path";
import { BACKLOG_DIR } from "../backlog.js";
import { git } from "../git-exec.js";
import { heldFollowUps } from "../follow-ups.js";
import { projectPath } from "../item-check.js";
import { ledgerPath } from "../item-ledger.js";
import { resolveBaseRef } from "../provision.js";
import { resolvePack, scanWorkflowOf, type Pack } from "../packs/manifest.js";
import { runIdFor } from "../run-location.js";
import type { RunRecord } from "../run-records.js";
import { taskIntent } from "../task-list.js";
import type { TaskDef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import { loadConfig, sourceName, trackerSource } from "./config.js";
import type { CommandContext } from "./context.js";
import { startRun, fenceAtStart } from "./drive.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { afterLanding } from "./after-landing.js";
import { previewCommand } from "./preview-command.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { queueTasks } from "./queue.js";
import { holdingRepo } from "./run-exclusion.js";
import { allRuns, readRun } from "./runs.js";
import { checkCustomModules, resolveProject, workflowFrom } from "./settings.js";
import { closingReport } from "./report-command.js";

export interface ReviewCommandOptions {
  path?: string;
  preview?: boolean;
}

export const NOTHING_FOUND = "The review found nothing to add to your backlog.";
export const reviewed = (n: number): string[] =>
  n === 0 ? [NOTHING_FOUND] : [`The review added ${n === 1 ? "1 idea" : `${n} ideas`} to your backlog.`, "Read them with: delivery backlog", "Choose what to fix with: delivery approve <ids>, or delivery approve --all"];
export const raised = (n: number, source: string): string[] =>
  n === 0 ? [NOTHING_FOUND] : [`The review raised ${n === 1 ? "1 idea" : `${n} ideas`} in ${source}, without the label you deliver by.`, "On GitHub, adding the label is the approval: the next delivery run --sources fixes each one you label."];
export const packNotListed = (dir: string): string => `The review in ${dir} is not one your project uses yet. Add its folder under "packs" in delivery.config.json, then run delivery review with its name.`;
const outsideProject = (raw: string): string => `"${raw}" is not inside your project. Name a folder or file in it, relative to where you are, for example: delivery review code --path src`;

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

/** What a review's run is asked: the pack's title, and the part of the project it looks at. */
export function reviewTask(pack: Pack, part: string | undefined): TaskDef {
  const where = part === undefined ? "this project" : `only ${part} in this project`;
  return { intent: `${pack.manifest.title} of ${where}`, body: `Review ${where} and add one idea to the backlog for each problem you find, as the step says. Change nothing else.` };
}

/**
 * `delivery review <pack>`: the pack's scan workflow, run once as an ordinary run (spec 5.13). Its ideas land on the
 * branch you are on, by merge-back; on a project whose backlog is a tracker they are raised there instead, unlabelled.
 */
export async function reviewCommand(packName: string, repoArg: string | undefined, options: ReviewCommandOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, repoArg ?? ".");
  const repoPath = await findRepository(startDir);
  const config = await loadConfig({ startDir, repoPath, flag: undefined, env: ctx.env });
  const pack = await resolvePack(packName, ctx.cwd);
  const workflowName = scanWorkflowOf(pack.manifest.name);
  if (config.workflows?.[workflowName] === undefined) throw new Refusal(packNotListed(pack.dir), EXIT.configuration);
  const part = options.path === undefined ? undefined : await partToReview(ctx.cwd, options.path);
  const taskDef = reviewTask(pack, part);
  if (options.preview === true) return previewCommand({ repo: repoPath, role: "worker", step: "scan", workflow: workflowName, task: taskIntent(taskDef) }, ctx);

  // Scanning drives the checkout as any run does, so the review holds the repository while its agent works.
  return holdingRepo(repoPath, {}, ctx, async () => {
    const project = await resolveProject({ closer: "merge-back" }, { env: ctx.env, repoPath, config });
    const workflow = await workflowFrom(workflowName, config, repoPath);
    await checkCustomModules(project.gateRef, project.closerRef, repoPath, workflow);
    const tracker = trackerSource(config);
    const session = await agentSession(ctx.env);
    const fenceRecord = await fenceAtStart(project.fence, repoPath, ctx);
    if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
    const runId = runIdFor(taskIntent(taskDef), new Date());
    const key = `review:${pack.manifest.name}`;
    const item = tracker === undefined ? undefined : { key, source: sourceName(tracker), id: pack.manifest.name, raise: true as const };
    const exitCode = await startRun({ repoPath, ...project, taskDef, workflow, runId, fenceRecord, ...(item === undefined ? {} : { item }) }, session, ctx);
    const record = await readRun(repoPath, runId);
    if (record.caseFile.outcome?.kind === "closed") {
      if (tracker === undefined) {
        const added = await addedIdeas(repoPath, record);
        for (const line of reviewed(added)) ctx.writeLine(line);
      } else {
        // Raised through the after phase, so a raise that fails is retried by the next `delivery run --sources` (spec 5.7).
        const base = record.caseFile.header.baseBranch ?? (await resolveBaseRef(repoPath)).localBranch;
        const commit = await git(repoPath, ["rev-parse", `refs/heads/${base}`]);
        const after = afterLanding({ repoPath, config, project, itemLedger: ledgerPath(repoPath, ctx.env), branch: base, base, records: () => allRuns(repoPath) }, ctx);
        await after.landed({ landed: [{ t: "landed", branch: base, runId, key, intent: taskIntent(taskDef), commit, at: new Date().toISOString() }], commit });
        for (const line of raised((await heldFollowUps(record.dir)).length, sourceName(tracker))) ctx.writeLine(line);
      }
    }
    await closingReport(repoPath, { kind: "task", runId }, queueTasks(config), ctx, config.notify);
    return exitCode;
  });
}

/** How many ideas the review's run merged onto the branch it started from. */
async function addedIdeas(repoPath: string, record: RunRecord): Promise<number> {
  const { startCommit, baseBranch } = record.caseFile.header;
  if (startCommit === undefined || baseBranch === null) return 0;
  return (await git(repoPath, ["diff", "--name-only", "--diff-filter=A", "-z", startCommit, `refs/heads/${baseBranch}`, "--", `${BACKLOG_DIR}/`], { raw: true })).split("\0").filter(Boolean).length;
}
