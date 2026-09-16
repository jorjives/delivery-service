import type { SurfaceState } from "../schema.js";
import type { AdvanceResult } from "../surface.js";
import type { OutcomeSummary } from "./outcome.js";
import { paint, putRight, STEP_PHRASES } from "./output.js";

/**
 * One step of a run as a script reads it: the harness's own state name, whether
 * that was the last step, what the step had to put right if it recovered one,
 * and when it happened. This is the one place a raw state name is meant to be
 * seen, which is why the human stream translates every one of them.
 */
export interface StepRecord {
  state: SurfaceState;
  done: boolean;
  recovery?: string;
  at: string;
}

/**
 * How a run is told while it happens. Two renderings of the same three events,
 * chosen once per invocation: plain-language lines for a person, or one JSON
 * object per step for a script. The run loop reports through this and never
 * learns which it was given.
 */
export interface RunReporter {
  /** Something worth saying that is not a step: which run this is, a setting that was ignored, a question. Never part of the machine-readable stream. */
  note(line: string): void;
  /** One step of the run. `AdvanceResult` is the whole of what a step is, so a run that has only just begun reports its first state the same way. */
  step(step: AdvanceResult): void;
  /** What the run did in the end. */
  outcome(summary: OutcomeSummary): void;
}

/**
 * The run as a person reads it: one line per step, no cursor movement, spinners
 * or box drawing, so logs and screen readers read it as printed. A step that
 * reads the same as the last one is not repeated, but what it put right always
 * is: the sentence is the whole of why the step was worth mentioning.
 */
export function plainReporter(writeLine: (line: string) => void, colour: boolean): RunReporter {
  let last: string | undefined;
  return {
    note: writeLine,
    step(step) {
      const phrase = STEP_PHRASES[step.state];
      if (phrase !== last) {
        last = phrase;
        writeLine(paint(colour, "quiet", `- ${phrase}`));
      }
      if (step.recovery) writeLine(putRight(step.recovery));
    },
    outcome(summary) {
      writeLine(paint(colour, summary.tone, summary.headline));
      for (const line of summary.details) writeLine(line);
    },
  };
}

/**
 * The run as a script reads it: one JSON object per line on standard output,
 * and nothing else, so a reader can parse a line at a time while the run is
 * still going. Everything a person would want to be told goes to standard
 * error instead, where it is still read but never parsed, the closing sentence
 * included: the outcome needs no record of its own, because the last step
 * already said the run is over and the exit code says how it ended, but a
 * person reading the log still needs the words.
 */
export function jsonReporter(
  writeRecord: (line: string) => void,
  writeNote: (line: string) => void,
  now: () => Date = () => new Date(),
): RunReporter {
  return {
    note: writeNote,
    step(step) {
      const record: StepRecord = {
        state: step.state,
        done: step.done,
        ...(step.recovery === undefined ? {} : { recovery: step.recovery }),
        at: now().toISOString(),
      };
      writeRecord(JSON.stringify(record));
    },
    outcome(summary) {
      // On the note stream, never as a record: see the note above.
      writeNote(summary.headline);
      for (const line of summary.details) writeNote(line);
    },
  };
}
