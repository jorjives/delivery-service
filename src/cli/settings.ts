import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { CloserRef } from "../schema.js";
import type { BudgetSet, GateRef, TaskDef } from "../schema.js";
import { unknownCloser, type DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { inferGate } from "./project.js";

export const NO_TASK = 'Tell me what to do: add `--task "describe the change you want"`.';

export const BOTH_TASKS = "Use either `--task` or `--task-file`, not both: I can't tell which one you mean.";

export const NO_TASK_FILE = (path: string): string =>
  `I couldn't read the task file \`${path}\`. Check the path, or give the task on the command line with \`--task "..."\`.`;

/** The one closer a run uses when nothing else is configured: it needs only git, and leaves a branch to inspect before trusting it. */
export const DEFAULT_CLOSER: CloserRef = { type: "commit-to-branch" };

/** What `delivery run` was given on the command line. */
export interface RunFlags {
  task?: string;
  taskFile?: string;
  gateCommand?: string;
  closer?: string;
  config?: string;
  repo?: string;
}

/** Everything a run needs to be created, once every source of settings has had its say. */
export interface Settings {
  taskDef: TaskDef;
  gateRef: GateRef;
  closerRef: CloserRef;
  budgets: BudgetSet;
}

/** The task's own words, for the run's id and the line that announces it. A task is opaque to the harness, so one shaped another way still gets a run. */
export function taskIntent(taskDef: TaskDef): string {
  return typeof taskDef.intent === "string" && taskDef.intent.trim() !== "" ? taskDef.intent.trim() : "run";
}

async function taskFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig, cwd: string): Promise<TaskDef> {
  if (flags.task !== undefined && flags.taskFile !== undefined) throw new Refusal(BOTH_TASKS, EXIT.configuration);

  let fromFile: string | undefined;
  if (flags.taskFile !== undefined) {
    try {
      fromFile = (await readFile(resolve(cwd, flags.taskFile), "utf-8")).trim();
    } catch {
      throw new Refusal(NO_TASK_FILE(flags.taskFile), EXIT.configuration);
    }
  }

  const intent = (flags.task ?? fromFile ?? env.DELIVERY_TASK)?.trim();
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

async function gateFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig, repoPath: string): Promise<GateRef> {
  const command = flags.gateCommand ?? fromEnv(env.DELIVERY_GATE_COMMAND);
  // `exitcode` is the only parse mode that assumes nothing about the command's output,
  // so it is the one a flag can safely stand for; the rest are named in the file.
  if (command !== undefined) return { type: "command", command, parseMode: "exitcode" };
  return config.gate ?? (await inferGate(repoPath));
}

function closerFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig): CloserRef {
  const named = flags.closer ?? fromEnv(env.DELIVERY_CLOSER);
  if (named === undefined) return config.closer ?? DEFAULT_CLOSER;
  // A type with no required fields parses on its own; `custom` does not, because it
  // needs a module path, which is what the config file is for.
  const parsed = CloserRef.safeParse({ type: named });
  if (!parsed.success) throw new Refusal(unknownCloser(named), EXIT.configuration);
  return parsed.data;
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
 * What this run will use, from every source that has a say: a flag beats an
 * environment variable, which beats the config file, which beats the built-in
 * default. Everything that can refuse does so here, before the run's record or
 * its working copy exists.
 */
export async function resolveSettings(
  flags: RunFlags,
  { env, cwd, repoPath, config }: { env: NodeJS.ProcessEnv; cwd: string; repoPath: string; config: DeliveryConfig },
): Promise<Settings> {
  return {
    taskDef: await taskFrom(flags, env, config, cwd),
    gateRef: await gateFrom(flags, env, config, repoPath),
    closerRef: closerFrom(flags, env, config),
    budgets: budgetsFrom(config),
  };
}
