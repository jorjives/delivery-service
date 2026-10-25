import { realpathSync } from "node:fs";
import { sep } from "node:path";
import { NO_PROJECT, type ProjectBaseline, type Selection } from "../packs/inspection.js";
import { repoRootOf } from "../repo-root.js";
import type { CloserRef } from "../schema.js";
import { checkConfig, findConfig, type DeliveryConfig } from "./config.js";
import { Refusal } from "./failures.js";
import { closerPhrase, gateLine } from "./project-phrases.js";
import { DEFAULT_CLOSER, resolveProject } from "./settings.js";

/** Whether `path` is `folder` itself or lies inside it. Both are real paths. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}

const unreadable = (path: string): ProjectBaseline => ({ found: true, path, config: "unreadable", gate: null, closer: null });

const closerSelection = (closerRef: CloserRef): Selection => ({ source: "project", type: closerRef.type, summary: closerPhrase(closerRef) });

/** What a project's settings read as: the baseline, the settings themselves when they were read as data, and the config file found. */
export interface ProjectRead {
  baseline: ProjectBaseline;
  /** The settings read from data; null when there is no project, the settings are code, or the file could not be read. */
  config: DeliveryConfig | null;
  /** The config file's path, when a file was found. */
  configFile: string | undefined;
}

/** The check and landing a project's settings give a resolved config: a failure to resolve degrades the answer rather than refusing it. */
async function baselineOf(root: string, read: "none" | "read", config: DeliveryConfig, env: NodeJS.ProcessEnv): Promise<ProjectBaseline> {
  try {
    const project = await resolveProject({}, { env, repoPath: root, config });
    return {
      found: true,
      path: root,
      config: read,
      gate: { source: "project", type: project.gateRef.type, summary: gateLine(project) },
      closer: closerSelection(project.closerRef),
    };
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    if (err.field !== "gate") return unreadable(root);
    return { found: true, path: root, config: read, gate: null, closer: closerSelection(config.closer ?? DEFAULT_CLOSER) };
  }
}

/**
 * The project a pack is inspected in, read from data only: no project code runs, no git starts, and a failure to read degrades
 * the answer rather than refusing it. Also returns the settings read as data, so a caller can read the owner's values from them.
 */
export async function readProject(cwd: string, env: NodeJS.ProcessEnv, packDir: string): Promise<ProjectRead> {
  const none: ProjectRead = { baseline: NO_PROJECT, config: null, configFile: undefined };
  const root = repoRootOf(realpathSync(cwd));
  const pack = realpathSync(packDir);
  if (root === undefined || within(root, pack)) return none;

  let file: string | undefined;
  try {
    file = findConfig({ startDir: root, repoPath: root, flag: undefined, env });
  } catch (err) {
    if (err instanceof Refusal) return { baseline: unreadable(root), config: null, configFile: undefined };
    throw err;
  }
  if (file !== undefined && within(realpathSync(file), pack)) return none;
  if (file !== undefined && !file.endsWith(".json")) {
    return { baseline: { found: true, path: root, config: "code", gate: null, closer: null }, config: null, configFile: file };
  }

  let config: DeliveryConfig = {};
  if (file !== undefined) {
    try {
      const checked = await checkConfig(file);
      if (!checked.ok) return { baseline: unreadable(root), config: null, configFile: file };
      config = checked.config;
    } catch (err) {
      if (err instanceof Refusal) return { baseline: unreadable(root), config: null, configFile: file };
      throw err;
    }
  }
  return { baseline: await baselineOf(root, file === undefined ? "none" : "read", config, env), config, configFile: file };
}

/**
 * The check and landing a project's own settings would use for a pack's work, read from data only: no project code runs, no git starts,
 * and a failure to read degrades the answer rather than refusing it.
 */
export async function projectBaseline(cwd: string, env: NodeJS.ProcessEnv, packDir: string): Promise<ProjectBaseline> {
  return (await readProject(cwd, env, packDir)).baseline;
}
