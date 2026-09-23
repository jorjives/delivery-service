import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { CloserRef, GateRef, RoleOverrides } from "../schema.js";
import { CONFIG_BASENAME, findConfig, readConfig, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
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
function tasksPhrase(config: DeliveryConfig): string {
  if (config.tasks) return `${config.tasks.length} ${config.tasks.length === 1 ? "task" : "tasks"} queued`;
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
 * happen.
 */
export function checkedLines(config: DeliveryConfig, project: ProjectSettings): string[] {
  return [
    `domain description: ${project.domainPrompt === undefined ? "none (it's optional)" : "present"}`,
    tasksPhrase(config),
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
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  if (file === undefined) throw new Refusal(NO_CONFIG, EXIT.configuration);
  return { repoPath, file };
}

/**
 * Everything `delivery run` would read before setting anything up, and
 * nothing more: the file's settings, the check and closing action a run would
 * use (no flags, the environment a run here would also see), and any module
 * of the project's own, loaded but never run. The first problem is thrown and
 * rendered as every command's are: one plain sentence, the configuration exit
 * code. Shared by `validate` and `preview`, so both refuse in the same words.
 */
export async function readProject(
  file: string,
  repoPath: string,
  env: NodeJS.ProcessEnv,
): Promise<{ config: DeliveryConfig; project: ProjectSettings }> {
  const config = await readConfig(file);
  const project = await resolveProject({}, { env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  return { config, project };
}

/**
 * `delivery validate`: check the project's configuration the way `delivery
 * run` would before it set anything up, and stop there. Everything it does is
 * a read, so it needs no agent, no sign-in and no network, and is safe beside
 * a run in progress.
 */
export async function validateCommand(options: ValidateOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, file } = await locateConfig(options, ctx);
  // Both sides real: discovery answers with real paths and a named file may not be one.
  ctx.writeLine(`Checking ${relative(realpathSync(ctx.cwd), realpathSync(file))}…`);
  const { config, project } = await readProject(file, repoPath, ctx.env);
  for (const line of checkedLines(config, project)) ctx.writeLine(line);
  ctx.writeLine(READY);
  return EXIT.ok;
}
