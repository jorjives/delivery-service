import { resolve } from "node:path";
import { type InstalledPack, readInstalledPacks, refuseUnusable } from "../packs/install/installed.js";
import { builtInPacks, loadPack, type Pack } from "../packs/manifest.js";
import { bindSettings, type SettingProblem } from "../packs/settings.js";
import type { DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { clashField, clashSentence, findClash } from "./pack-clash.js";
import { DEFAULT_CONFIG_NAME, settingsRefusal } from "./pack-settings-render.js";

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
  const inUse = packs.map((pack) => pack.manifest.name);
  const known = new Set([...inUse, ...installed.map((pack) => pack.name)]);
  for (const name of Object.keys(config.packSettings ?? {})) {
    if (!known.has(name)) settingProblems.push({ kind: "unknown-pack", pack: name, inUse });
  }
  return { packs, installed, settingProblems };
}

/** The field a setting problem is about: its setting, or the pack's entry when the pack is not in use. */
function settingField(problem: SettingProblem): string {
  return problem.kind === "unknown-pack" ? `packSettings.${problem.pack}` : `packSettings.${problem.pack}.${problem.setting}`;
}

/**
 * Every pack the config can use, as `projectPackStates` gives them, refusing when any added pack at `repoPath` is not as the
 * record approved it, or when a setting is wrong: every such problem is named at once, before anything is sent to an agent.
 * The refusal's field is the first problem the refusal prints, so a fault comes before an unset setting.
 */
export async function projectPacks(
  config: DeliveryConfig,
  configDir: string,
  repoPath: string | undefined,
  configName: string = DEFAULT_CONFIG_NAME,
): Promise<Pack[]> {
  const { packs, installed, settingProblems } = await projectPackStates(config, configDir, repoPath);
  if (repoPath !== undefined) refuseUnusable(repoPath, installed);
  const printed = [...settingProblems.filter((problem) => problem.kind !== "missing"), ...settingProblems.filter((problem) => problem.kind === "missing")];
  const [first] = printed;
  if (first !== undefined) throw new Refusal(settingsRefusal(settingProblems, configName), EXIT.configuration, settingField(first));
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
