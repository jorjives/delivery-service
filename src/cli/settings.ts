import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { CloserRef } from "../schema.js";
import type { FenceSetting } from "../fence.js";
import type { AgentOptions, BudgetSet, CaseFileHeader, GateRef, PinnedWorkflow, TaskDef, WorkflowStep } from "../schema.js";
import { loadCustomCloser } from "../custom-closer.js";
import { loadCustomGate } from "../custom-gate.js";
import { gateDigestOf } from "../gate-digest.js";
import { andList, Concurrency, unknownCloser, type DeliveryConfig, type StepConfig } from "./config.js";
import { isPreset, presetGate, type GatePreset } from "./gate-presets.js";
import { EXIT, Refusal } from "./failures.js";
import { inferGate } from "./project.js";

export const NO_TASK = 'Tell me what to do: add `--task "describe the change you want"`.';

export const BOTH_TASKS = "Use either `--task` or `--task-file`, not both: I can't tell which one you mean.";

export const NO_TASK_FILE = (path: string): string =>
  `I couldn't read the task file \`${path}\`. Check the path, or give the task on the command line with \`--task "..."\`.`;

/** The one closer a run uses when nothing else is configured: it needs only git, and leaves a branch to inspect before trusting it. */
export const DEFAULT_CLOSER: CloserRef = { type: "commit-to-branch" };

/** How many tasks from the list run at once when nothing says otherwise: one, worked down in order, as every project did before. */
export const DEFAULT_CONCURRENCY = 1;

export const NOT_A_CONCURRENCY = (source: string, value: string): string =>
  `I can't use ${source} \`${value}\`: it says how many tasks from your list may run at once, so it is a whole number, 1 or more, such as 3.`;

export const SOURCES_AND_TASK =
  "Use either `--sources` or a task (`--task`, `--task-file`, `--workflow`), not both: I can't tell which you mean.";

export const MAX_NEEDS_SOURCES = "`--max` says how many items `--sources` takes. Add `--sources`, or leave out `--max`.";

export const NOT_A_MAX = (value: string): string => `\`--max\` is "${value}", but it takes a whole number, 1 or more, such as 3.`;

/** What `delivery run` was given on the command line. */
export interface RunFlags {
  task?: string;
  taskFile?: string;
  gateCommand?: string;
  closer?: string;
  concurrency?: string;
  config?: string;
  repo?: string;
  fresh?: boolean;
  workflow?: string;
  /** Work through the work sources in the config file, instead of one task or the list. */
  sources?: boolean;
  /** With `sources`, how many items to take in this run. */
  max?: string;
}

/** How many items `--sources` takes: a whole number, 1 or more; one when not given. */
export function maxItems(flags: RunFlags): number {
  if (flags.max === undefined) return 1;
  const max = Number(flags.max);
  if (!Number.isInteger(max) || max < 1) throw new Refusal(NOT_A_MAX(flags.max), EXIT.configuration, "max");
  return max;
}

/** What a project asks of every run of it: how work is checked, what happens to it, how many attempts a setback gets, and what the project is. */
export interface ProjectSettings {
  gateRef: GateRef;
  closerRef: CloserRef;
  budgets: BudgetSet;
  /** How many tasks from the list may run at once. Never pinned into a run: it shapes the list, not any one task. */
  concurrency: number;
  /** What this project is, from the config file, pinned into the run when it starts. Absent when the project didn't say. */
  domainPrompt?: string;
  /** The config file's agent options, pinned into the run when it starts. Absent when it sets none. */
  agent?: AgentOptions;
  /** The ready-made check the file named, when that is where `gateRef` came from: kept only to describe it by name. A run pins `gateRef` alone. */
  gatePreset?: GatePreset;
  /** The config file's fence setting; absent means the default, preferred. */
  fence?: FenceSetting;
}

/** Everything a run needs to be created: what this one is being asked to do, and everything the project asks of all of them. */
export interface Settings extends ProjectSettings {
  taskDef: TaskDef;
  /** The workflow this run does the task in, pinned as it will run. Absent for a run in one step. */
  workflow?: PinnedWorkflow;
}

/**
 * The task this invocation named, from the flag, the file it points at or the
 * environment. Undefined when nobody named one: a task sitting in the project's
 * config file is not something the person typed just now, which is what decides
 * whether a run is being resumed or started.
 */
export async function explicitIntent(flags: RunFlags, env: NodeJS.ProcessEnv, cwd: string): Promise<string | undefined> {
  if (flags.task !== undefined && flags.taskFile !== undefined) throw new Refusal(BOTH_TASKS, EXIT.configuration);

  let fromFile: string | undefined;
  if (flags.taskFile !== undefined) {
    try {
      fromFile = (await readFile(resolve(cwd, flags.taskFile), "utf-8")).trim();
    } catch {
      throw new Refusal(NO_TASK_FILE(flags.taskFile), EXIT.configuration);
    }
  }

  return (flags.task ?? fromFile ?? env.DELIVERY_TASK)?.trim() || undefined;
}

