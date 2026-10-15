import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { runSession, type SessionEnvironment } from "../agent-invoke.js";
import { containedSession } from "../containment.js";
import { git, tryGit } from "../git-exec.js";
import { isEnoent } from "../journal.js";
import type { Incomplete } from "../ports.js";
import type { FenceRecord } from "../schema.js";
import { branchName, provisionWorktree, resolveBaseRef } from "../provision.js";
import { prepareDeliveryDir, runIdFor, runPlace } from "../run-location.js";
import { confirmFindings, inScope } from "./confirm.js";
import type { Pack } from "./manifest.js";
import { listReviews, packsRoot, PinnedCategory, readHeader, readReply, saveResult, startReview, type ReviewHeader, type SavedReview } from "./review-record.js";
import { scannerRoleConfig, scanSession } from "./scanner-role.js";

/** Where a session that produced no usable list keeps why: beside the reviews, never inside one, so a failed review saves nothing that reads as a review. */
export const scanErrorsDir = (repoPath: string): string => join(packsRoot(repoPath), "scan-errors");

export type ReviewOutcome = { kind: "done"; review: SavedReview; recovered: boolean } | { kind: "failed"; terminus: Incomplete } | { kind: "empty_scope"; scope: string };

/** The files a review of `commit` reads: every file in it, or only those inside `scope`. Shared by the review and its preview, so what is previewed is what is sent. */
export async function filesToReview(repoPath: string, commit: string, scope?: string): Promise<string[]> {
  const files = (await git(repoPath, ["ls-tree", "-r", "-z", "--name-only", commit])).split("\0").filter(Boolean);
  return files.filter((file) => inScope(file, scope));
}

export interface ReviewOptions {
  /** The agent session to use, asked for only when a new session is needed, so finishing an interrupted review needs no sign-in. */
  session: () => Promise<SessionEnvironment>;
  /**
   * The write fence the scanner starts in, asked for only when a new session is needed (so finishing an interrupted
   * review probes nothing). Required: no scanner starts without its fence having been asked for.
   */
  fence: () => Promise<FenceRecord>;
  /** Where the scratch working copy goes (`XDG_STATE_HOME`). */
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  /** The project has no tests: recorded with the review, so every reading of it tells the owner so. */
  noTests?: boolean;
  /** Review only this part of the project, as git names it. */
  scope?: string;
}

/** The scratch working copy's id, fixed per pack, so one left by an interrupted review is cleared by the next. */
// ponytail: one review of a pack at a time per repository; two at once would share this working copy. Take the repository lock if that is ever wanted.
const scratchId = (packName: string): string => `review-${packName}`;

/** Confirm a recorded reply against the repository at its commit and save the list: the step that finishes a review, first time or after an interruption. */
export async function finishReview(repoPath: string, dir: string): Promise<SavedReview> {
  const header = await readHeader(dir);
  const { envelope, usage } = await readReply(dir, header);
  const result = await confirmFindings(repoPath, header.commit, { pack: header.pack.name, maxFindings: header.pack.maxFindings, categories: header.pack.categories, checks: header.pack.checks, scope: header.path }, envelope);
  await saveResult(dir, result);
  return { dir, header, result, ...(usage === undefined ? {} : { usage }) };
}

const pinned = ({ manifest, hash, fixInstructions }: Pack): ReviewHeader["pack"] => ({
  name: manifest.name,
  version: manifest.version,
  title: manifest.title,
  hash,
  maxFindings: manifest.scan.maxFindings,
  ...(manifest.scan.requireCheck === true ? { requireCheck: true as const } : {}),
  // Parsed, not copied: the pinned shape keeps what a review needs of each category and drops its description.
  categories: z.array(PinnedCategory).parse(manifest.scan.categories),
  consequenceLabel: manifest.scan.consequenceLabel,
  hold: manifest.hold.atOrAbove,
  guards: { testGlobs: manifest.fix?.testGlobs ?? [], protectedGlobs: manifest.fix?.protectedGlobs ?? [], skipMarkers: manifest.fix?.skipMarkers ?? [] },
  checks: manifest.scan.checks,
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
 * from its saved reply if there is one; otherwise runs one session, inside the
 * write fence where it can be had, in a scratch working copy of the last
 * commit, records the reply, confirms it and saves the list. The owner's
 * files, branches and working copy are never touched: the scratch copy and
 * its branch are removed however the session ends.
 */
export async function runReview(repoPath: string, pack: Pack, { session, fence, env, now = () => new Date(), noTests = false, scope }: ReviewOptions): Promise<ReviewOutcome> {
  const pending = (await listReviews(repoPath)).find((entry) => entry.state === "unfinished" && entry.header.pack.name === pack.manifest.name);
  if (pending !== undefined) return { kind: "done", review: await finishReview(repoPath, pending.dir), recovered: true };
  // Checked before anything is set up or signed in to, so a mistyped part costs nothing.
  if (scope !== undefined && (await filesToReview(repoPath, (await resolveBaseRef(repoPath)).ref, scope)).length === 0) return { kind: "empty_scope", scope };

  const started = now();
  // Before the session, so a fence that is required and absent refuses before anything is signed in to or set up.
  const fenceRecord = await fence();
  const sessionEnv = await session();
  await prepareDeliveryDir(repoPath);
  const surfaceId = scratchId(pack.manifest.name);
  const { worktreePath } = runPlace(repoPath, surfaceId, env).location;
  const errors = scanErrorsDir(repoPath);
  await provisionWorktree(errors, repoPath, worktreePath, surfaceId);
  try {
    const commit = await git(worktreePath, ["rev-parse", "HEAD"]);
    const files = await filesToReview(repoPath, commit, scope);
    const reviewId = runIdFor(pack.manifest.name, started, await takenIds(repoPath));
    // The scanner has every tool, so it starts like every session: inside the fence when the probe found one.
    const contained = await containedSession(sessionEnv, { header: { fence: fenceRecord }, repoPath, worktreePath, env });
    const terminus = await runSession(scannerRoleConfig(pack), { worktreePath, dir: errors, sessionKey: `scanner-${reviewId}` }, scanSession(pack, files, scope), contained);
    if ("status" in terminus) return { kind: "failed", terminus };
    const { usage, ...envelope } = terminus;
    const header: ReviewHeader = { reviewId, pack: pinned(pack), repoPath, commit, fileCount: files.length, startedAt: started.toISOString(), endedAt: now().toISOString(), ...(noTests ? { noTests: true as const } : {}), ...(scope === undefined ? {} : { path: scope }) };
    const dir = await startReview(repoPath, header, { envelope, ...(usage === undefined ? {} : { usage }) });
    return { kind: "done", review: await finishReview(repoPath, dir), recovered: false };
  } finally {
    await tryGit(repoPath, ["worktree", "remove", "--force", "--", worktreePath]);
    await tryGit(repoPath, ["worktree", "prune"]);
    await tryGit(repoPath, ["branch", "-D", "--", branchName(surfaceId)]);
  }
}
