import type { RunHeader } from "../schema.js";
import { repoLocked } from "../repo-lock.js";
import { EXIT, Refusal } from "./failures.js";
import { shapeOf } from "./queue.js";
import { startedAt, unfinishedSupervisedRun } from "./runs.js";

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
