import type { CloserPort } from "./ports.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
import { failedCloser } from "./closer-support.js";
import { CloserRef } from "./schema.js";

/**
 * Turn a pinned closer reference into a runnable closer. Total, like
 * `resolveGate`: an unparseable reference (an unknown type, a missing one)
 * yields a closer whose `close()` returns an ERROR report, so a
 * misconfiguration reaches close-triage as a report rather than as a crash of
 * the surface.
 */
export function resolveCloser(closerRef: CloserRef): CloserPort {
  const parsed = CloserRef.safeParse(closerRef);
  if (!parsed.success) {
    return failedCloser(`Cannot resolve closer reference: ${parsed.error.message}`);
  }

  const ref = parsed.data;
  switch (ref.type) {
    case "merge-back":
      return createMergeBackCloser({ deleteBranch: ref.deleteBranch });
    case "commit-to-branch":
      return createCommitToBranchCloser();
  }
}
