import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readRef, writeRef } from "./case-file.js";
import { BACKLOG_DIR } from "./backlog.js";
import { baseTip } from "./delivery-branch.js";
import { recordDelivery } from "./delivery-ledger.js";
import { inDetachedWorktree } from "./disposable-copy.js";
import { FileNotFound } from "./errors.js";
import { branchExists, git } from "./git-exec.js";

/** A new backlog item file as an agent wrote it: its name and its whole text. */
export const HeldItem = z.object({ file: z.string(), text: z.string() });
export type HeldItem = z.infer<typeof HeldItem>;

/** The case-file ref a tracker task's follow-ups are held in, from its close until they are raised after landing. */
export const FOLLOW_UPS_REF = "follow-ups";

/** What a case file holds for raising: nothing when it never held any. */
export async function heldFollowUps(dir: string): Promise<HeldItem[]> {
  try {
    return z.array(HeldItem).parse(await readRef(dir, FOLLOW_UPS_REF));
  } catch (err) {
    if (err instanceof FileNotFound) return [];
    throw err;
  }
}

/**
 * On a project whose backlog is a tracker, the backlog folder is only a drop folder (spec §5.5): the new item files a
 * task added are taken off its branch, in a commit of their own, and held in its case file to be raised once the run's
 * closer succeeds. Held before the commit, so a crash between the two finds the files again and holds the same set.
 */
export async function holdFollowUps(dir: string, worktreePath: string, deliveryBranch: string, source: string): Promise<void> {
  const base = await git(worktreePath, ["merge-base", "HEAD", `refs/heads/${deliveryBranch}`]);
  const paths = (await git(worktreePath, ["diff", "--name-only", "--diff-filter=A", "-z", base, "HEAD", "--", `${BACKLOG_DIR}/`], { raw: true })).split("\0").filter(Boolean);
  if (paths.length === 0) return;
  const added = await Promise.all(paths.map(async (path) => ({ file: path.slice(BACKLOG_DIR.length + 1), text: await git(worktreePath, ["show", `HEAD:${path}`], { raw: true }) })));
  const held = await heldFollowUps(dir);
  await writeRef(dir, FOLLOW_UPS_REF, [...held.filter((item) => !added.some((a) => a.file === item.file)), ...added]);
  await git(worktreePath, ["rm", "-q", "--", ...paths]);
  await git(worktreePath, ["commit", "-q", "-m", `Hold follow-ups to raise in ${source}`]);
}

/**
 * An after pass's follow-ups on a project whose backlog is its own folder: committed onto the delivery branch, which
 * is opened again at the base's tip when the closer merged and deleted it, and recorded as landed so the next run's
 * closer takes them (spec §5.7). Idempotent: an item already on the tip is not added again, and the landing is recorded
 * once per `runId` (the delivery ledger keeps one landing per run).
 */
export async function landFollowUps(
  { repoPath, ledger, branch, base, runId }: { repoPath: string; ledger: string; branch: string; base: string; runId: string },
  items: readonly HeldItem[],
): Promise<void> {
  const open = await branchExists(repoPath, branch);
  const from = open ? await git(repoPath, ["rev-parse", `refs/heads/${branch}`]) : (await baseTip(repoPath)).commit;
  const commit = await inDetachedWorktree(repoPath, from, async (copy) => {
    const fresh = items.filter((item) => !existsSync(join(copy, BACKLOG_DIR, item.file)));
    if (fresh.length === 0) return from;
    for (const item of fresh) {
      const path = join(copy, BACKLOG_DIR, item.file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, item.text);
    }
    await git(copy, ["add", "--", ...fresh.map((item) => `${BACKLOG_DIR}/${item.file}`)]);
    await git(copy, ["commit", "-q", "-m", "Add follow-ups raised after landing"]);
    return git(copy, ["rev-parse", "HEAD"]);
  });
  if (open && commit !== from) await git(repoPath, ["update-ref", `refs/heads/${branch}`, commit, from]);
  if (!open) {
    await git(repoPath, ["branch", "--", branch, commit]);
    await recordDelivery(ledger, { t: "opened", branch, base, from });
  }
  await recordDelivery(ledger, { t: "landed", branch, runId, key: "after:follow-ups", intent: "Follow-ups raised after landing", commit });
}
