import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { load } from "../case-file.js";
import { computeDelta } from "../delta-rule.js";
import { git, tryGit } from "../git-exec.js";
import { takeRepoLock } from "../repo-lock.js";
import { resolveCloser } from "../resolve-closer.js";
import { resolveGate } from "../resolve-gate.js";
import { runPlace } from "../run-location.js";
import type { CloserRef } from "../schema.js";
import { FINDING_GATE_REF } from "./finding-gate.js";
import type { KeptFix } from "./fix-state.js";
import { FixTask } from "./fix-task.js";
import { appendLedger, readLedger, type NotLandedReason } from "./ledger.js";

export type SignOffOutcome = { kind: "landed"; commit: string; closer: CloserRef } | { kind: "not_landed"; reason: NotLandedReason; detail: string } | { kind: "busy" };
type Settled = Exclude<SignOffOutcome, { kind: "busy" }>;

const notLanded = (reason: NotLandedReason, detail: string): Settled => ({ kind: "not_landed", reason, detail });

async function removeCopies(repoPath: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) await tryGit(repoPath, ["worktree", "remove", "--force", "--", path]);
  await tryGit(repoPath, ["worktree", "prune"]);
}

/**
 * Bring a kept fix onto the main copy as it is now: rebase its branch onto the
 * base in a scratch working copy (git's own rebase), judge it there exactly as
 * the fix was judged (the finding gate's baseline on the base, its check on the
 * rebased fix, the delta rule), and only on a pass land it with the landing
 * closer pinned when it was authorised, now a fast-forward. No landing code of
 * its own. The scratch copies are removed however it ends; the branch is kept
 * unless the landing closer itself removes it after merging.
 */
async function land(repoPath: string, fix: KeptFix, replay: boolean, env: NodeJS.ProcessEnv): Promise<Settled> {
  const runDir = runPlace(repoPath, fix.runId, env).dir;
  const task = FixTask.parse((await load(runDir)).header.taskDef);
  const landing = task.authorisation.landing;
  if (landing === undefined) return notLanded("not_merged", "the fix recorded no way to merge it");
  const closer = resolveCloser(landing, repoPath);
  const scratch = runPlace(repoPath, `signoff-${fix.runId}`, env).location.worktreePath;
  const baseCopy = runPlace(repoPath, `signoff-base-${fix.runId}`, env).location.worktreePath;
  const ctx = { worktreePath: scratch, dir: runDir, repoPath, branch: fix.branch, baseBranch: fix.base };
  const landed = async (): Promise<Settled> => ({ kind: "landed", commit: await git(repoPath, ["rev-parse", fix.base]), closer: landing });

  if (!(await tryGit(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${fix.branch}`]))) {
    if (!replay) return notLanded("branch_gone", `branch ${fix.branch} is not in the repository`);
    // An earlier sign-off merged and was stopped before it was recorded: the landing closer's own replay says so.
    const report = await closer.close(ctx, { kind: "accepted" });
    return report.status === "DONE" ? landed() : notLanded("branch_gone", report.detail);
  }

  // What an interrupted sign-off left behind is cleared first, as a review clears its scratch copy.
  await removeCopies(repoPath, [scratch, baseCopy]);
  try {
    await mkdir(dirname(scratch), { recursive: true });
    await git(repoPath, ["worktree", "add", "--", scratch, fix.branch]);
    if (!(await tryGit(scratch, ["rebase", fix.base]))) {
      await tryGit(scratch, ["rebase", "--abort"]);
      return notLanded("conflict", `rebasing ${fix.branch} onto ${fix.base} stopped on a conflict`);
    }
    await git(repoPath, ["worktree", "add", "--detach", "--", baseCopy, fix.base]);
    const gate = resolveGate(FINDING_GATE_REF, repoPath);
    const judged = { taskDef: task, gateRef: FINDING_GATE_REF, baseBranch: fix.base };
    const baseline = await gate.baseline({ ...judged, worktreePath: baseCopy });
    if (baseline.status === "ERROR") return notLanded("check_error", baseline.detail ?? "the check could not run on the main copy");
    const check = await gate.check({ ...judged, worktreePath: scratch });
    if (check.status === "ERROR") return notLanded("check_error", check.detail ?? "the check could not run on the fix");
    const delta = computeDelta(baseline, check, { failOnNewAssertions: true });
    if (!delta.pass) return notLanded("check_failed", `newly failing: ${delta.newFailures.map((failure) => failure.id).join(", ")}`);
    const report = await closer.close(ctx, { kind: "accepted" });
    return report.status === "DONE" ? landed() : notLanded("not_merged", report.detail);
  } finally {
    await removeCopies(repoPath, [scratch, baseCopy]);
  }
}

/**
 * Sign off a kept fix: record the sign-off, then land it under the repository
 * lock, so it never runs beside a run of several tasks or another sign-off,
 * and record what came of it. "Busy" when the lock is held: nothing is
 * recorded and nothing changes.
 * ponytail: a fix run of one task at a time takes no lock, so a sign-off beside one can only fail its fast-forward plainly (not_merged); take the lock in every fix run if that is seen.
 */
export async function signOff(repoPath: string, reviewDir: string, findingId: string, fix: KeptFix, env: NodeJS.ProcessEnv): Promise<SignOffOutcome> {
  const release = await takeRepoLock(repoPath);
  if (release === undefined) return { kind: "busy" };
  try {
    // A replay only when the latest sign-off of this problem has no result yet: an earlier sign-off was stopped mid-way.
    // A sign-off that already ended not_landed is not a replay, so a branch deleted since then is branch_gone, never "landed".
    const mine = (await readLedger(reviewDir)).filter((entry) => (entry.t === "signed_off" || entry.t === "landed" || entry.t === "not_landed") && entry.id === findingId);
    const replay = mine.at(-1)?.t === "signed_off";
    await appendLedger(reviewDir, { t: "signed_off", id: findingId });
    const outcome = await land(repoPath, fix, replay, env);
    await appendLedger(
      reviewDir,
      outcome.kind === "landed" ? { t: "landed", id: findingId, commit: outcome.commit, closer: outcome.closer } : { t: "not_landed", id: findingId, reason: outcome.reason, detail: outcome.detail },
    );
    return outcome;
  } finally {
    await release();
  }
}
