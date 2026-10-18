import { isCommandStep } from "./cli/config.js";
import { finished, recordAfter, type BatchEntry, type BatchState, type PlannedStep } from "./after-ledger.js";
import { inDetachedWorktree } from "./disposable-copy.js";
import type { HeldItem } from "./follow-ups.js";
import { runShell } from "./shell.js";
import type { Raised } from "./work-sources.js";

export type AgentPassResult = { ok: true; items: HeldItem[]; discarded: string[] } | { ok: false; detail: string };

export interface AfterDeps {
  repoPath: string;
  env: NodeJS.ProcessEnv;
  ledger: string;
  raise: (source: string, item: HeldItem) => Promise<Raised>;
  resolve: (planned: PlannedStep, index: number, state: BatchState) => PlannedStep["step"] | undefined;
  agentPass: (prompt: string, at: { state: BatchState; index: number }) => Promise<AgentPassResult>;
  landFollowUps: (items: HeldItem[], at: { state: BatchState; index: number }) => Promise<void>;
  note: (line: string) => void;
}

/** ponytail: one fixed limit for a deploy or a check; make it a per-step setting when a real deploy needs longer. */
export const AFTER_STEP_TIMEOUT_MS = 30 * 60_000;

export const stepDone = (label: string): string => `After landing, ${label}: done.`;
export const stepFailed = (label: string, detail: string): string => `After landing, ${label} did not work: ${detail} It and the steps after it wait for the next run, which tries them first (as your config then defines them); \`delivery drop-after\` gives them up.`;
export const stepSkipped = (label: string, why: string): string => `After landing, ${label} was skipped: ${why}.`;
export const stillPending = (count: number): string =>
  `${count === 1 ? "One after-landing step is" : `${count} after-landing steps are`} still waiting; the next \`delivery run --sources\` tries again from the one that failed, and \`delivery drop-after\` gives up the ones you do not want.`;

/** A shell command, as an after step or its check: undefined when it worked, otherwise why not. */
async function shell(command: string, cwd: string, state: BatchState, deps: AfterDeps): Promise<string | undefined> {
  const env = { ...deps.env, DELIVERY_COMMIT: state.batch.commit, DELIVERY_BRANCH: state.batch.branch };
  try {
    const result = await runShell(command, [], { cwd, timeoutMs: AFTER_STEP_TIMEOUT_MS, env });
    return result.exitCode === 0 ? undefined : `\`${command}\` exited with code ${result.exitCode}${result.stderr.trim() === "" ? "." : `: ${result.stderr.trim()}`}`;
  } catch (err) {
    return `\`${command}\` could not be run: ${(err as Error).message}`;
  }
}

/** Raise each item not yet raised in this batch, recording each id as it comes, so a retry raises only the rest. */
async function raiseEach(items: readonly (HeldItem & { source: string })[], state: BatchState, deps: AfterDeps): Promise<string | undefined> {
  for (const item of items) {
    if (state.raised.has(item.file)) continue;
    const raised = await deps.raise(item.source, item);
    if ("error" in raised) return `raising ${item.file} in ${item.source} failed: ${raised.error}`;
    await recordAfter(deps.ledger, { t: "raised", batch: state.batch.batch, file: item.file, id: raised.id });
    state.raised.set(item.file, raised.id);
  }
  return undefined;
}

/** One step's own work, without its check: undefined when it worked, otherwise why not. `step` is the step as the config defines it now. */
async function work(planned: PlannedStep, step: PlannedStep["step"], index: number, state: BatchState, deps: AfterDeps): Promise<string | undefined> {
  if ("raise" in step) return raiseEach(state.batch.followUps, state, deps);
  if (isCommandStep(step)) {
    return step.in === "base"
      ? shell(step.run, deps.repoPath, state, deps)
      : inDetachedWorktree(deps.repoPath, state.batch.commit, (copy) => shell(step.run, copy, state, deps));
  }
  // An agent pass is not repeated once it has left something: a retry only finishes handling what it left.
  let held = state.held.get(index);
  if (held === undefined) {
    const result = await deps.agentPass(step.prompt, { state, index });
    if (!result.ok) return result.detail;
    held = { items: result.items, discarded: result.discarded };
    await recordAfter(deps.ledger, { t: "held", batch: state.batch.batch, index, ...held });
    state.held.set(index, held);
    if (held.discarded.length > 0) deps.note(`After landing, ${planned.label} changed ${held.discarded.join(", ")}; those changes were discarded, as an after step can only add backlog items.`);
  }
  if (held.items.length === 0) return undefined;
  if (planned.raiseVia !== undefined) return raiseEach(held.items.map((item) => ({ ...item, source: planned.raiseVia as string })), state, deps);
  await deps.landFollowUps(held.items, { state, index });
  return undefined;
}

