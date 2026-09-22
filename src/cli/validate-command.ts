import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { CloserRef, GateRef } from "../schema.js";
import { CONFIG_BASENAME, findConfig, readConfig, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
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

/**
 * One line per thing `validate` checked, in the owner's terms: the description,
 * the tasks, what the check runs and what the closing action does. The check
 * and closing action are the ones a run would use, inferred and defaulted
 * values included, so what is reported is what would happen.
 */
export function checkedLines(config: DeliveryConfig, project: ProjectSettings): string[] {
  return [
    `domain description: ${project.domainPrompt === undefined ? "none (it's optional)" : "present"}`,
    tasksPhrase(config),
    `gate: ${gatePhrase(project.gateRef)}`,
    `closer: ${closerPhrase(project.closerRef)}`,
  ].map((line) => `✓ ${line}`);
}

/**
 * `delivery validate`: check the project's configuration the way `delivery
 * run` would before it set anything up, and stop there. Everything it does is a
 * read: find the file, parse it, work out the check and closing action a run
 * would use, and load (never run) any module of the project's own. So it needs
 * no agent, no sign-in and no network, and is safe beside a run in progress.
 * The first problem is thrown and rendered as every command's are: one plain
 * sentence, the configuration exit code.
 */
export async function validateCommand(options: ValidateOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const file = findConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  // `run` treats no file as "use the defaults"; asked to check a setup, there is
  // no setup to check, and saying "ready" would be a guess.
  if (file === undefined) throw new Refusal(NO_CONFIG, EXIT.configuration);
  // Both sides real: discovery answers with real paths and a named file may not be one.
  ctx.writeLine(`Checking ${relative(realpathSync(ctx.cwd), realpathSync(file))}…`);
  const config = await readConfig(file);
  // No flags: validate checks what the project says, with the environment a run here would also see.
  const project = await resolveProject({}, { env: ctx.env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  for (const line of checkedLines(config, project)) ctx.writeLine(line);
  ctx.writeLine(READY);
  return EXIT.ok;
}
