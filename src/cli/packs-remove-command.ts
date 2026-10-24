import { relative } from "node:path";
import { checkInstalledPack } from "../packs/install/installed.js";
import { uninstallPack } from "../packs/install/store.js";
import { addedPackNamed } from "./added-pack-lookup.js";
import type { CommandContext } from "./context.js";
import { findConfig, readConfig, type DeliveryConfig } from "./config.js";
import { EXIT, type ExitCode } from "./failures.js";
import { removedLines, removingLines, stillNamedLines, type WorkflowUse } from "./packs-remove-render.js";

/**
 * Every workflow of the pack `pack` that the configuration names, so that removing the pack would leave one of them standing
 * for nothing. The colon matters: `docs-drift-old:scan` belongs to another pack. Backlog and command sources name no workflow
 * here, and `run --sources` already leaves them alone.
 */
function workflowUses(config: DeliveryConfig, pack: string): WorkflowUse[] {
  const prefix = `${pack}:`;
  const named = (where: string, workflow: unknown): WorkflowUse[] =>
    typeof workflow === "string" && workflow.startsWith(prefix) ? [{ where, workflow }] : [];
  const tasks = (config.tasks ?? []).flatMap((task, i) => (typeof task === "object" ? named(`tasks ${i + 1}`, task.workflow) : []));
  const task = config.task === undefined ? [] : named("task", config.task.workflow);
  const sources = (config.sources ?? []).flatMap((source, i) => (source.type === "github" ? named(`sources ${i + 1}`, source.workflow) : []));
  return [...tasks, ...task, ...sources];
}

/**
 * `delivery packs remove <name>`: take an added pack out. It names the workflows that stop existing, refuses while the
 * configuration still names one of them, then deletes the pack's folder and its record entry. The pack set is never loaded,
 * so a clash in the project cannot block its own remedy. No network and no process.
 */
export async function packsRemoveCommand(name: string, ctx: CommandContext): Promise<ExitCode> {
  const added = await addedPackNamed(name, ctx);
  if (added === undefined) return EXIT.configuration;
  const { repoPath, entry } = added;

  const installed = await checkInstalledPack(repoPath, name, entry);
  const workflows = installed.state === "ok" ? Object.keys(installed.pack.workflows) : null;
  for (const line of removingLines(name, entry, workflows)) ctx.writeLine(line);

  const file = findConfig({ startDir: ctx.cwd, repoPath, flag: undefined, env: ctx.env });
  const uses = file === undefined ? [] : workflowUses(await readConfig(file), name);
  if (file !== undefined && uses.length > 0) {
    for (const line of stillNamedLines(relative(repoPath, file), uses)) ctx.writeLine(line);
    return EXIT.configuration;
  }

  await uninstallPack(repoPath, name);
  for (const line of removedLines(name)) ctx.writeLine(line);
  return EXIT.ok;
}
