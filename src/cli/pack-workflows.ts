import { join, resolve } from "node:path";
import { type InstalledPack, readInstalledPacks, refuseUnusable } from "../packs/install/installed.js";
import { builtInPacks, isBuiltInPack, loadPack, type Pack } from "../packs/manifest.js";
import type { DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";

export const packWorkflowClash = (name: string): string => `Two things define the workflow "${name}": rename your own workflow, or the pack, so each name is used once.`;

export const builtInPackClash = (name: string, manifestFile: string): string =>
  `The pack in ${manifestFile} is named "${name}", the name of a pack that comes with the harness: change its "name" so each pack is named once.`;

export const builtInWorkflowClash = (workflow: string, builtIn: string): string =>
  `The workflow "${workflow}" in your configuration has the name of a workflow in "${builtIn}", a pack that comes with the harness: rename your workflow so each name is used once.`;

/**
 * Every pack the config can use, in order: the built-in ones, then each pack folder it lists, relative to `configDir`, then
 * the added packs at `repoPath` that are `ok`, with every added pack's state beside them. Reads local files only, and refuses nothing.
 */
export async function projectPackStates(config: DeliveryConfig, configDir: string, repoPath: string | undefined): Promise<{ packs: Pack[]; installed: InstalledPack[] }> {
  const builtIn = await builtInPacks();
  const listed = await Promise.all((config.packs ?? []).map((dir) => loadPack(resolve(configDir, dir))));
  const installed = repoPath === undefined ? [] : await readInstalledPacks(repoPath);
  const added = installed.flatMap((pack) => (pack.state === "ok" ? [pack.pack] : []));
  return { packs: [...builtIn, ...listed, ...added], installed };
}

/**
 * Every pack the config can use, as `projectPackStates` gives them, refusing when any added pack at `repoPath` is not as the
 * record approved it: every such pack is named at once, before anything is sent to an agent.
 */
export async function projectPacks(config: DeliveryConfig, configDir: string, repoPath: string | undefined): Promise<Pack[]> {
  const { packs, installed } = await projectPackStates(config, configDir, repoPath);
  if (repoPath !== undefined) refuseUnusable(repoPath, installed);
  return packs;
}

/** The config with the workflows of every pack in `packs` beside its own: one place every lookup reads. */
export function withWorkflowsOf(config: DeliveryConfig, packs: readonly Pack[]): DeliveryConfig {
  const builtInNames = new Set(packs.filter((pack) => isBuiltInPack(pack.dir)).map((pack) => pack.manifest.name));
  for (const pack of packs) {
    if (builtInNames.has(pack.manifest.name) && !isBuiltInPack(pack.dir)) throw new Refusal(builtInPackClash(pack.manifest.name, join(pack.dir, "pack.json")), EXIT.configuration, "packs");
  }
  const workflows = { ...(config.workflows ?? {}) };
  const own = new Set(Object.keys(workflows));
  for (const pack of packs) {
    for (const [name, workflow] of Object.entries(pack.workflows)) {
      if (name in workflows) {
        if (own.has(name) && isBuiltInPack(pack.dir)) throw new Refusal(builtInWorkflowClash(name, pack.manifest.name), EXIT.configuration, "workflows");
        throw new Refusal(packWorkflowClash(name), EXIT.configuration, "packs");
      }
      workflows[name] = workflow;
    }
  }
  return { ...config, workflows };
}

/** The config with every built-in pack's workflows, every pack it lists, and every pack added to the repository, beside its own: one place every lookup reads. */
export async function withPackWorkflows(config: DeliveryConfig, configDir: string, repoPath: string | undefined): Promise<DeliveryConfig> {
  return withWorkflowsOf(config, await projectPacks(config, configDir, repoPath));
}
