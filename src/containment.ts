import { join } from "node:path";
import type { SessionEnvironment } from "./agent-invoke.js";
import { fenceSession } from "./fence.js";
import { landingBoundary } from "./landing-boundary.js";
import { branchName } from "./provision.js";
import type { CaseFileHeader } from "./schema.js";

/**
 * One session as a run starts it: its git kept to the task's branch (the landing boundary, hooks in the run's own
 * folder), and inside the write fence when the run started with one. Every session of the run comes through here,
 * whatever its role.
 */
export async function containedSession(
  session: SessionEnvironment,
  { header, repoPath, dir, worktreePath, env }: { header: Pick<CaseFileHeader, "surfaceId" | "fence">; repoPath: string; dir: string; worktreePath: string; env: NodeJS.ProcessEnv },
): Promise<SessionEnvironment> {
  const base = { ...(session.env ?? process.env), ...session.agent?.env };
  const landing = await landingBoundary({ repoPath, hooksDir: join(dir, "hooks"), branch: branchName(header.surfaceId), base, env });
  const landed: SessionEnvironment = { ...session, harnessEnv: { ...session.harnessEnv, ...landing } };
  const fence = header.fence;
  if (fence === undefined || !fence.state.present) return landed;
  return fenceSession(landed, { repoPath, worktreePath, devices: fence.devices, env });
}
