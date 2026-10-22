import type { RunHeader } from "../schema.js";
import { repoLocked, takeRepoLock } from "../repo-lock.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { shapeOf } from "./queue.js";
import { startedAt, unfinishedSupervisedRun } from "./runs.js";

/** What an idle run says when it finds another run going and so does nothing. */
export const SKIPPED_IDLE = "Skipped: another run is going here";

/**
 * Why a run cannot start: a run of several at once is already going in this
 * repository, and which one, so the owner can look at it rather than start a
 * second that would fight it over the same checkout. `live` is that run's
 * header, when its record can be found.
 */
export function liveRunFound(live: RunHeader | undefined): string {
  const which = live === undefined ? "" : ` (started \`${startedAt(live.runId)}\`, ${shapeOf(live.tasks, live.concurrency)}: \`${live.runId}\`)`;
  return `Another run is already going here${which}. Run \`delivery status\` to see how it is getting on, or wait for it to finish before starting another.`;
}

/** Refuse to go on while a run of several at once holds this repository. Every command that drives a run asks this first. */
export async function refuseIfRunGoing(repoPath: string): Promise<void> {
  if (await repoLocked(repoPath)) {
    throw new Refusal(liveRunFound((await unfinishedSupervisedRun(repoPath))?.runFile.header), EXIT.configuration);
  }
}

/**
 * Run a command holding the repository for as long as it runs. The lock is taken
 * in one step rather than checked and then taken, so no second run can slip in
 * between the two. When a live run already holds it, the command is refused
 * naming that run, or with `ifIdle` it says so in one line and succeeds. The
 * lock is released however the command ends. `proper-lockfile`'s exit hook
 * frees it on Ctrl-C too.
 */
export async function holdingRepo(
  repoPath: string,
  { ifIdle = false }: { ifIdle?: boolean },
  ctx: CommandContext,
  body: () => Promise<ExitCode>,
): Promise<ExitCode> {
  const release = await takeRepoLock(repoPath);
  if (release === undefined) {
    if (ifIdle) {
      ctx.report.note(SKIPPED_IDLE);
      return EXIT.ok;
    }
    throw new Refusal(liveRunFound((await unfinishedSupervisedRun(repoPath))?.runFile.header), EXIT.configuration);
  }
  try {
    return await body();
  } finally {
    await release();
  }
}
