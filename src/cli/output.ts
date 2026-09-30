import { styleText } from "node:util";
import { logTail, resumeAction } from "../case-file.js";
import type { ResumeAction } from "../case-file.js";
import type { BreakerState, CaseFile, SurfaceState } from "../schema.js";

/**
 * Whether to print colour at all. Off when `--no-color` was passed, when
 * `NO_COLOR` is non-empty (no-color.org), or when output is not a terminal.
 */
export function useColour({ flag, env, isTTY }: { flag: boolean; env: NodeJS.ProcessEnv; isTTY: boolean | undefined }): boolean {
  return flag && !env.NO_COLOR && isTTY === true;
}

/** What a line means. Always also said in words: colour only decorates it. */
export type Tone = "done" | "attention" | "stopped" | "quiet";

const STYLE: Record<Tone, "green" | "yellow" | "red" | "dim"> = {
  done: "green",
  attention: "yellow",
  stopped: "red",
  quiet: "dim",
};

/**
 * `text` in its tone's colour, or unchanged when colour is off. The stream
 * check is ours (`useColour`), so styleText is told not to make its own.
 */
export function paint(colour: boolean, tone: Tone, text: string): string {
  return colour ? styleText(STYLE[tone], text, { validateStream: false }) : text;
}

/**
 * Every state as a person reads it. The state set is closed, so the table is
 * total: a new state does not compile until it has a phrase, and a raw state
 * name can never reach the terminal.
 */
export const STEP_PHRASES: Record<SurfaceState, string> = {
  PROVISIONING: "setting up",
  PRE_GATING: "checking the starting point",
  AGENT_ACTIVE: "the agent is working",
  // Not "so trying again": with the terminus budget spent, this routes to a person instead.
  INCOMPLETE_TERMINUS: "the agent stopped without finishing",
  GATING: "checking the agent's work",
  TRIAGE: "deciding what to do about a setback",
  GATE_MAINTENANCE: "the agent is fixing something",
  CLOSING: "wrapping up",
  CLOSED: "done",
  ESCALATED: "stopped: this needs a person",
  ABORTED: "stopped",
};

/**
 * The environment every task of a run shares, as a person reads it. The state
 * set is closed, so the table is total: a new state does not compile until it
 * has words. `status` says "Environment: <phrase>"; the live line when it
 * breaks is built from the DEGRADED phrase.
 */
export const BREAKER_PHRASES: Record<BreakerState, string> = {
  HEALTHY: "healthy",
  DEGRADED: "something in the shared environment looks broken",
  REPAIRING: "the shared environment is being repaired",
};

/**
 * Every way a run can be picked up, as a person reads it. `ResumeAction` is a
 * closed set, so the table is total: a new one does not compile until it has a
 * phrase. The wording matches `STEP_PHRASES` wherever the two describe the same
 * work, so "picking up where it left off" and the step lines that follow it
 * speak one language.
 */
export const RESUME_PHRASES: Record<ResumeAction, string> = {
  start: "getting the agent going",
  incomplete_terminus: "the agent stopped without finishing",
  gate: "checking the agent's work",
  triage: "deciding what to do about a setback",
  act_on_verdict: "acting on what it decided about the last setback",
  close: "wrapping up",
  close_triage: "deciding what to do about a delivery that didn't finish",
  done: "finishing off",
};

/** What a run will do first when it is picked up, in words, read from its log rather than its cursor, which a kill can leave behind. */
export function nextStepPhrase(caseFile: CaseFile): string {
  return RESUME_PHRASES[resumeAction(logTail(caseFile))];
}

/** What this run will do first now it has been picked up. */
export function pickingUp(caseFile: CaseFile): string {
  return `Picking up where it left off: ${nextStepPhrase(caseFile)}.`;
}

/**
 * Something a resumed run had to fix before it could go on. The harness's own
 * account is printed as it wrote it: it is free-form, so paraphrasing it here
 * would be a lookup table that silently stops matching.
 */
export function putRight(recovery: string): string {
  return `Had to put something right: ${recovery}.`;
}
