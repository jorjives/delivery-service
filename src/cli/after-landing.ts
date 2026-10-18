import type { SessionEnvironment } from "../agent-invoke.js";
import { runAgentPass } from "../after-agent.js";
import { afterLedgerPath, isBuiltIn, isPending, readAfter, recordAfter, waiting, RAISE, type BatchEntry, type BatchState, type FollowUp, type PlannedStep } from "../after-ledger.js";
import { runBatch, stillPending, supersedeOlder, type AfterDeps } from "../after-steps.js";
import { deliveryLedgerPath, type LandedEntry } from "../delivery-ledger.js";
import { githubIssueOf, closeIssue } from "../github-source.js";
import { heldFollowUps, landFollowUps } from "../follow-ups.js";
import type { RunRecord } from "../run-records.js";
import { runIdFor } from "../run-location.js";
import type { CloserRef, FenceRecord } from "../schema.js";
import { raiseThrough } from "../work-sources.js";
import { agentSession } from "./agent-session.js";
import { DEFAULT_SOURCES, sourceName, stepLabel, type AfterStep, type DeliveryConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { fenceAtStart } from "./drive.js";
import type { ProjectSettings } from "./settings.js";

/** The after steps a landed task asks for: its workflow's own, when the workflow has an `after`, else the project's (spec §5.7). */
export function afterFor(record: RunRecord, config: DeliveryConfig): { key: string; steps: AfterStep[] } {
  const name = record.caseFile.header.workflow?.name;
  const own = name === undefined ? undefined : config.workflows?.[name]?.after;
  return own === undefined || name === undefined ? { key: "project", steps: config.after ?? [] } : { key: name, steps: own };
}

/**
 * A step still to run, as the config defines it now: the one at the same place in the same list (the project's, or the
 * workflow's the key names). Undefined when the list no longer has that place. The built-in raise has no config.
 * ponytail: matched by position; an operator who reorders a list with a batch pending sees the step now at that place.
 */
export function currentStep(config: DeliveryConfig, steps: readonly PlannedStep[], index: number): PlannedStep["step"] | undefined {
  const planned = steps[index] as PlannedStep;
  if (isBuiltIn(planned.step)) return planned.step;
  const position = steps.slice(0, index).filter((step) => step.for === planned.for).length;
  return (planned.for === "project" ? config.after : config.workflows?.[planned.for]?.after)?.[position];
}

/**
 * The batch a closer's hand-off starts: only tasks that landed count (a landing with no run record is an after pass's
 * follow-ups), the built-in raise first when they held follow-ups, then each distinct `after` list among them once,
 * in the order they landed. Undefined when there is nothing to do.
 */
export async function newBatch(
  { landed, records, config, branch, base, commit, now, closer }: { landed: readonly LandedEntry[]; records: readonly RunRecord[]; config: DeliveryConfig; branch: string; base: string; commit: string; now: Date; closer: CloserRef },
): Promise<Omit<BatchEntry, "at"> | undefined> {
  const tasks = landed.flatMap((entry) => {
    const record = records.find((r) => r.runId === entry.runId);
    return record === undefined ? [] : [{ entry, record }];
  });
  if (tasks.length === 0) return undefined;
  const sources = config.sources ?? DEFAULT_SOURCES;
  // With open-pr, the pull request's Closes lines close the issues when it merges; every other closer closes them here.
  const issues = closer.type === "open-pr" ? [] : tasks.flatMap(({ entry }) => {
    const number = githubIssueOf(entry.key, sources);
    return number === undefined ? [] : [{ item: entry.key, number }];
  });
  const followUps: FollowUp[] = [];
  for (const { record } of tasks) {
    const item = record.caseFile.header.item;
    if (item?.raise === true) followUps.push(...(await heldFollowUps(record.dir)).map((held) => ({ ...held, run: record.runId, source: item.source })));
  }
  const groups: { key: string; steps: AfterStep[]; raiseVia?: string }[] = [];
  for (const { record } of tasks) {
    const { key, steps } = afterFor(record, config);
    if (groups.some((g) => g.key === key)) continue;
    const item = record.caseFile.header.item;
    groups.push({ key, steps, ...(item?.raise === true ? { raiseVia: item.source } : {}) });
  }
  const steps: PlannedStep[] = [
    ...(followUps.length === 0 ? [] : [{ for: "follow-ups", label: "Raise follow-ups", step: RAISE }]),
    ...(issues.length === 0 ? [] : [{ for: "issues", label: "Close delivered issues", step: { closeIssues: issues, where: closer.type === "merge-back" ? base : branch } }]),
    ...groups.flatMap((g) => g.steps.map((step) => ({ for: g.key, label: stepLabel(step), step, ...(g.raiseVia === undefined ? {} : { raiseVia: g.raiseVia }) }))),
  ];
  if (steps.length === 0) return undefined;
  return {
    t: "batch", batch: runIdFor("after landing", now), branch, base, commit,
    landed: tasks.map(({ entry }) => ({ run: entry.runId, item: entry.key, intent: entry.intent })), followUps, steps,
  };
}

export interface AfterLanding {
  /** Retry every batch an earlier run left pending, oldest first, each step as the config now defines it. True when none is left pending. */
  pending(): Promise<boolean>;
  /**
   * Begin and run the batch for what the closer just took, superseding older steps from the same lists. True when no
   * batch at all is left pending afterwards: a step `pending()` failed on earlier in this run may since have been
   * superseded, so the answer is read back from the ledger, not combined with `pending()`'s.
   */
  landed(closed: { landed: readonly LandedEntry[]; commit: string }): Promise<boolean>;
}

/** The after phase of one `delivery run --sources`, its agent session and fence started only if an agent pass needs them. */
export function afterLanding(
  { repoPath, config, project, itemLedger, branch, base, records }: { repoPath: string; config: DeliveryConfig; project: ProjectSettings; itemLedger: string; branch: string; base: string; records: () => Promise<RunRecord[]> },
  ctx: CommandContext,
): AfterLanding {
  const ledger = afterLedgerPath(itemLedger);
  let session: Promise<SessionEnvironment> | undefined;
  let fence: Promise<FenceRecord> | undefined;
  const sources = config.sources ?? DEFAULT_SOURCES;
  const deps: AfterDeps = {
    repoPath, env: ctx.env, ledger,
    resolve: (_planned, index, state: BatchState) => currentStep(config, state.batch.steps, index),
    raise: async (name, item) => {
      const source = sources.find((s) => sourceName(s) === name);
      return source === undefined ? { error: `your config file no longer has a source called ${name}` } : raiseThrough(source, item, { repoPath, env: ctx.env });
    },
    agentPass: async (prompt, at) =>
      runAgentPass(prompt, at, {
        repoPath, env: ctx.env,
        session: await (session ??= agentSession(ctx.env)),
        fence: await (fence ??= fenceAtStart(project.fence, repoPath, ctx)),
        ...(project.agent === undefined ? {} : { agent: project.agent }),
        ...(project.domainPrompt === undefined ? {} : { domain: project.domainPrompt }),
      }),
    closeIssue: (number, comment) => closeIssue(number, comment, { repoPath, env: ctx.env }),
    landFollowUps: (items, { state, index }) =>
      landFollowUps({ repoPath, ledger: deliveryLedgerPath(itemLedger), branch: state.batch.branch, base: state.batch.base, runId: `${state.batch.batch}-${index}` }, items),
    note: (line) => ctx.report.note(line),
  };
  const noteStillPending = async (): Promise<void> =>
    ctx.report.note(stillPending((await readAfter(ledger)).filter(isPending).reduce((n, s) => n + waiting(s), 0)));
  const runPending = async (): Promise<boolean> => {
    const left = (await readAfter(ledger)).filter(isPending);
    let done = true;
    for (const state of left) done = (await runBatch(state, deps)) && done;
    if (!done) await noteStillPending();
    return done;
  };
  return {
    pending: runPending,
    landed: async ({ landed, commit }) => {
      const nonePending = async (): Promise<boolean> => !(await readAfter(ledger)).some(isPending);
      const batch = await newBatch({ landed, records: await records(), config, branch, base, commit, now: new Date(), closer: project.closerRef });
      if (batch === undefined) return nonePending();
      const older = await readAfter(ledger);
      await recordAfter(ledger, batch);
      // This batch runs these lists on the latest commit: an older batch's step from the same list must never run again from its own, older, commit.
      const superseded = await supersedeOlder(ledger, older, batch);
      if (superseded > 0) ctx.report.note(`Skipped ${superseded === 1 ? "one waiting after-landing step" : `${superseded} waiting after-landing steps`} from an earlier run: this run's landing runs the same steps on a later commit.`);
      const state = (await readAfter(ledger)).find((s) => s.batch.batch === batch.batch);
      if (state !== undefined && !(await runBatch(state, deps))) await noteStillPending();
      return nonePending();
    },
  };
}
