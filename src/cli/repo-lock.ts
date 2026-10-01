import lockfile from "proper-lockfile";
import { prepareDeliveryDir, supervisorLockPath } from "../run-location.js";

/**
 * How long a lock nobody has touched is still taken to be held. `proper-lockfile`
 * touches a held lock every half of this, so only a holder that was killed lets
 * it go stale. Its own default, set here so taking and checking agree.
 * ponytail: 10 s, so a run started within 10 s of a SIGKILL is refused as though the old one were live; shorten if that bites.
 */
const STALE_MS = 10_000;

const lockOptions = (repoPath: string) => ({ lockfilePath: supervisorLockPath(repoPath), stale: STALE_MS });

/**
 * Take the repository's lock for a run of several tasks at once, so a second
 * cannot start on top of it. `proper-lockfile` rather than a lock of our own:
 * it keeps the lock fresh while its holder lives and treats a stale one as
 * free, so a run killed outright is followed by one that simply takes the lock
 * over, with no unlock step for anyone. Its exit hook lets the lock go when the
 * process ends by `process.exit` or a signal, so Ctrl-C frees it at once.
 *
 * The release function, or nothing when a live run already holds the lock.
 */
export async function takeRepoLock(repoPath: string): Promise<(() => Promise<void>) | undefined> {
  await prepareDeliveryDir(repoPath);
  try {
    return await lockfile.lock(repoPath, { ...lockOptions(repoPath), retries: 0 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOCKED") return undefined;
    throw err;
  }
}

/** Whether a live run of several tasks at once holds this repository's lock. A stale lock is not held. */
export function repoLocked(repoPath: string): Promise<boolean> {
  return lockfile.check(repoPath, lockOptions(repoPath));
}
