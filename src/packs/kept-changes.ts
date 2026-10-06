import { git } from "../git-exec.js";
import type { KeptFix } from "./fix-state.js";

/** What a kept fix changed since it left its base: git's own summary of files and its patch. Reads only. */
export async function keptChanges(repoPath: string, fix: KeptFix): Promise<{ stat: string; patch: string }> {
  const range = `${fix.base}...${fix.branch}`;
  return { stat: await git(repoPath, ["diff", "--stat", range]), patch: await git(repoPath, ["diff", range], { raw: true }) };
}
