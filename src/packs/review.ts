import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { runSession, type SessionEnvironment } from "../agent-invoke.js";
import { git, tryGit } from "../git-exec.js";
import { isEnoent } from "../journal.js";
import type { Incomplete } from "../ports.js";
import { branchName, provisionWorktree } from "../provision.js";
import { prepareDeliveryDir, runIdFor, runPlace } from "../run-location.js";
import { confirmFindings } from "./confirm.js";
import type { Pack } from "./manifest.js";
import { listReviews, packsRoot, PinnedCategory, readHeader, readReply, saveResult, startReview, type ReviewHeader, type SavedReview } from "./review-record.js";
import { scannerRoleConfig, scanSession } from "./scanner-role.js";

/** Where a session that produced no usable list keeps why: beside the reviews, never inside one, so a failed review saves nothing that reads as a review. */
export const scanErrorsDir = (repoPath: string): string => join(packsRoot(repoPath), "scan-errors");

export type ReviewOutcome = { kind: "done"; review: SavedReview; recovered: boolean } | { kind: "failed"; terminus: Incomplete };

export interface ReviewOptions {
  /** The agent session to use, asked for only when a new session is needed, so finishing an interrupted review needs no sign-in. */
  session: () => Promise<SessionEnvironment>;
  /** Where the scratch working copy goes (`XDG_STATE_HOME`). */
  env: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** The scratch working copy's id, fixed per pack, so one left by an interrupted review is cleared by the next. */
// ponytail: one review of a pack at a time per repository; two at once would share this working copy. Take the repository lock if that is ever wanted.
const scratchId = (packName: string): string => `review-${packName}`;

/** Confirm a recorded reply against the repository at its commit and save the list: the step that finishes a review, first time or after an interruption. */
export async function finishReview(repoPath: string, dir: string): Promise<SavedReview> {
  const header = await readHeader(dir);
  const { envelope } = await readReply(dir, header);
  const result = await confirmFindings(repoPath, header.commit, { pack: header.pack.name, maxFindings: header.pack.maxFindings, categories: header.pack.categories }, envelope);
  await saveResult(dir, result);
  return { dir, header, result };
}

const pinned = ({ manifest, hash, fixInstructions }: Pack): ReviewHeader["pack"] => ({
  name: manifest.name,
  version: manifest.version,
  title: manifest.title,
  hash,
  maxFindings: manifest.scan.maxFindings,
  // Parsed, not copied: the pinned shape keeps what a review needs of each category and drops its description.
  categories: z.array(PinnedCategory).parse(manifest.scan.categories),
  consequenceLabel: manifest.scan.consequenceLabel,
  hold: manifest.hold.atOrAbove,
  guards: { testGlobs: manifest.fix?.testGlobs ?? [], protectedGlobs: manifest.fix?.protectedGlobs ?? [], skipMarkers: manifest.fix?.skipMarkers ?? [] },
  ...(fixInstructions === undefined ? {} : { fixInstructions }),
});

async function takenIds(repoPath: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(packsRoot(repoPath)));
  } catch (err) {
    if (isEnoent(err)) return new Set();
    throw err;
  }
}

/**
 * Review `repoPath` through `pack`. Finishes this pack's interrupted review
 * from its saved reply if there is one; otherwise runs one read-only session
 * in a scratch working copy of the last commit, records the reply, confirms it
 * and saves the list. The owner's files, branches and working copy are never
 * touched: the scratch copy and its branch are removed however the session ends.
 */
export async function runReview(repoPath: string, pack: Pack, { session, env, now = () => new Date() }: ReviewOptions): Promise<ReviewOutcome> {
  const pending = (await listReviews(repoPath)).find((entry) => entry.state === "unfinished" && entry.header.pack.name === pack.manifest.name);
  if (pending !== undefined) return { kind: "done", review: await finishReview(repoPath, pending.dir), recovered: true };

  const started = now();
  const sessionEnv = await session();
  await prepareDeliveryDir(repoPath);
  const surfaceId = scratchId(pack.manifest.name);
  const { worktreePath } = runPlace(repoPath, surfaceId, env).location;
  const errors = scanErrorsDir(repoPath);
  await provisionWorktree(errors, repoPath, worktreePath, surfaceId);
  try {
    const commit = await git(worktreePath, ["rev-parse", "HEAD"]);
    const files = (await git(repoPath, ["ls-tree", "-r", "-z", "--name-only", commit])).split("\0").filter(Boolean);
    const reviewId = runIdFor(pack.manifest.name, started, await takenIds(repoPath));
    const terminus = await runSession(scannerRoleConfig(pack), { worktreePath, dir: errors, sessionKey: `scanner-${reviewId}` }, scanSession(pack, files), sessionEnv);
    if ("status" in terminus) return { kind: "failed", terminus };
    const { usage, ...envelope } = terminus;
    const header: ReviewHeader = { reviewId, pack: pinned(pack), repoPath, commit, fileCount: files.length, startedAt: started.toISOString(), endedAt: now().toISOString() };
    const dir = await startReview(repoPath, header, { envelope, ...(usage === undefined ? {} : { usage }) });
    return { kind: "done", review: await finishReview(repoPath, dir), recovered: false };
  } finally {
    await tryGit(repoPath, ["worktree", "remove", "--force", "--", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    await tryGit(repoPath, ["branch", "-D", "--", branchName(surfaceId)]);
  }
}
