import type { CloseContext, CloseOutcome, CloseReport, CloserPort } from "./ports.js";
import { CloseReport as CloseReportSchema } from "./schema.js";
import { CloserModuleLoadFailure, InvalidCloserExport } from "./errors.js";
import { messageOf } from "./gate-support.js";
import { closeError } from "./closer-support.js";
import { guardMethod, loadPlugin } from "./plugin-loader.js";

/**
 * Load a project's closer module. A relative `modulePath` is resolved against
 * `repoPath`, the repository root, never the worktree the surface ran in, so
 * the agent whose work is being closed cannot edit the closer. Throws
 * `CloserModuleLoadFailure` if the module cannot be imported and
 * `InvalidCloserExport` if the selected export has no `close` method, both
 * before `close` is ever called. The returned closer turns a throw, a
 * rejection or a malformed report into an ERROR report.
 */
export async function loadCustomCloser(
  repoPath: string,
  modulePath: string,
  exportName = "default",
): Promise<CloserPort> {
  const closer = await loadPlugin<CloserPort>(repoPath, modulePath, exportName, ["close"], {
    loadFailure: CloserModuleLoadFailure,
    invalidExport: InvalidCloserExport,
  });
  return {
    close: guardMethod(
      (ctx: CloseContext, outcome: CloseOutcome) => closer.close(ctx, outcome),
      CloseReportSchema,
      closeError,
      { plugin: "Custom closer", reportName: "CloseReport", method: "close", modulePath },
    ),
  };
}

/**
 * A closer that loads its module lazily, on the first `close()`, and reports
 * load failures as ERROR reports rather than exceptions: the shape closer
 * resolution needs, where "failed to load" and "failed to run" must reach
 * close-triage the same way.
 */
export function createCustomCloser(repoPath: string, modulePath: string, exportName?: string): CloserPort {
  let closer: Promise<CloserPort> | undefined;
  return {
    close: async (ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> => {
      closer ??= loadCustomCloser(repoPath, modulePath, exportName);
      try {
        return await (await closer).close(ctx, outcome);
      } catch (err) {
        return closeError(messageOf(err));
      }
    },
  };
}
