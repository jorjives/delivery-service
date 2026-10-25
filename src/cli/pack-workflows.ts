import { resolve } from "node:path";
import { type InstalledPack, readInstalledPacks, refuseUnusable } from "../packs/install/installed.js";
import { builtInPacks, loadPack, type Pack } from "../packs/manifest.js";
import { bindSettings, type SettingProblem } from "../packs/settings.js";
import type { DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { clashField, clashSentence, findClash } from "./pack-clash.js";

/**
 * Every pack the config can use, in order: the built-in ones, then each pack folder it lists, relative to `configDir`, then
 * the added packs at `repoPath` that are `ok`, with every added pack's state beside them. Each pack is bound to the values
 * `packSettings` gives it; a pack that cannot be bound is kept as read, and its problems are listed. Reads local files
 * only, and refuses nothing.
 */
export async function projectPackStates(
  config: DeliveryConfig,
  configDir: string,
  repoPath: string | undefined,
): Promise<{ packs: Pack[]; installed: InstalledPack[]; settingProblems: SettingProblem[] }> {
  const builtIn = await builtInPacks();
  const listed = await Promise.all((config.packs ?? []).map((dir) => loadPack(resolve(configDir, dir))));
  const installed = repoPath === undefined ? [] : await readInstalledPacks(repoPath);
  const added = installed.flatMap((pack) => (pack.state === "ok" ? [pack.pack] : []));
  const settingProblems: SettingProblem[] = [];
  const packs = [...builtIn, ...listed, ...added].map((pack) => {
    const bound = bindSettings(pack, config.packSettings?.[pack.manifest.name]);
    if (bound.ok) return bound.pack;
    settingProblems.push(...bound.problems);
    return pack;
  });
  return { packs, installed, settingProblems };
}

/** One problem as a line. Temporary: Task 4 replaces these words with the owner's renderer, and Task 5 deletes this function. */
function problemLine(problem: SettingProblem): string {
  switch (problem.kind) {
    case "missing":
      return `  ${problem.pack}.${problem.setting}: has no value, and the pack gives no default`;
    case "undeclared":
      return `  ${problem.pack}.${problem.setting}: is not a setting of this pack. Its settings are: ${problem.declared.join(", ")}.`;
    case "invalid":
      return `  ${problem.pack}.${problem.setting}: ${problem.rule}`;
    case "unknown-pack":
      return `  ${problem.pack}: no pack called ${problem.pack} is used by this project. Packs in use: ${problem.inUse.join(", ")}.`;
  }
}

/** The refusal for settings that cannot be bound: every problem at once, never the value itself. */
export function settingsRefusal(problems: readonly SettingProblem[]): string {
  return ["packSettings has a problem:", ...problems.map(problemLine), "Nothing was run."].join("\n");
}

/**
 * Every pack the config can use, as `projectPackStates` gives them, refusing when any added pack at `repoPath` is not as the
 * record approved it: every such pack is named at once, before anything is sent to an agent.
 */
export async function projectPacks(config: DeliveryConfig, configDir: string, repoPath: string | undefined): Promise<Pack[]> {
  const { packs, installed, settingProblems } = await projectPackStates(config, configDir, repoPath);
  if (repoPath !== undefined) refuseUnusable(repoPath, installed);
  if (settingProblems.length > 0) throw new Refusal(settingsRefusal(settingProblems), EXIT.configuration, "packSettings");
  return packs;
}

/** The config with the workflows of every pack in `packs` beside its own: one place every lookup reads. */
export function withWorkflowsOf(config: DeliveryConfig, packs: readonly Pack[]): DeliveryConfig {
  const clash = findClash(config, packs);
  if (clash !== undefined) throw new Refusal(clashSentence(clash), EXIT.configuration, clashField(clash));
  const workflows = { ...(config.workflows ?? {}) };
  for (const pack of packs) Object.assign(workflows, pack.workflows);
  return { ...config, workflows };
}

/** The config with every built-in pack's workflows, every pack it lists, and every pack added to the repository, beside its own: one place every lookup reads. */
export async function withPackWorkflows(config: DeliveryConfig, configDir: string, repoPath: string | undefined): Promise<DeliveryConfig> {
  return withWorkflowsOf(config, await projectPacks(config, configDir, repoPath));
}
