import { isAbsolute, posix, resolve } from "node:path";
import { BACKLOG_DIR } from "../backlog.js";
import { git } from "../git-exec.js";
import { heldFollowUps } from "../follow-ups.js";
import { projectPath } from "../item-check.js";
import { ledgerPath } from "../item-ledger.js";
import { resolveBaseRef } from "../provision.js";
import { IDEA_CAP, resolvePack, type Pack } from "../packs/manifest.js";
import { runIdFor } from "../run-location.js";
import type { RunRecord } from "../run-records.js";
import { taskIntent } from "../task-list.js";
import type { TaskDef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import { loadConfigAndPacks, sourceName, trackerSource } from "./config.js";
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
export const packNotListed = (pack: Pack): string => `The pack "${pack.manifest.name}" in ${pack.dir} is not one your project uses yet. List its folder under "packs" in delivery.config.json, then start it with: delivery review ${pack.manifest.name}`;
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

/** The line a `delivery.pack/3` find ends on when it may have been cut short by the cap. */
export const MAY_BE_MORE = "There may be more: run it again once these have landed.";
/** A pack's title as a sentence's subject: without the full stop it may end with. */
const titleWords = (pack: Pack): string => pack.manifest.title.replace(/\.$/, "");
const countOf = (n: number): string => (n === 1 ? "1 idea" : `${n} ideas`);
const capFor = (n: number): string[] => (n >= IDEA_CAP ? [MAY_BE_MORE] : []);
/** The tracker's name as an owner reads it. */
const named = (source: string): string => (source === "github" ? "GitHub" : source);

export const nothingFound = (pack: Pack): string => `${titleWords(pack)} found nothing to add. That is the agent's reading of your project, not a guarantee.`;
export const packStarting = (pack: Pack, part: string | undefined): string[] => [
  `Starting: ${titleWords(pack)}. This reads ${part === undefined ? "your project" : `only ${part} in your project`} and adds to your backlog; it changes nothing else.`,
  pack.manifest.summary,
];
export const packAdded = (pack: Pack, n: number): string[] =>
  n === 0
    ? [nothingFound(pack)]
    : [`The pack added ${countOf(n)} to your backlog.`, "Read them with: delivery backlog", "Choose which to act on with: delivery approve <ids>, or delivery approve --all", ...capFor(n)];
export const packRaised = (pack: Pack, n: number, source: string): string[] =>
  n === 0
    ? [nothingFound(pack)]
    : [`The pack raised ${countOf(n)} in ${named(source)}, without the label you deliver by.`, "On GitHub, adding the label is the approval: the next delivery run --sources acts on each one you label.", ...capFor(n)];
export const packTask = (pack: Pack, part: string | undefined): TaskDef => {
  const where = part === undefined ? "this project" : `only ${part} in this project`;
  return {
    intent: part === undefined ? `${titleWords(pack)} in this project` : `${titleWords(pack)}, only ${part} in this project`,
    body: `Look through ${where} as the step says, and add one idea to the backlog for each thing it asks you to find. Change nothing else.`,
  };
};

/** Every line a find prints, and its run's task: the owner's words for the pack's schema. */
export interface FindWords {
  starting(part: string | undefined): string[];
  task(part: string | undefined): TaskDef;
  added(n: number): string[];
  raised(n: number, source: string): string[];
}

/** A `delivery.pack/2` pack keeps the review's words exactly; a `delivery.pack/3` pack speaks in its own title and summary. */
export function findWords(pack: Pack): FindWords {
  if (pack.schema === "delivery.pack/2") return { starting: () => [], task: (part) => reviewTask(pack, part), added: reviewed, raised };
  return {
    starting: (part) => packStarting(pack, part),
    task: (part) => packTask(pack, part),
    added: (n) => packAdded(pack, n),
    raised: (n, source) => packRaised(pack, n, source),
  };
}

/**
 * `delivery review <pack>`: the pack's scan workflow, run once as an ordinary run (spec 5.13). Its ideas land on the
 * branch you are on, by merge-back; on a project whose backlog is a tracker they are raised there instead, unlabelled.
 */
export async function reviewCommand(packName: string, repoArg: string | undefined, options: ReviewCommandOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, repoArg ?? ".");
  const repoPath = await findRepository(startDir);
  const { config, packs } = await loadConfigAndPacks({ startDir, repoPath, flag: undefined, env: ctx.env });
  const pack = await resolvePack(packName, ctx.cwd, packs);
  const workflowName = pack.find;
  const findSteps = config.workflows?.[workflowName]?.steps;
  if (findSteps === undefined) throw new Refusal(packNotListed(pack), EXIT.configuration);
  const part = options.path === undefined ? undefined : await partToReview(ctx.cwd, options.path);
  const words = findWords(pack);
  const taskDef = words.task(part);
  if (options.preview === true) return previewCommand({ repo: repoPath, role: "worker", step: findSteps[0]?.name, workflow: workflowName, task: taskIntent(taskDef) }, ctx);

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
    for (const line of words.starting(part)) ctx.writeLine(line);
    const exitCode = await startRun({ repoPath, ...project, taskDef, workflow, runId, fenceRecord, ...(item === undefined ? {} : { item }) }, session, ctx);
    const record = await readRun(repoPath, runId);
    if (record.caseFile.outcome?.kind === "closed") {
      if (tracker === undefined) {
        const added = await addedIdeas(repoPath, record);
        for (const line of words.added(added)) ctx.writeLine(line);
      } else {
        // Raised through the after phase, so a raise that fails is retried by the next `delivery run --sources` (spec 5.7).
        const base = record.caseFile.header.baseBranch ?? (await resolveBaseRef(repoPath)).localBranch;
        const commit = await git(repoPath, ["rev-parse", `refs/heads/${base}`]);
        const after = afterLanding({ repoPath, config, project, itemLedger: ledgerPath(repoPath, ctx.env), branch: base, base, records: () => allRuns(repoPath) }, ctx);
        await after.landed({ landed: [{ t: "landed", branch: base, runId, key, intent: taskIntent(taskDef), commit, at: new Date().toISOString() }], commit });
        for (const line of words.raised((await heldFollowUps(record.dir)).length, sourceName(tracker))) ctx.writeLine(line);
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
