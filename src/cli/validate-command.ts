import { realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { DEFAULT_LABEL } from "../github-source.js";
import { CloserModuleLoadFailure, GateModuleLoadFailure, InvalidCloserExport, InvalidGateExport } from "../errors.js";
import { checkConfig, CONFIG_BASENAME, findConfig, readConfig, type ConfigProblem, type DeliveryConfig, type SourceConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, renderFailure, type ExitCode } from "./failures.js";
import { withPackWorkflows } from "./pack-workflows.js";
import { gateLine, closerPhrase } from "./project-phrases.js";
import { findRepository } from "./project.js";
import { checkCustomModules, resolveProject, type ProjectSettings } from "./settings.js";

/** What `delivery validate` was given on the command line: the two options it shares with `delivery run`. */
export interface ValidateOptions {
  config?: string;
  repo?: string;
}

export const NO_CONFIG = `No ${CONFIG_BASENAME}.json found. Run \`delivery init\` to create one, or see the getting-started guide (docs/getting-started.md).`;

export const READY = "Ready to run.";

/** Where one source finds work, as a person reads it; a fallback says it is read only when nothing else has any. */
function sourcePhrase(source: SourceConfig): string {
  const where = {
    backlog: "the backlog",
    list: "the list",
    command: source.type === "command" ? `\`${source.command}\`` : "",
    github: source.type === "github" ? `github issues labelled \`${source.label ?? DEFAULT_LABEL}\`` : "",
  }[source.type];
  return source.fallback === true ? `${where} (only when nothing else has work)` : where;
}

/**
 * How many things the file asks for. No task at all is not a problem: `delivery
 * run --task "..."` names one each time, which is how the harness is used before
 * a project has a list. A project with sources is run with `delivery run --sources`
 * instead, and says where that looks.
 */
function tasksPhrase(config: DeliveryConfig, concurrency: number): string {
  if (config.tasks) {
    const queued = config.tasks.length;
    if (concurrency > 1) return `concurrency: up to ${concurrency} tasks at once (${queued} queued)`;
    return `${queued} ${queued === 1 ? "task" : "tasks"} queued`;
  }
  if (config.task) return "1 task, set in `task`";
  if (config.sources) return `work sources: ${config.sources.map(sourcePhrase).join(", then ")}, then nothing else; run with \`delivery run --sources\``;
  return 'no tasks listed: name one when you run, with `delivery run --task "..."`';
}

/** The workflows a project with sources can deliver by, each with its step count: the ones a source may name wrongly. Other projects run no workflow of their choosing, so list none. */
function workflowsLines(config: DeliveryConfig): string[] {
  const named = Object.entries(config.workflows ?? {});
  if (config.sources === undefined || named.length === 0) return [];
  const phrases = named.map(([name, { steps }]) => `${name} (${steps.length} ${steps.length === 1 ? "step" : "steps"})`);
  return [`workflows: ${phrases.join(", ")}`];
}

/**
 * One line per thing `validate` checked, in the owner's terms: the description,
 * the tasks or sources, the workflows, what the check runs, what the closing action does, and the agent
 * options the file sets. The check and closing action are the ones a run would
 * use, inferred and defaulted values included, so what is reported is what would
 * happen. When more than one task may run at once, the line says so, with how many are queued.
 */
export function checkedLines(config: DeliveryConfig, project: ProjectSettings): string[] {
  return [
    `domain description: ${project.domainPrompt === undefined ? "none (it's optional)" : "present"}`,
    tasksPhrase(config, project.concurrency),
    ...workflowsLines(config),
    `gate: ${gateLine(project)}`,
    `closer: ${closerPhrase(project.closerRef)}`,
    ...(config.agent === undefined ? [] : [`agent options: ${Object.keys(config.agent).join(", ")}`]),
  ].map((line) => `✓ ${line}`);
}

/**
 * Where this invocation's config file is, and the repository it belongs to.
 * No file is refused: a command asked about a project's setup has no setup to
 * read, and answering from the defaults would be a guess. (`run` treats no
 * file as "use the defaults"; it is not asked about the setup.)
 */
export async function locateConfig(options: ValidateOptions, ctx: CommandContext): Promise<{ repoPath: string; file: string }> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  if (file === undefined) throw new Refusal(NO_CONFIG, EXIT.configuration);
  return { repoPath, file };
}

