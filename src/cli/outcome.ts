import { readRef } from "../case-file.js";
import { branchName } from "../provision.js";
import { CloseReport } from "../schema.js";
import type { CaseFile, CloserRef } from "../schema.js";
import { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Tone } from "./output.js";

/** How a finished run is reported: a headline in plain language, the lines under it, and the exit code. */
export interface OutcomeSummary {
  headline: string;
  tone: Tone;
  details: string[];
  exitCode: ExitCode;
}

function intentOf(caseFile: CaseFile): string {
  const { intent } = caseFile.header.taskDef;
  return typeof intent === "string" ? intent : "the task";
}

function checkOf(caseFile: CaseFile): string {
  const { gateRef } = caseFile.header;
  return gateRef.type === "command" ? `\`${gateRef.command}\`` : "the check";
}

/** The packet the escalation recorded, or undefined when the run has none to show. Shared with `status`, which prints all of it. */
export async function packetOf(dir: string, packetRef: string | undefined): Promise<EscalationPacket | undefined> {
  if (packetRef === undefined) return undefined;
  const parsed = EscalationPacket.safeParse(await readRef(dir, packetRef));
  return parsed.success ? parsed.data : undefined;
}

/** What the run's last close reported, for the closers whose result only they can describe. */
async function closeDetail(dir: string, caseFile: CaseFile): Promise<string | undefined> {
  const entry = caseFile.history.findLast((historyEntry) => historyEntry.t === "close");
  if (entry?.status !== "DONE") return undefined;
  const parsed = CloseReport.safeParse(await readRef(dir, entry.detailRef));
  return parsed.success ? parsed.data.detail : undefined;
}

/**
 * Where the work ended up, which is a different sentence for each closing
 * action: committed to its own branch, merged into the base branch, or left on a
 * branch with a pull request open. Total over the closer types, so a new one
 * does not compile until it can say where it put the work. A run that pinned no
 * closer predates closers being pinned, and was committed to its branch.
 */
function landing(
  closerRef: CloserRef | undefined,
  { branch, base, detail }: { branch: string; base: string; detail: string | undefined },
): { where: string; details: string[] } {
  const onItsBranch = {
    where: `is committed on branch ${branch}`,
    details: [`${base} was not changed. To look at the work: git log ${branch}`],
  };
  switch (closerRef?.type) {
    case undefined:
    case "commit-to-branch":
      return onItsBranch;
    case "merge-back":
      return { where: `is merged into ${base}`, details: [`To look at the work: git log ${base}`] };
    case "open-pr":
      return detail === undefined
        ? { where: `is on branch ${branch}, with a pull request open`, details: onItsBranch.details }
        : { where: `is on branch ${branch}, with a pull request open`, details: [`The pull request: ${detail}`] };
    case "custom":
      return {
        where: "your own closer finished it",
        details: detail === undefined ? [] : [`Your closer says: ${detail}`],
      };
  }
}

/**
 * What a finished run did, in the task's terms. A closed run names the branch
 * the work is on; an escalated one leads with the decision being asked of a
 * person, with the evidence quoted beneath it, never paraphrased away.
 */
export async function summariseOutcome(dir: string, caseFile: CaseFile): Promise<OutcomeSummary> {
  const { outcome } = caseFile;
  if (!outcome) throw new Error(`summariseOutcome was given an unfinished run: ${dir}`);
  const branch = branchName(caseFile.header.surfaceId);
  const base = caseFile.header.baseBranch ?? "your base branch";

  switch (outcome.kind) {
    case "closed": {
      const { closerRef } = caseFile.header;
      const needsDetail = closerRef?.type === "open-pr" || closerRef?.type === "custom";
      const { where, details } = landing(closerRef, {
        branch,
        base,
        detail: needsDetail ? await closeDetail(dir, caseFile) : undefined,
      });
      return {
        headline: `Done: the change for "${intentOf(caseFile)}" passed ${checkOf(caseFile)} and ${where}.`,
        tone: "done",
        details,
        exitCode: EXIT.ok,
      };
    }
    case "escalated": {
      const packet = await packetOf(dir, outcome.packetRef);
      return {
        headline: `This needs your decision: ${packet?.decision ?? outcome.reason}`,
        tone: "attention",
        details: [
          ...(packet ? ["", "What the harness saw:", packet.evidence] : []),
          "",
          // Not "the work is kept on the branch": a stopped run's closer force-removes the
          // working copy without committing, so the branch holds none of this run's edits.
          `Nothing was changed on ${base}.`,
        ],
        exitCode: EXIT.escalated,
      };
    }
    case "aborted":
      // A provisioning abort's reason is raw git output ("worktree", the branch scheme):
      // lead with what to fix, and keep git's words beneath it for diagnosis.
      if (outcome.source === "provisioning") {
        return {
          headline:
            "The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit, and that you can write to it.",
          tone: "stopped",
          details: [`Details: ${outcome.reason}`],
          exitCode: EXIT.aborted,
        };
      }
      return {
        headline: `The run stopped: ${outcome.reason}`,
        tone: "stopped",
        details: [],
        exitCode: EXIT.aborted,
      };
  }
}

/** Summarise a finished run's outcome and tell the reporter, for the two places that finish a run this way: driving it to its end, and retelling one that already ended. */
export async function reportOutcome(dir: string, caseFile: CaseFile, ctx: CommandContext): Promise<ExitCode> {
  const summary = await summariseOutcome(dir, caseFile);
  ctx.report.outcome(summary);
  return summary.exitCode;
}
