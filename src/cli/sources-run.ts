import { prepareContinuation } from "../continuation.js";
import { DEFAULT_PARK_AFTER, ledgerPath, readItemLedger, recordDispatched, settleRun, type ItemState } from "../item-ledger.js";
import { runIdFor } from "../run-location.js";
import type { RunRecord } from "../run-records.js";
import type { Continues } from "../schema.js";
import { runShell } from "../shell.js";
import { taskIntent } from "../task-list.js";
import { chooseWork, type WorkItem } from "../work-sources.js";
import { DEFAULT_SOURCES, sourceName, type DeliveryConfig, type SourceConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import { hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { runQueue, type ClaimSource, type QueueClaim } from "./queue.js";
import { closingReport } from "./report-command.js";
import { allRuns, readRun } from "./runs.js";
import { checkCustomModules, maxItems, resolveProject, workflowFrom, type ProjectSettings, type RunFlags } from "./settings.js";

export const NOTHING_TO_WORK =
  "Nothing to work on: every item is done, parked or not due yet. Add an item under .delivery/backlog/, or run `delivery status` to see what is parked.";

export function parkedNote(state: ItemState): string {
  switch (state.parked) {
    case "decision":
      return `Parked ${state.key}: it needs your answer. The agent asked: ${state.question ?? "the question was not recorded"} Answer with: delivery answer ${state.key} "your answer"`;
    case "attempts":
      return `Parked ${state.key}: it ended without being delivered ${state.attempts} runs in a row. When it is ready to try again: delivery unpark ${state.key}`;
    default:
      return `Parked ${state.key}: it stopped for you. When you have dealt with it: delivery unpark ${state.key}`;
  }
}

export const unknownItemWorkflow = (key: string, name: string): string => `Left ${key} alone: it names the workflow "${name}", which your config file does not define.`;
const completeFailed = (key: string, detail: string): string => `${key} was delivered, but marking it done failed: ${detail}`;

/** The turn a carried-on run opens with, or undefined when the item starts afresh (spec §5.11). */
function turnFor(state: ItemState | undefined): Continues["turn"] | undefined {
  if (state?.lastClass === "interrupted") return { kind: "interrupted" };
  if (state?.lastClass === "decision" && state.answer !== null) return { kind: "answer", question: state.question ?? "", answer: state.answer };
  return undefined;
}

export async function runSources(options: RunFlags, { repoPath, config }: { repoPath: string; config: DeliveryConfig }, ctx: CommandContext): Promise<ExitCode> {
  const max = maxItems(options);
  const project = await resolveProject(options, { env: ctx.env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
  const path = ledgerPath(repoPath, ctx.env);
  const parkAfter = config.parkAfter ?? DEFAULT_PARK_AFTER;
  const sources = config.sources ?? DEFAULT_SOURCES;

  // A run that ended after its last ledger write is settled now, from its record.
  let records = await allRuns(repoPath);
  for (const state of (await readItemLedger(path)).values()) {
    const record = records.find((r) => r.runId === state.lastRunId);
    if (!state.settled && record?.caseFile.outcome !== undefined) await settleRun(path, state.key, record, parkAfter);
  }
  const ledger = await readItemLedger(path);
  records = await allRuns(repoPath);

  const now = new Date();
  const taken = new Set(records.map((r) => r.runId));
  const claims: (QueueClaim & { key: string })[] = [];

  // Picked back up first: an item whose run was stopped part way (a crash, a kill) carries on in its own record.
  for (const state of ledger.values()) {
    if (claims.length >= max) break;
    const record = records.find((r) => r.runId === state.lastRunId);
    if (state.settled || record === undefined || record.caseFile.outcome !== undefined) continue;
    claims.push({ key: state.key, taskDef: record.caseFile.header.taskDef, surfaceId: record.runId, position: { task: 0, of: 0 }, existing: record });
  }

  const chosen = await chooseWork(sources, { repoPath, config, env: ctx.env, ledger, records, now, max: max - claims.length, taken: new Set(claims.map((c) => c.key)) });
  for (const note of chosen.notes) ctx.report.note(note);
  for (const item of chosen.items) {
    const claim = await claimFor(item, ledger.get(item.key), records, { repoPath, config, project, now, taken }, ctx);
    if (claim !== undefined) claims.push(claim);
  }
  if (claims.length === 0) {
    ctx.report.note(NOTHING_TO_WORK);
    return EXIT.ok;
  }
  claims.forEach((claim, index) => (claim.position = { task: index + 1, of: claims.length }));

  const keyOf = (claim: QueueClaim): string => claims.find((c) => c.surfaceId === claim.surfaceId)?.key ?? "";
  const source: ClaimSource = {
    next: async (claimed) => claims.find((c) => !claimed.some((k) => k.surfaceId === c.surfaceId)),
    starting: (claim) => recordDispatched(path, keyOf(claim), claim.surfaceId, taskIntent(claim.taskDef)),
    ended: async (claim) => {
      const record = await readRun(repoPath, claim.surfaceId);
      const state = await settleRun(path, keyOf(claim), record, parkAfter);
      if (state.parked !== null) ctx.report.note(parkedNote(state));
      if (state.lastClass === "delivered") await complete(keyOf(claim), record, sources, repoPath, ctx);
    },
  };
  const exitCode = await runQueue(claims.map((c) => c.taskDef), project, { repoPath, carryOn: true, claims: source }, ctx);
  await closingReport(repoPath, { kind: "list" }, claims.map((c) => c.taskDef), ctx);
  return exitCode;
}

/** The claim a chosen item becomes: carried on from its last run, or a fresh run, with its workflow and item pinned. */
async function claimFor(
  item: WorkItem,
  state: ItemState | undefined,
  records: RunRecord[],
  { repoPath, config, project, now, taken }: { repoPath: string; config: DeliveryConfig; project: ProjectSettings; now: Date; taken: Set<string> },
  ctx: CommandContext,
): Promise<(QueueClaim & { key: string }) | undefined> {
  // Only an undefined workflow is the item's own problem (left out with a note); any other refusal stops the command.
  if (item.workflow !== undefined && config.workflows?.[item.workflow] === undefined) {
    ctx.report.note(unknownItemWorkflow(item.key, item.workflow));
    return undefined;
  }
  const workflow = await workflowFrom(item.workflow, config, repoPath);
  // A wrong custom step-gate path stops the command before a run is spent, as `--workflow` does.
  await checkCustomModules(project.gateRef, project.closerRef, repoPath, workflow);
  const turn = turnFor(state);
  const last = records.find((r) => r.runId === state?.lastRunId);
  // Commits the last run's leftover edits onto its branch before reading its tip; idempotent, so a claim made again adds nothing.
  const carried = turn !== undefined && last !== undefined ? await prepareContinuation(last, turn, ctx.env) : undefined;
  const surfaceId = runIdFor(taskIntent(item.taskDef), now, taken);
  taken.add(surfaceId);
  const ref = { key: item.key, source: item.source, id: item.id, ...(item.resolve === undefined ? {} : { resolve: item.resolve }) };
  return {
    key: item.key,
    taskDef: item.taskDef,
    surfaceId,
    position: { task: 0, of: 0 },
    existing: undefined,
    start: {
      item: ref,
      ...(carried === undefined ? (workflow === undefined ? {} : { workflow }) : { continues: carried.continues, ...(carried.workflow === undefined ? {} : { workflow: carried.workflow }) }),
    },
  };
}

/** A delivered item from a `command` source is marked done by its own script; the delivery stands whatever it says. */
async function complete(key: string, record: RunRecord, sources: readonly SourceConfig[], repoPath: string, ctx: CommandContext): Promise<void> {
  const item = record.caseFile.header.item;
  const source = sources.find((s) => sourceName(s) === item?.source);
  if (item === undefined || source?.type !== "command" || source.fallback === true) return;
  try {
    const result = await runShell(source.command, ["complete", item.id], { cwd: repoPath, timeoutMs: 60_000, env: ctx.env });
    if (result.exitCode !== 0) ctx.report.note(completeFailed(key, result.stderr.trim() || `it exited with code ${result.exitCode}`));
  } catch (err) {
    ctx.report.note(completeFailed(key, (err as Error).message));
  }
}
