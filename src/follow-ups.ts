import { z } from "zod";
import { readRef, writeRef } from "./case-file.js";
import { BACKLOG_DIR } from "./backlog.js";
import { FileNotFound } from "./errors.js";
import { git } from "./git-exec.js";

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