export const unknownWorkflow = (name: string, known: string[]): string =>
  known.length === 0
    ? `There's no workflow called \`${name}\`: your config file defines none. Add one under \`workflows\`, or leave out \`--workflow\`.`
    : `There's no workflow called \`${name}\`. Your config file defines ${andList(known)}.`;

export const WORKFLOW_NEEDS_TASK = "A workflow runs a task you name with `--task`. Add one, or leave out `--workflow` to work down your list.";

/** One step as a run pins it: a ready-made gate resolved to the gate it stands for, a custom one digested. */
async function pinnedStep(step: StepConfig, repoPath: string): Promise<WorkflowStep> {
  const gateRef = step.gate === undefined ? undefined : isPreset(step.gate) ? await presetGate(step.gate, repoPath) : step.gate;
  const gateDigest = gateRef === undefined ? undefined : await gateDigestOf(gateRef, repoPath);
  return {
    name: step.name,
    prompt: step.prompt,
    ...(gateRef === undefined ? {} : { gateRef }),
    ...(gateDigest === undefined ? {} : { gateDigest }),
    ...(step.agent === undefined ? {} : { agent: step.agent }),
    ...(step.continue === true ? { continue: true as const } : {}),
    ...(step.guards === undefined ? {} : { guards: step.guards }),
  };
}

/** The workflow a run will pin, from its name. Resolved before anything is provisioned, so a mistake stops the command. */
export async function workflowFrom(name: string | undefined, config: DeliveryConfig, repoPath: string): Promise<PinnedWorkflow | undefined> {
  if (name === undefined) return undefined;
  const workflow = config.workflows?.[name];
  if (workflow === undefined) throw new Refusal(unknownWorkflow(name, Object.keys(config.workflows ?? {})), EXIT.configuration, "workflow");
  return { name, steps: await Promise.all(workflow.steps.map((step) => pinnedStep(step, repoPath))) };
}

function taskFrom(intent: string | undefined, config: DeliveryConfig): TaskDef {
  if (intent) return { intent };
  if (config.task) return config.task;
  throw new Refusal(NO_TASK, EXIT.configuration);
}

/**
 * An environment variable set to nothing is not set. CI writes
 * `DELIVERY_CLOSER=` for an input nobody filled in, and taking that literally
 * would refuse the run over a closer type of `""` or check the work with an
 * empty command, in both cases ignoring the file the project checked in.
 */
const fromEnv = (value: string | undefined): string | undefined => value || undefined;

async function gateFrom(
  flags: RunFlags,
  env: NodeJS.ProcessEnv,
  config: DeliveryConfig,
  repoPath: string,
): Promise<Pick<ProjectSettings, "gateRef" | "gatePreset">> {
  const command = flags.gateCommand ?? fromEnv(env.DELIVERY_GATE_COMMAND);
  // `exitcode` is the only parse mode that assumes nothing about the command's output,
  // so it is the one a flag can safely stand for; the rest are named in the file.
  if (command !== undefined) return { gateRef: { type: "command", command, parseMode: "exitcode" } };
  const gate = config.gate;
  if (gate === undefined) return { gateRef: await inferGate(repoPath) };
  // A name is resolved here, before anything is pinned, so a run's record holds
  // the gate itself and never a name that could later mean something else.
  if (isPreset(gate)) return { gateRef: await presetGate(gate, repoPath), gatePreset: gate };
  return { gateRef: gate };
}

function closerFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig): CloserRef {
  const named = flags.closer ?? fromEnv(env.DELIVERY_CLOSER);
  if (named === undefined) return config.closer ?? DEFAULT_CLOSER;
  // A type with no required fields parses on its own; `custom` does not, because it
  // needs a module path, which is what the config file is for.
  const parsed = CloserRef.safeParse({ type: named });
  if (!parsed.success) throw new Refusal(unknownCloser(named), EXIT.configuration, "closer");
  return parsed.data;
}

/**
 * The settings this invocation asked for that a run already under way cannot
 * take: its check and closing action were pinned when it started, so changing
 * them mid-flight would make its own record a lie. Naming the flag or the
 * variable the value came from is what tells the user which one to drop.
 */
export function ignoredSettings(flags: RunFlags, env: NodeJS.ProcessEnv, header: CaseFileHeader): string[] {
  const ignored: string[] = [];
  const command = flags.gateCommand ?? fromEnv(env.DELIVERY_GATE_COMMAND);
  if (command !== undefined && !(header.gateRef.type === "command" && header.gateRef.command === command)) {
    ignored.push(flags.gateCommand !== undefined ? "--gate-command" : "DELIVERY_GATE_COMMAND");
  }
  const closer = flags.closer ?? fromEnv(env.DELIVERY_CLOSER);
  if (closer !== undefined && closer !== (header.closerRef ?? DEFAULT_CLOSER).type) {
    ignored.push(flags.closer !== undefined ? "--closer" : "DELIVERY_CLOSER");
  }
  // The workflow was pinned when the run started; naming another now cannot reshape it.
  if (flags.workflow !== undefined && flags.workflow !== header.workflow?.name) ignored.push("--workflow");
  // A config file only ever reaches a run that is starting, so naming it is the
  // only way someone who pointed at one learns that it changed nothing.
  if (flags.config !== undefined) ignored.push("--config");
  return ignored;
}