/**
 * Run a batch from its first unfinished step, in order, each confirmed by its `check` when it has one, stopping at the
 * first that does not work (spec §5.7). Each step is run as the config defines it now, so a corrected step repairs a stuck
 * batch; a step the config no longer has is skipped. Every outcome is recorded before the next step starts. True when every
 * step is done or skipped.
 */
export async function runBatch(state: BatchState, deps: AfterDeps): Promise<boolean> {
  const { batch } = state;
  for (let index = state.next; index < batch.steps.length; index += 1) {
    if (finished(state.steps[index]?.status)) continue; // superseded or dropped ahead of a step that is still to run
    const planned = batch.steps[index] as PlannedStep;
    const step = deps.resolve(planned, index, state);
    if (step === undefined) {
      const why = "it is no longer in your config file";
      await recordAfter(deps.ledger, { t: "step", batch: batch.batch, index, status: "skipped", detail: why });
      deps.note(stepSkipped(planned.label, why));
      continue;
    }
    const check = "check" in step ? step.check : undefined;
    const failed = (await work(planned, step, index, state, deps)) ?? (check === undefined ? undefined : await shell(check, deps.repoPath, state, deps).then((why) => (why === undefined ? undefined : `its check ${why}`)));
    if (failed !== undefined) {
      await recordAfter(deps.ledger, { t: "step", batch: batch.batch, index, status: "failed", detail: failed });
      deps.note(stepFailed(planned.label, failed));
      return false;
    }
    await recordAfter(deps.ledger, { t: "step", batch: batch.batch, index, status: "done", detail: "" });
    deps.note(stepDone(planned.label));
  }
  return true;
}

/**
 * A batch that has just begun supersedes the unfinished command and agent steps of older batches that came from the same
 * `after` list (the project's, or the same workflow's): it runs that list on a later commit, which holds everything the
 * older one did, and running the older step from its own commit would put older work back over newer. Kept: the built-in
 * raise (each held follow-up still has to be raised) and an agent step that has already left items to raise or land. Steps
 * from a list the new batch does not contain stay pending. Returns how many steps it skipped.
 */
export async function supersedeOlder(ledger: string, older: readonly BatchState[], newer: Pick<BatchEntry, "batch" | "steps">): Promise<number> {
  const lists = new Set(newer.steps.filter((planned) => !("raise" in planned.step)).map((planned) => planned.for));
  let skipped = 0;
  for (const state of older) {
    if (state.batch.batch === newer.batch) continue;
    for (const [index, planned] of state.batch.steps.entries()) {
      if (finished(state.steps[index]?.status) || "raise" in planned.step || !lists.has(planned.for) || state.held.has(index)) continue;
      await recordAfter(ledger, { t: "step", batch: state.batch.batch, index, status: "skipped", detail: `superseded by ${newer.batch}, which runs the same steps on a later commit` });
      skipped += 1;
    }
  }
  return skipped;
}

/** The operator's way out of a stuck step (`delivery drop-after`): skip every unfinished step of one batch, or of all. */
export async function dropPending(ledger: string, states: readonly BatchState[], only?: string): Promise<{ batch: string; label: string; raise: boolean }[]> {
  const dropped: { batch: string; label: string; raise: boolean }[] = [];
  for (const state of states) {
    if (only !== undefined && state.batch.batch !== only) continue;
    for (const [index, planned] of state.batch.steps.entries()) {
      if (finished(state.steps[index]?.status)) continue;
      await recordAfter(ledger, { t: "step", batch: state.batch.batch, index, status: "skipped", detail: "dropped with `delivery drop-after`" });
      dropped.push({ batch: state.batch.batch, label: planned.label, raise: "raise" in planned.step });
    }
  }
  return dropped;
}
