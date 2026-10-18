import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runSession, type SessionEnvironment } from "./agent-invoke.js";
import type { BatchEntry, BatchState } from "./after-ledger.js";
import type { AgentPassResult } from "./after-steps.js";
import { BACKLOG_DIR } from "./backlog.js";
import { containedSession } from "./containment.js";
import { git, tryGit } from "./git-exec.js";
import { addedBacklogItems } from "./guards.js";
import { branchName, provisionWorktree } from "./provision.js";
import { treeOf } from "./repair-changes.js";
import { WorkerEnvelope, type RoleConfig } from "./role-config.js";
import { prepareDeliveryDir, runPlace } from "./run-location.js";
import type { AgentOptions, FenceRecord } from "./schema.js";

/** Who the after pass is: work landed, and it does one thing about it outside the repository. */
export const afterRoleConfig: RoleConfig = {
  role: "after",
  systemPromptFragment: [
    "Work has just been delivered by a delivery harness, and you are doing one thing about it once it has landed.",
    "You work in a scratch copy of the project at the landed commit, which is thrown away when you finish.",
    "Work as you normally would, with your own tools, skills and judgement. If it cannot be done, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
};

/** What the after pass is asked: the operator's own instruction, what landed, and what happens to its changes. */
export function afterPrompt(prompt: string, batch: BatchEntry): string {
  return [
    "# After landing",
    "",
    prompt.trim(),
    "",
    "## What landed",
    `Commit ${batch.commit} on ${batch.branch}:`,
    ...batch.landed.map((task) => `- ${task.intent} (${task.item})`),
    "",
    "## What happens to your changes",
    `Any change you make to the project's files is discarded, except a new item file in ${BACKLOG_DIR}/, in the item format, which is raised as a follow-up. Do not edit or remove an existing item.`,
  ].join("\n");
}

const lines = (text: string): string[] => text.split("\n").filter(Boolean);

/**
 * One after pass (spec §5.7): a session with full capability, inside the landing boundary and the fence when the run
 * has one, in a worktree of the landed commit that is removed however it ends. Only new backlog items survive it,
 * judged as any task's follow-ups are; every other change is named and discarded with the worktree.
 */
export async function runAgentPass(
  prompt: string,
  { state, index }: { state: BatchState; index: number },
  { repoPath, env, session, fence, agent, domain }: { repoPath: string; env: NodeJS.ProcessEnv; session: SessionEnvironment; fence: FenceRecord; agent?: AgentOptions; domain?: string },
): Promise<AgentPassResult> {
  const { batch } = state;
  await prepareDeliveryDir(repoPath);
  const surfaceId = `${batch.batch}-${index}`;
  const { worktreePath } = runPlace(repoPath, surfaceId, env).location;
  const dir = join(repoPath, ".delivery", "after", surfaceId);
  await provisionWorktree(dir, repoPath, worktreePath, surfaceId, batch.commit);
  try {
    const contained = await containedSession({ ...session, ...(agent === undefined ? {} : { agent }) }, { header: { surfaceId, fence }, repoPath, dir, worktreePath, env });
    const systemPrompt = [afterRoleConfig.systemPromptFragment, domain, agent?.append].filter((part) => part !== undefined && part !== "").join("\n\n");
    const terminus = await runSession(afterRoleConfig, { worktreePath, dir, sessionKey: `after-${surfaceId}` }, { systemPrompt, prompt: afterPrompt(prompt, batch) }, contained);
    if (terminus.status !== "completed") return { ok: false, detail: `the agent did not finish: ${terminus.rationale}` };
    const tree = await treeOf(worktreePath);
    const { items, findings } = await addedBacklogItems(worktreePath, batch.commit, tree);
    if (findings.length > 0) return { ok: false, detail: `the agent changed the backlog in a way it may not: ${findings.join(", ")}.` };
    const discarded = lines(await git(worktreePath, ["diff-tree", "-r", "--name-only", batch.commit, tree, "--", ".", `:(exclude)${BACKLOG_DIR}/**`]));
    return { ok: true, items, discarded };
  } finally {
    await tryGit(repoPath, ["worktree", "remove", "--force", "--", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    await tryGit(repoPath, ["branch", "-D", "--", branchName(surfaceId)]);
    // Nothing reads the pass's scratch folder afterwards (its outcome is in the after ledger), so none of it is kept.
    await rm(dir, { recursive: true, force: true });
  }
}