/** One note for everything this invocation asked for that the run it picked up will not do. */
export function ignoredNote(names: string[]): string {
  return `Note: a run keeps the settings it started with, so ${names.join(" and ")} ${names.length === 1 ? "was" : "were"} ignored.`;
}

/** The default caps with whichever ones the project set laid over them. Nothing is used yet: usage is counted from the run's log. */
function budgetsFrom(config: DeliveryConfig): BudgetSet {
  const set = { ...DEFAULT_BUDGETS };
  for (const [population, max] of Object.entries(config.budgets ?? {})) {
    if (max !== undefined) set[population as keyof BudgetSet] = { used: 0, max };
  }
  return set;
}

/**
 * The number of tasks at once that a piece of text names, or nothing when it
 * names none. The text must be digits not starting with 0; the number is then
 * held to the config file's own rule, so text and file can never disagree
 * about what counts (a run of digits too long to be an exact whole number is
 * refused by both).
 */
export function concurrencyNamed(typed: string): number | undefined {
  const text = typed.trim();
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const count = Number(text);
  return Concurrency.safeParse(count).success ? count : undefined;
}

function concurrencyFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig): number {
  const named = flags.concurrency ?? fromEnv(env.DELIVERY_CONCURRENCY);
  if (named === undefined) return config.concurrency ?? DEFAULT_CONCURRENCY;
  const count = concurrencyNamed(named);
  if (count === undefined) {
    const source = flags.concurrency !== undefined ? "--concurrency" : "DELIVERY_CONCURRENCY";
    throw new Refusal(NOT_A_CONCURRENCY(source, named), EXIT.configuration, "concurrency");
  }
  return count;
}

/**
 * What every run of this project uses, from every source that has a say: a flag
 * beats an environment variable, which beats the config file, which beats the
 * built-in default. Everything that can refuse does so here, before any run's
 * record or working copy exists. Separate from the task because a list of tasks
 * resolves this once and then asks it of each entry in turn.
 */
export async function resolveProject(
  flags: RunFlags,
  { env, repoPath, config }: { env: NodeJS.ProcessEnv; repoPath: string; config: DeliveryConfig },
): Promise<ProjectSettings> {
  return {
    ...(await gateFrom(flags, env, config, repoPath)),
    closerRef: closerFrom(flags, env, config),
    budgets: budgetsFrom(config),
    concurrency: concurrencyFrom(flags, env, config),
    // Only the file can say what the project is: it is prose about the
    // repository, not something a person retypes per run, so there is no flag
    // and no environment variable to lay over it.
    domainPrompt: config.domain,
    // Likewise for the agent options: they are part of the project, reviewed with it.
    ...(config.agent === undefined ? {} : { agent: config.agent }),
    ...(config.fence === undefined ? {} : { fence: config.fence }),
  };
}

/** What one run will use: what it is being asked to do, and everything its project asks of every run. */
export async function resolveSettings(
  flags: RunFlags,
  {
    env,
    intent,
    repoPath,
    config,
  }: { env: NodeJS.ProcessEnv; intent: string | undefined; repoPath: string; config: DeliveryConfig },
): Promise<Settings> {
  const workflow = await workflowFrom(flags.workflow, config, repoPath);
  return { taskDef: taskFrom(intent, config), ...(await resolveProject(flags, { env, repoPath, config })), ...(workflow === undefined ? {} : { workflow }) };
}

/**
 * Load a custom gate or closer now, rather than when the run first needs it.
 * Resolution is deliberately total in the library, so a module that cannot be
 * loaded becomes an ERROR report and the run spends a budget finding out. On the
 * command line that is the wrong shape: a wrong path is a mistake in the
 * project's configuration, so it stops the command before anything is
 * provisioned, with the path and the guide named. Loading twice costs nothing:
 * Node caches the module.
 */
export async function checkCustomModules(gateRef: GateRef, closerRef: CloserRef, repoPath: string, workflow?: PinnedWorkflow): Promise<void> {
  if (gateRef.type === "custom") await loadCustomGate(repoPath, gateRef.modulePath, gateRef.exportName);
  if (closerRef.type === "custom") await loadCustomCloser(repoPath, closerRef.modulePath, closerRef.exportName);
  for (const step of workflow?.steps ?? []) {
    if (step.gateRef?.type === "custom") await loadCustomGate(repoPath, step.gateRef.modulePath, step.gateRef.exportName);
  }
}
