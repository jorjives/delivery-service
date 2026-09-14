import { readRef } from "../case-file.js";
import { branchName } from "../provision.js";
import { EscalationPacket } from "../triage-role-config.js";
import type { CaseFile } from "../schema.js";
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

/** The packet the escalation recorded, or undefined when the run has none to show. */
async function packetOf(dir: string, packetRef: string | undefined): Promise<EscalationPacket | undefined> {
  if (packetRef === undefined) return undefined;
  const parsed = EscalationPacket.safeParse(await readRef(dir, packetRef));
  return parsed.success ? parsed.data : undefined;
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
    case "closed":
      return {
        headline: `Done: the change for "${intentOf(caseFile)}" passed ${checkOf(caseFile)} and is committed on branch ${branch}.`,
        tone: "done",
        details: [`${base} was not changed. To look at the work: git log ${branch}`],
        exitCode: EXIT.ok,
      };
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
