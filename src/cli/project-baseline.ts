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

/**
 * The check and landing a project's own settings would use for a pack's work, read from data only: no project code runs, no git starts,
 * and a failure to read degrades the answer rather than refusing it.
 */
export async function projectBaseline(cwd: string, env: NodeJS.ProcessEnv, packDir: string): Promise<ProjectBaseline> {
  const root = repoRootOf(realpathSync(cwd));
  const pack = realpathSync(packDir);
  if (root === undefined || within(root, pack)) return NO_PROJECT;

  let file: string | undefined;
  try {
    file = findConfig({ startDir: root, repoPath: root, flag: undefined, env });
  } catch (err) {
    if (err instanceof Refusal) return unreadable(root);
    throw err;
  }
  if (file !== undefined && within(realpathSync(file), pack)) return NO_PROJECT;
  if (file !== undefined && !file.endsWith(".json")) return { found: true, path: root, config: "code", gate: null, closer: null };

  let config: DeliveryConfig = {};
  if (file !== undefined) {
    try {
      const checked = await checkConfig(file);
      if (!checked.ok) return unreadable(root);
      config = checked.config;
    } catch (err) {
      if (err instanceof Refusal) return unreadable(root);
      throw err;
    }
  }
  const read = file === undefined ? "none" : "read";

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
