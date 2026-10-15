import type { SessionEnvironment } from "./agent-invoke.js";
import { fenceSession } from "./fence.js";
import type { CaseFileHeader } from "./schema.js";

/**
 * One session as a run starts it: inside the write fence when the run started with one. Every session of the run
 * comes through here, whatever its role, so none can start outside what the run recorded.
 */
export async function containedSession(
  session: SessionEnvironment,
  { header, repoPath, worktreePath, env }: { header: Pick<CaseFileHeader, "fence">; repoPath: string; worktreePath: string; env: NodeJS.ProcessEnv },
): Promise<SessionEnvironment> {
  const fence = header.fence;
  if (fence === undefined || !fence.state.present) return session;
  return fenceSession(session, { repoPath, worktreePath, devices: fence.devices, env });
}
