import { resolve } from "node:path";
import { builtInPacks, loadPack } from "../packs/manifest.js";
import type { DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";

export const packWorkflowClash = (name: string): string => `Two things define the workflow "${name}": rename your own workflow, or the pack, so each name is used once.`;

/** The config with every built-in pack's workflows, and every pack it lists, beside its own: one place every lookup reads. */
export async function withPackWorkflows(config: DeliveryConfig, configDir: string): Promise<DeliveryConfig> {
  const packs = [...(await builtInPacks()), ...(await Promise.all((config.packs ?? []).map((dir) => loadPack(resolve(configDir, dir)))))];
  const workflows = { ...(config.workflows ?? {}) };
  for (const pack of packs) {
    for (const [name, workflow] of Object.entries(pack.workflows)) {
      if (name in workflows) throw new Refusal(packWorkflowClash(name), EXIT.configuration, "packs");
      workflows[name] = workflow;
    }
  }
  return { ...config, workflows };
}
