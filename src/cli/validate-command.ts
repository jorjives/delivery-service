import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { CloserRef, GateRef, RoleOverrides } from "../schema.js";
import { CloserModuleLoadFailure, GateModuleLoadFailure, InvalidCloserExport, InvalidGateExport } from "../errors.js";
import { checkConfig, CONFIG_BASENAME, findConfig, readConfig, type ConfigProblem, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, renderFailure, type ExitCode } from "./failures.js";
import { presetPhrase } from "./gate-presets.js";
import { findRepository } from "./project.js";
import { checkCustomModules, resolveProject, type ProjectSettings } from "./settings.js";

/** What `delivery validate` was given on the command line: the two options it shares with `delivery run`. */
export interface ValidateOptions {
  config?: string;
  repo?: string;
}

export const NO_CONFIG = `No ${CONFIG_BASENAME}.json found. Run \`delivery init\` to create one, or see the getting-started guide (docs/getting-started.md).`;

export const READY = "Ready to run.";

/** What the check does, as a person reads it. Total over the gate types, so a new one does not compile until it can be described. */
function gatePhrase(gateRef: GateRef): string {
  switch (gateRef.type) {
    case "command":
      return `runs \`${gateRef.command}\``;
    case "custom":
      return `your own check, in \`${gateRef.modulePath}\``;
  }
}

/** The check a run would use, by name when the file chose a ready-made one and nothing on the command line replaced it. */
function gateLine({ gateRef, gatePreset }: ProjectSettings): string {
  return gatePreset !== undefined && gateRef.type === "command" ? presetPhrase(gatePreset, gateRef.command) : gatePhrase(gateRef);
}

/** What happens to work that passes, as a person reads it. Total over the closer types, as `outcome.ts`'s `landing` is. */
function closerPhrase(closerRef: CloserRef): string {
  switch (closerRef.type) {
    case "commit-to-branch":
      return "commits to a new branch";
    case "merge-back":
      return "merges into your base branch";
    case "open-pr":
      return "opens a pull request";
    case "custom":
      return `your own closing action, in \`${closerRef.modulePath}\``;
  }
}

/**
 * How many things the file asks for. No task at all is not a problem: `delivery
 * run --task "..."` names one each time, which is how the harness is used before
 * a project has a list.
 */
function tasksPhrase(config: DeliveryConfig, concurrency: number): string {
  if (config.tasks) {
    const queued = config.tasks.length;
    if (concurrency > 1) return `concurrency: up to ${concurrency} tasks at once (${queued} queued)`;
    return `${queued} ${queued === 1 ? "task" : "tasks"} queued`;
  }
  if (config.task) return "1 task, set in `task`";
  return 'no tasks listed: name one when you run, with `delivery run --task "..."`';
}

/** Each changeable role as `validate` names it, in the order it names them. */
const ROLE_LINES: Record<keyof RoleOverrides, string> = { worker: "worker", gateMaintenance: "gate maintenance" };

/** One line per role the file changes, saying which of its settings are the project's own; none for a role left as built. */
function roleLines(config: DeliveryConfig): string[] {
  return (Object.keys(ROLE_LINES) as (keyof RoleOverrides)[]).flatMap((role) => {
    const override = config.roles?.[role];
    const own: string[] = [];
    if (override?.systemPromptFragment !== undefined) own.push("instructions");
    if (override?.allowedTools !== undefined) own.push("tool list");
    return own.length === 0 ? [] : [`${ROLE_LINES[role]}: your own ${own.join(" and ")}`];
  });
}

/**
 * One line per thing `validate` checked, in the owner's terms: the description,
 * the tasks, what the check runs, what the closing action does, and which roles
 * the file changes. The check and closing action are the ones a run would use,
 * inferred and defaulted values included, so what is reported is what would
 * happen. When more than one task may run at once, the line says so, with how many are queued.
 */
export function checkedLines(config: DeliveryConfig, project: ProjectSettings): string[] {
  return [
    `domain description: ${project.domainPrompt === undefined ? "none (it's optional)" : "present"}`,
    tasksPhrase(config, project.concurrency),
    `gate: ${gateLine(project)}`,
    `closer: ${closerPhrase(project.closerRef)}`,
    ...roleLines(config),
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
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env, orPlan: true });
  if (file === undefined) throw new Refusal(NO_CONFIG, EXIT.configuration);
  return { repoPath, file };
}

export async function readProject(
  file: string,
  repoPath: string,
  env: NodeJS.ProcessEnv,
): Promise<{ config: DeliveryConfig; project: ProjectSettings }> {
  const config = await readConfig(file);
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