export async function readProject(
  file: string,
  repoPath: string,
  env: NodeJS.ProcessEnv,
): Promise<{ config: DeliveryConfig; project: ProjectSettings }> {
  const config = await withPackWorkflows(await readConfig(file), dirname(file));
  return { config, project: await settleProject(config, repoPath, env) };
}

/** The project a run would have with no config file: the defaults, and the built-in packs' workflows. */
export async function defaultProject(repoPath: string, env: NodeJS.ProcessEnv): Promise<{ config: DeliveryConfig; project: ProjectSettings }> {
  const config = await withPackWorkflows({}, repoPath);
  return { config, project: await settleProject(config, repoPath, env) };
}

/** The check and closing action a run would use (no flags, this environment), with any module of the project's own loaded but never run. */
async function settleProject(config: DeliveryConfig, repoPath: string, env: NodeJS.ProcessEnv): Promise<ProjectSettings> {
  const project = await resolveProject({}, { env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  return project;
}

/** What `validate --json` prints: whether a run could start, and everything in the way. */
export interface Validation {
  ready: boolean;
  problems: ConfigProblem[];
}

/** The setting a problem found after the file's shape is right concerns: the one a refusal names, or the kind of module that would not load. */
function settingOf(err: unknown): string | null {
  if (err instanceof Refusal) return err.field ?? null;
  if (err instanceof GateModuleLoadFailure || err instanceof InvalidGateExport) return "gate";
  if (err instanceof CloserModuleLoadFailure || err instanceof InvalidCloserExport) return "closer";
  return null;
}

/**
 * Every problem `validate` finds, for a script: every problem with the file's
 * shape together, then what resolving it the way a run would turns up. Whatever
 * the plain form would refuse with the configuration exit code is a problem
 * here, in the same words; anything else is not a problem with the
 * configuration, so it is thrown and rendered as every command's failures are,
 * which keeps the exit codes of the two forms the same.
 */
export async function findProblems(options: ValidateOptions, ctx: CommandContext): Promise<ConfigProblem[]> {
  try {
    const { repoPath, file } = await locateConfig(options, ctx);
    const checked = await checkConfig(file);
    if (!checked.ok) return checked.problems;
    // ponytail: past the shape, only the first failure (the check or closing action a run would use, or a module
    // of the project's own) is listed; check the gate and closer modules separately if CI needs both at once.
    await settleProject(checked.config, repoPath, ctx.env);
    return [];
  } catch (err) {
    const { message, exitCode } = renderFailure(err);
    if (exitCode !== EXIT.configuration) throw err;
    return [{ field: settingOf(err), message }];
  }
}

/**
 * `delivery validate`: check the project's configuration the way `delivery
 * run` would before it set anything up, and stop there. Everything it does is
 * a read, so it needs no agent, no sign-in and no network, and is safe beside
 * a run in progress. With `--json` it prints one document instead, listing every
 * problem it finds rather than the first, with the same exit code.
 */
export async function validateCommand(options: ValidateOptions, ctx: CommandContext): Promise<ExitCode> {
  if (ctx.json) {
    const problems = await findProblems(options, ctx);
    const validation: Validation = { ready: problems.length === 0, problems };
    ctx.writeLine(JSON.stringify(validation, null, 2));
    return validation.ready ? EXIT.ok : EXIT.configuration;
  }

  const { repoPath, file } = await locateConfig(options, ctx);
  // Both sides real: discovery answers with real paths and a named file may not be one.
  ctx.writeLine(`Checking ${relative(realpathSync(ctx.cwd), realpathSync(file))}…`);
  const { config, project } = await readProject(file, repoPath, ctx.env);
  for (const line of checkedLines(config, project)) ctx.writeLine(line);
  ctx.writeLine(READY);
  return EXIT.ok;
}
