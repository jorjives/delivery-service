import { initialCaseFile } from "../case-file.js";
import { assemblePrompt, type PromptEvidence } from "../prompt-assembly.js";
import type { TaskDef } from "../schema.js";
import type { DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { RUN_ROLES } from "./drive.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { EVERY_TASK_DONE, nextQueueTask, queueTasks, taskHeading } from "./queue.js";
import { allRuns } from "./runs.js";
import { NO_TASK, taskIntent } from "./settings.js";
import { locateConfig, readProject, type ValidateOptions } from "./validate-command.js";

/** The roles an owner can see the instructions of. Triage is the harness's own and is not configurable from the file. */
export type PreviewRole = "worker" | "gate-maintenance";
export const PREVIEW_ROLES: readonly PreviewRole[] = ["worker", "gate-maintenance"];

/** What `delivery preview` was given on the command line. */
export interface PreviewOptions extends ValidateOptions {
  /** Which task on the list, counted from 1 as "Task N of M" counts. */
  queueIndex?: number;
  role: PreviewRole;
}

/** The line above and below the instructions, so where they start and stop is never in doubt. */
export const RULE = "─".repeat(53);

/** Who the instructions are for, as a person reads it. */
const WHO: Record<PreviewRole, string> = {
  worker: "the worker",
  "gate-maintenance": "the agent that repairs your check",
};

/** What each tool lets an agent do, in everyday words. */
const TOOL_PHRASES: Record<string, string> = {
  Read: "read files",
  Glob: "look through the project",
  Grep: "look through the project",
  Edit: "edit files",
  Write: "edit files",
  Bash: "run commands",
};

/** What the agent may do, once per phrase, in the role's own order. A tool with no everyday phrase is named as written, never hidden. */
export function toolsLine(tools: readonly string[]): string {
  const phrases = [...new Set(tools.map((tool) => TOOL_PHRASES[tool] ?? tool))];
  return `Tools it can use: ${phrases.join(", ")}.`;
}

/**
 * What a run's first dispatch has to go on besides its record: nothing yet.
 * No brief, because nothing has been tried; no failing checks; no setback.
 */
const FIRST_DISPATCH: PromptEvidence = { brief: null, newFailures: [], setback: null };

/** The task to preview, and the line that names it. Undefined when every task on the list is done. */
async function chooseTask(config: DeliveryConfig, repoPath: string): Promise<{ heading: string; taskDef: TaskDef } | undefined> {
  if (config.tasks) {
    const tasks = queueTasks(config);
    const next = nextQueueTask(await allRuns(repoPath), tasks);
    if (next === undefined) return undefined;
    const taskDef = tasks[next.task - 1] as TaskDef;
    return { heading: `Next up is ${taskHeading(next, taskIntent(taskDef))}`, taskDef };
  }
  if (config.task) return { heading: `Your task: ${taskIntent(config.task)}`, taskDef: config.task };
  throw new Refusal(NO_TASK, EXIT.configuration);
}

/**
 * `delivery preview`: print, before anything runs, exactly what an agent
 * would be told about this project and one of its tasks.
 *
 * Nothing here renders a prompt. The record a run of the task would start
 * with comes from `initialCaseFile`, the role from `RUN_ROLES`, and the text
 * from the library's own `assemblePrompt`: the same function, on the same
 * inputs, a run's first dispatch uses. Everything else is a read, so it needs
 * no agent, no sign-in and no network, and is safe beside a run in progress.
 */
export async function previewCommand(options: PreviewOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, file } = await locateConfig(options, ctx);
  const { config, project } = await readProject(file, repoPath, ctx.env);
  const chosen = await chooseTask(config, repoPath);
  if (chosen === undefined) {
    ctx.writeLine(EVERY_TASK_DONE);
    return EXIT.ok;
  }

  const roleCfg = RUN_ROLES[options.role];
  const { gateRef, closerRef, domainPrompt, budgets } = project;
  // The id is fixed rather than made from the clock, as a real run's is: it
  // is not part of what an agent is told, and a fixed one keeps two previews
  // of the same project identical.
  const standIn = initialCaseFile({ surfaceId: "preview", taskDef: chosen.taskDef, gateRef, closerRef, domainPrompt }, budgets);
  const { systemPrompt, prompt } = assemblePrompt(standIn, roleCfg, FIRST_DISPATCH);

  ctx.writeLine(chosen.heading);
  ctx.writeLine("");
  ctx.writeLine(`What ${WHO[options.role]} will be told (before any run starts):`);
  ctx.writeLine(RULE);
  ctx.writeLine(`${systemPrompt}\n\n${prompt}`);
  ctx.writeLine(RULE);
  ctx.writeLine(toolsLine(roleCfg.allowedTools));
  return EXIT.ok;
}
