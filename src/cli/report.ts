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

/** Which task of a run of several at once a line is about: its place in the list, the run it belongs to, and the task's own run id. */
export interface TaskTag {
  runId: string;
  ordinal: number;
  of: number;
  id: string;
}

/** What a run of several tasks at once says of itself: that it has started, or been picked up after a stop, and that every task it could take has ended. */
export type RunState = "STARTED" | "RESUMED" | "DRAINED";
export interface RunEvent {
  runId: string;
  state: RunState;
}

/** One task's step in a run of several at once, as a script reads it. Every key is present, `null` where it does not apply. */
export interface SurfaceStepRecord {
  scope: "surface";
  runId: string;
  surface: { ordinal: number; of: number; id: string };
  state: SurfaceState;
  done: boolean;
  recovery: string | null;
  at: string;
}

/** Something that happened to a run of several tasks as a whole, as a script reads it. */
export interface RunEventRecord {
  scope: "run";
  runId: string;
  state: RunState;
  done: boolean;
  at: string;
}

/** The text a task's lines start with: its place in the list, never colour alone, so `grep '\[2/10\]'` follows one task. */
const tagOf = (task: TaskTag): string => `[${task.ordinal}/${task.of}]`;

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
  /** The same rendering for one task of a run of several at once: every line it writes says which task it is about. */
  forTask(task: TaskTag): RunReporter;
  /** Something that happened to a run of several tasks as a whole. */
  run(event: RunEvent): void;
}

/**
 * The run as a person reads it: one line per step, no cursor movement, spinners
 * or box drawing, so logs and screen readers read it as printed. A step that
 * reads the same as the last one is not repeated, but what it put right always
 * is: the sentence is the whole of why the step was worth mentioning.
 * A task of a run of several at once has every line started with its place in the list.
 */
export function plainReporter(writeLine: (line: string) => void, colour: boolean, task?: TaskTag): RunReporter {
  const say = task === undefined ? writeLine : (line: string) => writeLine(`${tagOf(task)} ${line}`);
  let last: string | undefined;
  return {
    note: say,
    step(step) {
      const phrase = STEP_PHRASES[step.state];
      if (phrase !== last) {
        last = phrase;
        say(paint(colour, "quiet", `- ${phrase}`));
      }
      if (step.recovery) say(putRight(step.recovery));
    },
    outcome(summary) {
      say(paint(colour, summary.tone, summary.headline));
      for (const line of summary.details) say(line);
    },
    // Each task gets its own reporter, so its run of steps is its own and two tasks at the same step both say so.
    forTask: (other) => plainReporter(writeLine, colour, other),
    // A person reads the run's shape in the line that opens it and the sentence that ends it, both notes.
    run: () => undefined,
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
 * A task of a run of several at once writes a `scope: "surface"` record naming its place and id, and the run writes `scope: "run"` records; an untagged step keeps the shape it always had.
 */
export function jsonReporter(
  writeRecord: (line: string) => void,
  writeNote: (line: string) => void,
  now: () => Date = () => new Date(),
  task?: TaskTag,
): RunReporter {
  const say = task === undefined ? writeNote : (line: string) => writeNote(`${tagOf(task)} ${line}`);
  const write = (record: StepRecord | SurfaceStepRecord | RunEventRecord): void => writeRecord(JSON.stringify(record));
  return {
    note: say,
    step(step) {
      const at = now().toISOString();
      if (task === undefined) {
        write({ state: step.state, done: step.done, ...(step.recovery === undefined ? {} : { recovery: step.recovery }), at });
        return;
      }
      write({
        scope: "surface",
        runId: task.runId,
        surface: { ordinal: task.ordinal, of: task.of, id: task.id },
        state: step.state,
        done: step.done,
        recovery: step.recovery ?? null,
        at,
      });
    },
    outcome(summary) {
      // On the note stream, never as a record: see the note above.
      say(summary.headline);
      for (const line of summary.details) say(line);
    },
    forTask: (other) => jsonReporter(writeRecord, writeNote, now, other),
    run(event) {
      write({ scope: "run", runId: event.runId, state: event.state, done: event.state === "DRAINED", at: now().toISOString() });
    },
  };
}
