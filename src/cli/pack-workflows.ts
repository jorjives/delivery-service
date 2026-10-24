import { join, resolve } from "node:path";
import { installedPacks } from "../packs/install/installed.js";
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
 * the packs added to the repository at `repoPath`, if there is one. Reads local files only.
 */
export async function projectPacks(config: DeliveryConfig, configDir: string, repoPath: string | undefined): Promise<Pack[]> {
  return [
    ...(await builtInPacks()),
    ...(await Promise.all((config.packs ?? []).map((dir) => loadPack(resolve(configDir, dir))))),
    ...(repoPath === undefined ? [] : await installedPacks(repoPath)),
  ];
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
