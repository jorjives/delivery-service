import { InvalidArgumentError } from "commander";
import { resolve } from "node:path";
import { DEFAULT_ROLES } from "../agent-invoke.js";
import { initialCaseFile } from "../case-file.js";
import { assemblePrompt, type PromptEvidence } from "../prompt-assembly.js";
import { unmatchedTaskPlaceholders } from "../placeholders.js";
import type { AgentOptions, PinnedWorkflow, TaskDef } from "../schema.js";
import type { AppliedSetting } from "../packs/settings.js";
import { stepView } from "../workflow-step.js";
import { andList, findConfig, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { entryWorkflow, EVERY_TASK_DONE, nextQueueTask, queueTasks, taskHeading } from "./queue.js";
import { allRuns } from "./runs.js";
import { taskIntent } from "../task-list.js";
import { OWN_SETUP } from "./own-setup.js";
import { NO_TASK, unknownWorkflow, workflowFrom } from "./settings.js";
import { defaultProject, readProject, type ValidateOptions } from "./validate-command.js";

/** The roles an owner can see the instructions of. Triage is the harness's own and is not configurable from the file. */
export type PreviewRole = "worker" | "gate-maintenance";
export const PREVIEW_ROLES: readonly PreviewRole[] = ["worker", "gate-maintenance"];

/** What `delivery preview` was given on the command line. */
export interface PreviewOptions extends ValidateOptions {
  /** Which task on the list, counted from 1 as "Task N of M" counts. */
  queueIndex?: number;
  role: PreviewRole;
  /** A workflow step to show instead of the task's single step. */
  step?: string;
  /** Which workflow `step` is in, when more than one has a step of that name. */
  workflow?: string;
  /** A task typed now, as `delivery run --task` takes it, instead of one from the file. */
  task?: string;
}

export const unmatchedWarning = (placeholder: string, step: string | undefined): string =>
  `Warning: step \`${step}\` has the placeholder \`${placeholder}\`, and the task has no such field, so the agent would be sent it as written.`;
export const noSuchStep = (step: string): string => `None of your workflows has a step called \`${step}\`.`;
export const stepInMany = (step: string, workflows: string[]): string =>
  `More than one workflow has a step called \`${step}\` (${andList(workflows)}). Add \`--workflow <name>\` to say which.`;
export const stepHeading = (index: number, of: number, workflow: string, step: string): string =>
  `Step ${index} of ${of} of the workflow \`${workflow}\`: ${step}`;
export const CONTINUES = "This step continues the previous step's agent session on its first attempt; a retry starts fresh.";

/** The workflow and the step in it to preview, or undefined when no step was asked for. */
async function chooseStep(config: DeliveryConfig, repoPath: string, options: PreviewOptions, entry: string | undefined): Promise<{ workflow: PinnedWorkflow; index: number } | undefined> {
  // A list entry that names a workflow is previewed in it; --workflow is for the entries that name none.
  const chosen = entry ?? options.workflow;
  if (options.step === undefined && chosen === undefined) return undefined;
  const known = Object.keys(config.workflows ?? {});
  if (chosen !== undefined && !known.includes(chosen)) {
    throw new Refusal(unknownWorkflow(chosen, known), EXIT.configuration);
  }
  const named = chosen === undefined ? known : [chosen];
  // `--workflow` alone shows its first step.
  const wanted = options.step ?? config.workflows?.[named[0] ?? ""]?.steps[0]?.name;
  const holding = named.filter((name) => config.workflows?.[name]?.steps.some((step) => step.name === wanted));
  const [only] = holding;
  if (only === undefined || wanted === undefined) throw new Refusal(noSuchStep(options.step ?? ""), EXIT.configuration);
  if (holding.length > 1) throw new Refusal(stepInMany(wanted, holding), EXIT.configuration);
  const workflow = await workflowFrom(only, config, repoPath);
  if (workflow === undefined) return undefined;
  return { workflow, index: workflow.steps.findIndex((step) => step.name === wanted) + 1 };
}

export const noSuchTask = (n: number, of: number): string => `There's no task ${n}; your queue has ${of}.`;

export const SINGLE_TASK =
  "This project has a single `task`, not a list, so there's no task number to choose. Leave out `--queue-index` to see it.";

export const TASK_NUMBER = 'A task number is a whole number from 1, as in "Task 1 of 3".';

/** `--queue-index`'s value as a task number, or commander's own refusal naming the option. */
export function taskNumber(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError(TASK_NUMBER);
  return n;
}

/** The line above and below the instructions, so where they start and stop is never in doubt. */
export const RULE = "─".repeat(53);

/** Who the instructions are for, as a person reads it. */
const WHO: Record<PreviewRole, string> = {
  worker: "the worker",
  "gate-maintenance": "the agent that repairs your check",
};

/** The line above the instructions: whose they are, and that they are added to Claude Code's own rather than replacing them. */
export const previewIntro = (role: PreviewRole): string => `What ${WHO[role]} will be told (before any run starts), added to Claude Code's own instructions:`;

/** The line naming each setting a previewed step uses, its value, and whether the value is the pack's default or the owner's. */
export const settingsUsedLine = (applied: readonly AppliedSetting[]): string =>
  `Settings used: ${applied.map((a) => `${a.name} = ${a.value} (${a.source === "default" ? "default" : "your configuration"})`).join(", ")}.`;

/** The options passed to every session, as written in the file. `append` is left out: it is already in the instructions above. */
export function agentOptionsLine(agent: AgentOptions | undefined): string {
  const named = Object.entries(agent ?? {})
    .filter(([key]) => key !== "append")
    .map(([key, value]) => `${key} ${JSON.stringify(value)}`);
  return `Agent options: ${named.length === 0 ? "none" : named.join(", ")}.`;
}

/**
 * What a run's first dispatch has to go on besides its record: nothing yet.
 * No brief, because nothing has been tried; no failing checks; no setback.
 */
const FIRST_DISPATCH: PromptEvidence = { brief: null, newFailures: [], setback: null };

/**
 * The task to preview, and the line that names it: the one asked for by
 * number, or the one `delivery run` would act on next. Undefined when nothing
 * was asked for by number and every task on the list is done.
 */
async function chooseTask(
  config: DeliveryConfig,
  repoPath: string,
  queueIndex: number | undefined,
  task: string | undefined,
): Promise<{ heading: string; taskDef: TaskDef } | undefined> {
  if (task !== undefined) return { heading: `Your task: ${task}`, taskDef: { intent: task } };
  if (config.tasks) {
    const tasks = queueTasks(config);
    if (queueIndex !== undefined) {
      const taskDef = tasks[queueIndex - 1];
      if (taskDef === undefined) throw new Refusal(noSuchTask(queueIndex, tasks.length), EXIT.configuration);
      return { heading: taskHeading({ task: queueIndex, of: tasks.length }, taskIntent(taskDef)), taskDef };
    }
    const next = nextQueueTask(await allRuns(repoPath), tasks);
    if (next === undefined) return undefined;
    const taskDef = tasks[next.task - 1] as TaskDef;
    return { heading: `Next up is ${taskHeading(next, taskIntent(taskDef))}`, taskDef };
  }
  if (!config.task) throw new Refusal(NO_TASK, EXIT.configuration);
  if (queueIndex !== undefined) throw new Refusal(SINGLE_TASK, EXIT.configuration);
  return { heading: `Your task: ${taskIntent(config.task)}`, taskDef: config.task };
}

/**
 * `delivery preview`: print, before anything runs, exactly what an agent
 * would be told about this project and one of its tasks.
 *
 * Nothing here renders a prompt. The record a run of the task would start
 * with comes from `initialCaseFile`, the roles from the shipped defaults,
 * as a run's driver takes them, and the text from the library's own `assemblePrompt`:
 * the same function, on the same inputs, a run's first dispatch uses. Everything
 * else is a read, so it needs no agent, no sign-in and no network, and is safe
 * beside a run in progress.
 */
export async function previewCommand(options: PreviewOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const { config, project, packs } = file === undefined ? await defaultProject(repoPath, ctx.env) : await readProject(file, repoPath, ctx.env);
  const chosen = await chooseTask(config, repoPath, options.queueIndex, options.task);
  if (chosen === undefined) {
    ctx.writeLine(EVERY_TASK_DONE);
    return EXIT.ok;
  }

  const { gateRef, closerRef, domainPrompt, agent, budgets } = project;
  // The id is fixed rather than made from the clock, as a real run's is: it
  // is not part of what an agent is told, and a fixed one keeps two previews
  // of the same project identical.
  const stepped = await chooseStep(config, repoPath, options, entryWorkflow(chosen.taskDef));
  const standIn = initialCaseFile(
    { surfaceId: "preview", taskDef: chosen.taskDef, gateRef, closerRef, domainPrompt, ...(agent === undefined ? {} : { agent }), ...(stepped === undefined ? {} : { workflow: stepped.workflow }) },
    budgets,
  );
  // The record as it stands when the step starts: step 1 has no step entry, a later one opens with its own. The start
  // commit is not part of what an agent is told, so a fixed one keeps two previews identical.
  const atStep = stepped === undefined || stepped.index === 1 ? standIn : { ...standIn, history: [{ t: "step" as const, step: stepped.index, startCommit: "preview" }] };
  const view = stepView(atStep);
  const roleCfg = DEFAULT_ROLES[options.role];
  const { systemPrompt, prompt } = assemblePrompt(view, roleCfg, FIRST_DISPATCH);
  const previewed = stepped?.workflow.steps[stepped.index - 1];

  for (const placeholder of unmatchedTaskPlaceholders(previewed?.prompt ?? "", chosen.taskDef)) ctx.writeWarning?.(unmatchedWarning(placeholder, previewed?.name));

  ctx.writeLine(chosen.heading);
  if (stepped !== undefined && previewed !== undefined) ctx.writeLine(stepHeading(stepped.index, stepped.workflow.steps.length, stepped.workflow.name, previewed.name));
  ctx.writeLine("");
  ctx.writeLine(previewIntro(options.role));
  ctx.writeLine(RULE);
  ctx.writeLine(`${systemPrompt}\n\n${prompt}`);
  ctx.writeLine(RULE);
  const used = packs.flatMap((pack) => pack.applied).filter((a) => stepped !== undefined && a.usedBy.includes(stepped.workflow.name));
  if (used.length > 0) ctx.writeLine(settingsUsedLine(used));
  // `continue` is part of how the step's session is set up, so the preview says so, before the options line.
  for (const line of [...OWN_SETUP, ...(previewed?.continue === true ? [CONTINUES] : []), agentOptionsLine(view.header.agent)]) ctx.writeLine(line);
  return EXIT.ok;
}
