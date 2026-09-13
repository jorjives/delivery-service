import type { CloserPort } from "./ports.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
import { createOpenPrCloser } from "./open-pr-closer.js";
import { createCustomCloser } from "./custom-closer.js";
import { failedCloser } from "./closer-support.js";
import { CloserRef } from "./schema.js";

/**
 * Turn a pinned closer reference into a runnable closer. Total, like
 * `resolveGate`: an unparseable reference (an unknown type, a missing one), a
 * custom module that cannot be loaded, or one that fails when run all yield an
 * ERROR report from `close()`, so a misconfiguration reaches close-triage as a
 * report rather than as a crash of the surface.
 *
 * `repoPath` is what a custom closer's relative `modulePath` resolves against.
 * It is required for the same reason `resolveGate`'s is: a caller that omitted
 * it would load the closer from wherever the process happens to be running.
 * Pass the surface's `SurfaceLocation.repoPath`.
 */
export function resolveCloser(closerRef: CloserRef, repoPath: string): CloserPort {
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
    case "open-pr":
      return createOpenPrCloser();
    case "custom":
      return createCustomCloser(repoPath, ref.modulePath, ref.exportName);
  }
}
