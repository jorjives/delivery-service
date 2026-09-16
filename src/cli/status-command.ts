import { existsSync } from "node:fs";
import { branchName } from "../provision.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { packetOf, summariseOutcome } from "./outcome.js";
import { nextStep, paint } from "./output.js";
import { runPlace } from "./run-location.js";
import { readableUtc, startedAt, type RunRecord } from "./runs.js";
import { taskIntent } from "./settings.js";

/**
 * The packet a stopped run left, in the order a person reads it: every field
 * the harness wrote, under a heading saying what it is, and none of it
 * paraphrased. Whoever picks this up was not watching, so the harness's own
 * account is all they have.
 */
function packetLines(packet: EscalationPacket): string[] {
  return [
    "",
    "What the harness saw:",
    packet.evidence,
    "",
    "What had already been tried:",
    packet.dead_ends,
    "",
    "Why it stopped when it did:",
    packet.why_now,
    ...(packet.references.length === 0
      ? []
      : ["", "The agent sessions behind this:", ...packet.references.map((reference) => `  ${reference}`)]),
  ];
}

/**
 * Where a stopped run's work is, checked rather than assumed. The built-in
 * closers keep the branch and clear the scratch working copy away on any
 * outcome that is not accepted, so naming a path that is not there would waste
 * the reader's time; a working copy that did survive is worth naming, and the
 * run's own record is always there.
 */
function whereToLook(record: RunRecord, ctx: CommandContext): string[] {
  const { location } = runPlace(record.repoPath, record.runId, ctx.env);
  return [
    "",
    "Where to look:",
    `  The branch ${branchName(record.caseFile.header.surfaceId)} was kept.`,
    existsSync(location.worktreePath)
      ? `  The agent's working copy is still at ${location.worktreePath}.`
      : "  The agent's working copy has been cleared away.",
    `  Everything this run recorded is in ${record.dir}.`,
  ];
}

/**
 * One run's record, as a person reads it: which run and what it was asked to
 * do, then what happened. A run that did not finish says what picking it up
 * will do next; a run that stopped says so in the words the harness wrote at
 * the time, and where its work was kept. Pure over the record: this reads, and
 * never advances anything.
 */
export async function statusReport(record: RunRecord, ctx: CommandContext): Promise<string[]> {
  const { caseFile, dir, runId } = record;
  const opening = `Run ${runId}, started ${startedAt(runId)}: ${taskIntent(caseFile.header.taskDef)}`;
  const { outcome } = caseFile;

  if (!outcome) {
    return [
      opening,
      paint(ctx.colour, "quiet", `This run hasn't finished. Picking it up will carry on with ${nextStep(caseFile)}.`),
      `To finish it: delivery resume ${runId}`,
    ];
  }

  const summary = await summariseOutcome(dir, caseFile);
  const finished = [
    opening,
    paint(ctx.colour, summary.tone, summary.headline),
    `${outcome.kind === "closed" ? "It finished" : "It stopped"} ${readableUtc(outcome.at)}.`,
  ];
  if (outcome.kind === "closed") return [...finished, ...summary.details];

  // Not summary.details: that is the live run's short form, which quotes the
  // evidence alone. Whoever reads this later gets the whole packet instead.
  const packet = outcome.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  return [
    ...finished,
    ...(packet ? packetLines(packet) : []),
    ...(outcome.kind === "aborted" ? summary.details : []),
    ...whereToLook(record, ctx),
  ];
}
