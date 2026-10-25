import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { ProjectBaseline } from "../packs/inspection.js";
import { installedPackDir } from "../packs/install/store.js";
import { isBuiltInPack, type Pack } from "../packs/manifest.js";
import { resolveSettings, type SettingProblem } from "../packs/settings.js";
import type { DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { DEFAULT_CONFIG_NAME, settingsRefusal } from "./pack-settings-render.js";
import { readProject } from "./project-baseline.js";

export interface InspectedProject {
  project: ProjectBaseline;
  /** The owner's values for the pack, or null when the project does not use it or its settings were not read as data. */
  values: Readonly<Record<string, unknown>> | null;
  /** The name of the config file the owner's values come from, for the owner's words. */
  configName: string;
}

/** A real path, or null when nothing is there: a listed folder that does not exist is not the pack. */
function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Whether the project uses the pack: it is built in, it is listed (in any spelling, or through a symlink), or it was added. Real paths decide. */
function usesPack(pack: Pack, config: DeliveryConfig, root: string, configDir: string): boolean {
  if (isBuiltInPack(pack.dir)) return true;
  const own = realpathSync(pack.dir);
  const listed = (config.packs ?? []).map((entry) => realOrNull(resolve(configDir, entry)));
  return [...listed, realOrNull(installedPackDir(root, pack.manifest.name))].includes(own);
}

/** The problems that refuse a pack's own values: an invalid value or an undeclared setting. Unset settings and other packs' faults do not. */
const isFault = (problem: SettingProblem): problem is Extract<SettingProblem, { kind: "invalid" | "undeclared" }> =>
  problem.kind === "invalid" || problem.kind === "undeclared";

/**
 * The project a pack is inspected in and the owner's values for that pack, read from data only: no project code runs. A faulty
 * value for this pack is refused, naming the first; other packs' faults are not this pack's and never refuse.
 */
export async function inspectedProject(cwd: string, env: NodeJS.ProcessEnv, pack: Pack): Promise<InspectedProject> {
  const { baseline: project, config, configFile } = await readProject(cwd, env, pack.dir);
  const configName = configFile === undefined ? DEFAULT_CONFIG_NAME : basename(configFile);
  if (config === null || project.path === null || !usesPack(pack, config, project.path, configFile === undefined ? project.path : dirname(configFile))) {
    return { project, values: null, configName };
  }
  const values = config.packSettings?.[pack.manifest.name] ?? {};
  const faults = resolveSettings(pack, values).problems.filter(isFault);
  const first = faults[0];
  if (first !== undefined) throw new Refusal(settingsRefusal(faults, configName), EXIT.configuration, `packSettings.${pack.manifest.name}.${first.setting}`);
  return { project, values, configName };
}
