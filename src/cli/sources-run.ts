import { prepareContinuation } from "../continuation.js";
import { baseTip, closeDeliveryBranch, deliveryBranchOf, deliveryMerged, fetchBase, reconcileDeliveryBranch } from "../delivery-branch.js";
import { deliveryLedgerPath, readDelivery, type LandedEntry } from "../delivery-ledger.js";
import { ghReason } from "../gh.js";
import { branchExists, git } from "../git-exec.js";
import { awaitsMerge, DEFAULT_PARK_AFTER, ledgerPath, readItemLedger, recordDispatched, settleRun, type ItemState } from "../item-ledger.js";
import { heldPath, recordHeld } from "../held-sequences.js";
import { listPullRequests } from "../pull-requests.js";
import { readStack } from "../delivery-stack.js";
import { runIdFor } from "../run-location.js";
import type { CloseReport, DeliveredLevel } from "../ports.js";
import type { RunRecord } from "../run-records.js";
import type { CloserRef, Continues, TaskDef } from "../schema.js";
import { runShell } from "../shell.js";
import { clearParked, githubIssueOf, markParked } from "../github-source.js";
import { taskIntent, taskText } from "../task-list.js";
import { closeDeliveryStack, isStacked, reconcileStackBranch } from "../stack-branch.js";
import { chooseWork, type WorkItem } from "../work-sources.js";
import { afterLanding } from "./after-landing.js";
import { DEFAULT_SOURCES, sourceName, type DeliveryConfig, type SourceConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode } from "./failures.js";
import { hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { runQueue, type ClaimSource, type QueueClaim } from "./queue.js";
import { closingReport } from "./report-command.js";
import { allRuns, readRun } from "./runs.js";
import { checkCustomModules, maxItems, resolveProject, workflowFrom, type ProjectSettings, type RunFlags } from "./settings.js";
import { checkStackSetup } from "./stack-setup.js";

export const NOTHING_TO_WORK =
  "Nothing to work on: every item is done, parked, waiting behind an earlier item of its sequence, or not due yet. Add an item under .delivery/backlog/, or run `delivery status` to see what is parked or held.";

export const mirrorFailed = (issue: number, what: string, detail: string): string => `Could not ${what} on GitHub issue #${issue}: ${detail} The item's state in \`delivery status\` is unaffected.`;

export function parkedNote(state: ItemState): string {
  switch (state.parked) {
    case "decision":
      return `Parked ${state.key}: it needs your answer. The agent asked: ${state.question ?? "the question was not recorded"} Answer with: delivery answer ${state.key} "your answer"`;
    case "attempts":
      return `Parked ${state.key}: it ended without being delivered ${state.attempts} runs in a row. When it is ready to try again: delivery unpark ${state.key}`;
    case "held":
      return `Holding ${state.key}: its fix is finished and checked, and waits for your sign-off because the problem is serious. Read it, then: delivery sign-off ${state.key}, or set it aside: delivery reject ${state.key}`;
    default:
      return `Parked ${state.key}: it stopped for you. When you have dealt with it: delivery unpark ${state.key}`;
  }
}

export const blockedNote = (reason: string): string => `No task was started: ${reason}`;
export const deliveryClosedNote = (branch: string, report: CloseReport): string =>
  report.status === "DONE" ? `Handed ${branch} to your closer: ${report.detail}` : `${branch} was not handed off: ${report.detail} The next run tries again.`;

export const couldNotFetch = (base: string, reason: string): string =>
  `Could not fetch ${base} from origin (${reason}), so a pull request merged on GitHub since the last run may not be seen yet. This run carries on with what this machine already has.`;

export const couldNotAskStack = (reason: string): string =>
  `Could not ask GitHub for the stack's pull requests (${reason}); \`delivery status\` shows them after a later run can.`;

export const couldNotAskGitHub = (branch: string, reason: string): string =>
  `Could not ask GitHub whether ${branch}'s pull request has merged (${reason}), so a merge by squash or rebase may not be seen yet. This run carries on as if it had not.`;

export const unknownItemWorkflow = (key: string, name: string): string => `Left ${key} alone: it names the workflow "${name}", which your config file does not define.`;
const completeFailed = (key: string, detail: string): string => `${key} was delivered, but marking it done failed: ${detail}`;

/** The turn a carried-on run opens with, or undefined when the item starts afresh (spec §5.11). */
function turnFor(state: ItemState | undefined): Continues["turn"] | undefined {
  if (state?.lastClass === "held" && state.signedOff) return { kind: "signed_off" };
  if (state?.lastClass === "interrupted") return { kind: "interrupted" };
  if (state?.lastClass === "decision" && state.answer !== null) return { kind: "answer", question: state.question ?? "", answer: state.answer };
  return undefined;
}

export async function runSources(options: RunFlags, { repoPath, config }: { repoPath: string; config: DeliveryConfig }, ctx: CommandContext, { only }: { only?: string } = {}): Promise<ExitCode> {
  const max = maxItems(options);
  const project = await resolveProject(options, { env: ctx.env, repoPath, config });
  await checkCustomModules(project.gateRef, project.closerRef, repoPath);
  if (await hasUncommittedChanges(repoPath)) ctx.report.note(UNCOMMITTED_NOTE);
  const asksGitHub = project.closerRef.type === "open-pr";
  // With open-pr the owner merges on GitHub: fetch the base first, so the backlog and the delivery branch see it (spec §5.8).
  if (asksGitHub) {
    const failed = await fetchBase(repoPath);
    if (failed !== undefined) ctx.report.note(couldNotFetch(failed.base, failed.reason));
  }
  const path = ledgerPath(repoPath, ctx.env);
  const parkAfter = config.parkAfter ?? DEFAULT_PARK_AFTER;
  const sources = config.sources ?? DEFAULT_SOURCES;
  const finish = async (exitCode: ExitCode, list: TaskDef[] = []): Promise<ExitCode> => {
    await closingReport(repoPath, { kind: "list" }, list, ctx, config.notify);
    return exitCode;
  };

  // A run that ended after its last ledger write is settled now, from its record.
  let records = await allRuns(repoPath);
  for (const state of (await readItemLedger(path)).values()) {
    const record = records.find((r) => r.runId === state.lastRunId);
    if (!state.settled && record?.caseFile.outcome !== undefined) await settleRun(path, state.key, record, parkAfter);
  }
  const ledger = await readItemLedger(path);
  records = await allRuns(repoPath);

  // The one branch every task of this run lands on, named after the base before any task is claimed.
  const { base } = await baseTip(repoPath);
  const branch = deliveryBranchOf(base);
  const deliveryLedger = deliveryLedgerPath(path);
  // A stack the setup cannot take stops the run before anything is claimed or landed (spec §9).
  const stacked = isStacked(project.closerRef);
  if (stacked) {
    const blocked = await checkStackSetup(repoPath, deliveryLedger, branch);
    if (blocked !== undefined) {
      ctx.report.note(blockedNote(blocked));
      return finish(EXIT.escalated);
    }
  }
  // GitHub's state, not the shape of history, says a rolling pull request merged (design §9 decision 5). Empty for every
  // other closer, for a stack (which never merges its base in), and when there is no branch yet to have merged.
  let mergedTips: ReadonlySet<string> = new Set();
  if (asksGitHub && !stacked && (await branchExists(repoPath, branch))) {
    const listing = await listPullRequests(repoPath, { heads: [branch] }, { state: "merged" });
    if (listing.ok) mergedTips = new Set(listing.pullRequests.map((pr) => pr.headRefOid));
    else ctx.report.note(couldNotAskGitHub(branch, ghReason(listing.failure)));
  }
  const after = afterLanding({ repoPath, config, project, itemLedger: path, branch, base, records: () => allRuns(repoPath) }, ctx);
  // Steps an earlier run left pending are tried first, from the one that failed (spec §5.7); they never stop new work.
  let afterDone = await after.pending();
  const now = new Date();
  const taken = new Set(records.map((r) => r.runId));
  const claims: (QueueClaim & { key: string })[] = [];

  // Picked back up first: an item whose run was stopped part way (a crash, a kill) carries on in its own record.
  for (const state of ledger.values()) {
    if (claims.length >= max) break;
    if (only !== undefined && state.key !== only) continue;
    const record = records.find((r) => r.runId === state.lastRunId);
    if (state.settled || record === undefined || record.caseFile.outcome !== undefined) continue;
    claims.push({ key: state.key, taskDef: record.caseFile.header.taskDef, surfaceId: record.runId, position: { task: 0, of: 0 }, existing: record });
  }

  const chosen = await chooseWork(sources, { repoPath, config, env: ctx.env, ledger, records, now, max: max - claims.length, taken: new Set(claims.map((c) => c.key)), only });
  for (const note of chosen.notes) ctx.report.note(note);
  // Merged per source: this run only saw `chosen.read`, so holds in sources it never reached are kept, not wiped (spec §5.10, §10).
  await recordHeld(heldPath(path), chosen.held, chosen.read);
  for (const item of chosen.items) {
    const claim = await claimFor(item, ledger.get(item.key), records, { repoPath, config, project, now, taken, branch }, ctx);
    if (claim !== undefined) claims.push(claim);
  }
  // Readied before any task starts, so every task builds on the owner's latest commits (spec §5.7). Also readied when
  // nothing is to be worked but earlier landings still wait for the closer: the closer is retried "after bringing in
  // any base commits" (spec §5.7), since a moved base is the usual reason a merge-back failed. And, with open-pr, readied
  // when the delivery branch's pull request has merged, so it starts again from the base and stops listing what merged.
  // A run with none of these opens no branch. A stack is readied the same way, but as a stacked section, never merged into,
  // and every stacked run asks GitHub about its levels, so a merge is acted on even when there is nothing to claim.
  const waiting = (await readDelivery(deliveryLedger, branch)).pending.length > 0;
  const mergedOnGitHub = !stacked && asksGitHub && (await deliveryMerged(repoPath, mergedTips));
  const stackReconciled = stacked
    ? await reconcileStackBranch(repoPath, deliveryLedger, { gateRef: project.gateRef, itemLedger: path, env: ctx.env, opens: claims.length > 0 || waiting })
    : undefined;
  const reconciled = stackReconciled ?? (claims.length === 0 && !waiting && !mergedOnGitHub
    ? undefined
    : await reconcileDeliveryBranch(repoPath, project.gateRef, deliveryLedger, ctx.env, mergedTips));
  if (reconciled?.ready === false) {
    ctx.report.note(blockedNote(reconciled.reason));
    return finish(EXIT.escalated);
  }
  // A ready stack may have repaired the item ledger after a restack (see reconcileStackBranch), so a claim chosen before
  // that may now be for an item that awaits merge: such a claim is dropped, not run again.
  if (stackReconciled?.ready === true) {
    const items = await readItemLedger(path);
    for (const claim of [...claims]) if (await awaitsMerge(repoPath, items.get(claim.key))) claims.splice(claims.indexOf(claim), 1);
  }
  const reported = stackReconciled?.ready === true ? stackReconciled.reported : undefined;
  const landAndFinish = async (exitCode: ExitCode, list: TaskDef[] = []): Promise<ExitCode> => {
    const handed = await handOff({ repoPath, closerRef: project.closerRef, ledger: deliveryLedger, branch, base, sources, ...(reported === undefined ? {} : { reported }) }, exitCode, ctx);
    // Replaces, not combines with, the start-of-run answer: a step that failed then may since have been superseded.
    if (handed.closed !== undefined) afterDone = await after.landed(handed.closed);
    return finish(!afterDone && handed.exitCode === EXIT.ok ? EXIT.escalated : handed.exitCode, list);
  };
  if (claims.length === 0) {
    ctx.report.note(NOTHING_TO_WORK);
    return landAndFinish(EXIT.ok);
  }
  claims.forEach((claim, index) => (claim.position = { task: index + 1, of: claims.length }));

  const keyOf = (claim: QueueClaim): string => claims.find((c) => c.surfaceId === claim.surfaceId)?.key ?? "";
  const source: ClaimSource = {
    next: async (claimed) => claims.find((c) => !claimed.some((k) => k.surfaceId === c.surfaceId)),
    starting: (claim) => recordDispatched(path, keyOf(claim), claim.surfaceId, taskIntent(claim.taskDef)),
    ended: async (claim) => {
      const record = await readRun(repoPath, claim.surfaceId);
      const state = await settleRun(path, keyOf(claim), record, parkAfter);
      if (state.parked !== null) {
        ctx.report.note(parkedNote(state));
        const issue = githubIssueOf(keyOf(claim), sources);
        if (issue !== undefined) {
          const failed = await markParked(issue, parkedNote(state), { repoPath, env: ctx.env });
          if (failed !== undefined) ctx.report.note(mirrorFailed(issue, "show that it is parked", failed));
        }
      }
      if (state.lastClass === "delivered") await complete(keyOf(claim), record, sources, repoPath, ctx);
    },
  };
  const exitCode = await runQueue(claims.map((c) => c.taskDef), project, { repoPath, carryOn: true, claims: source }, ctx);
  return landAndFinish(exitCode, claims.map((c) => c.taskDef));
}

type HandedOff = { exitCode: ExitCode; closed?: { landed: LandedEntry[]; commit: string } };

/**
 * The project's closer, once per run, when tasks have landed on the delivery branch since it last took it, or a stack was
 * restacked since it last succeeded. A failed closer leaves the branch for the next run, and the run reports a stop.
 */
async function handOff(target: { repoPath: string; closerRef: CloserRef; ledger: string; branch: string; base: string; sources: readonly SourceConfig[]; reported?: ReadonlyMap<string, string> }, exitCode: ExitCode, ctx: CommandContext): Promise<HandedOff> {
  const { branch } = target;
  const { pending, landed, restacked } = await readDelivery(target.ledger, branch);
  if (pending.length === 0 && !restacked) return { exitCode };
  // Read before the closer acts: merge-back deletes the branch, and this is the commit every after step is about.
  const commit = await git(target.repoPath, ["rev-parse", `refs/heads/${branch}`]);
  const closed: { report: CloseReport; unobserved?: string } = isStacked(target.closerRef)
    ? await closeDeliveryStack(target, await stackLevels(target, target.reported))
    : { report: await closeDeliveryBranch(target, landed.map((e) => {
        const issue = githubIssueOf(e.key, target.sources);
        return { intent: e.intent, item: e.key, run: e.runId, at: e.at, ...(issue === undefined ? {} : { closes: `#${issue}` }) };
      })) };
  ctx.report.note(deliveryClosedNote(branch, closed.report));
  if (closed.unobserved !== undefined) ctx.report.note(couldNotAskStack(closed.unobserved));
  if (closed.report.status !== "DONE") return { exitCode: exitCode !== EXIT.ok ? exitCode : EXIT.escalated };
  return { exitCode, closed: { landed: pending, commit } };
}

/**
 * The levels of a stacked branch as its closer takes them: in landing order, each with the text of the task it carries
 * and the issue it closes. An item that landed nothing has no level, so it is not here. `reported` is the head GitHub
 * showed for each level at the start of the run; a level GitHub showed no pull request for has none.
 */
async function stackLevels(target: { repoPath: string; ledger: string; branch: string; sources: readonly SourceConfig[] }, reported: ReadonlyMap<string, string> = new Map()): Promise<DeliveredLevel[]> {
  const stack = await readStack(target.repoPath, target.ledger, target.branch);
  const records = await allRuns(target.repoPath);
  return stack.map((level) => {
    const record = records.find((r) => r.runId === level.run);
    const issue = githubIssueOf(level.item, target.sources);
    const head = reported.get(level.ref);
    return {
      intent: level.intent,
      item: level.item,
      run: level.run,
      at: level.at,
      text: record === undefined ? level.intent : taskText(record.caseFile.header.taskDef),
      ref: level.ref,
      commit: level.commit,
      parent: level.parent,
      ...(issue === undefined ? {} : { closes: `#${issue}` }),
      ...(head === undefined ? {} : { reported: head }),
      earlier: level.earlier,
    };
  });
}

/** The claim a chosen item becomes: carried on from its last run, or a fresh run, with its workflow and item pinned. */
async function claimFor(
  item: WorkItem,
  state: ItemState | undefined,
  records: RunRecord[],
  { repoPath, config, project, now, taken, branch }: { repoPath: string; config: DeliveryConfig; project: ProjectSettings; now: Date; taken: Set<string>; branch: string },
  ctx: CommandContext,
): Promise<(QueueClaim & { key: string }) | undefined> {
  // Only an undefined workflow is the item's own problem (left out with a note); any other refusal stops the command.
  if (item.workflow !== undefined && config.workflows?.[item.workflow] === undefined) {
    ctx.report.note(unknownItemWorkflow(item.key, item.workflow));
    return undefined;
  }
  // Worked again (answered or unparked): the issue stops saying it is parked.
  if (item.issue?.parked === true) {
    const failed = await clearParked(item.issue.number, { repoPath, env: ctx.env });
    if (failed !== undefined) ctx.report.note(mirrorFailed(item.issue.number, "take the parked label off", failed));
  }
  const workflow = await workflowFrom(item.workflow, config, repoPath);
  // A wrong custom step-gate path stops the command before a run is spent, as `--workflow` does.
  await checkCustomModules(project.gateRef, project.closerRef, repoPath, workflow);
  const turn = turnFor(state);
  const last = records.find((r) => r.runId === state?.lastRunId);
  // Commits the last run's leftover edits onto its branch before reading its tip; idempotent, so a claim made again adds nothing.
  const carried = turn !== undefined && last !== undefined ? await prepareContinuation(last, turn, ctx.env, state?.heldCommit) : undefined;
  const surfaceId = runIdFor(taskIntent(item.taskDef), now, taken);
  taken.add(surfaceId);
  // A tracker's text is writable by anyone, so `untrusted` follows `raise`: a github source's items, or a command source's with `tracker` set.
  const ref = {
    key: item.key, source: item.source, id: item.id,
    ...(item.resolve === undefined ? {} : { resolve: item.resolve }),
    ...(item.raise === true ? { raise: true as const, untrusted: true as const } : {}),
  };
  return {
    key: item.key,
    taskDef: item.taskDef,
    surfaceId,
    position: { task: 0, of: 0 },
    existing: undefined,
    start: {
      item: ref,
      delivery: { branch },
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
