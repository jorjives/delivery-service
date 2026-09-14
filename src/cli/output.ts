import { styleText } from "node:util";
import type { SurfaceState } from "../schema.js";

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

export interface Progress {
  /** Say what the run is doing next. A step that reads the same as the last one is not repeated. */
  step(state: SurfaceState): void;
}

/** Plain, append-only progress lines: no cursor movement, spinners or box drawing, so logs and screen readers read it as printed. */
export function createProgress(writeLine: (line: string) => void, colour: boolean): Progress {
  let last: string | undefined;
  return {
    step(state) {
      const phrase = STEP_PHRASES[state];
      if (phrase === last) return;
      last = phrase;
      writeLine(paint(colour, "quiet", `- ${phrase}`));
    },
  };
}
