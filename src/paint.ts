import { styleText } from "node:util";

/** What a line means. Always also said in words: colour only decorates it. */
export type Tone = "done" | "attention" | "stopped" | "quiet";

const STYLE: Record<Tone, "green" | "yellow" | "red" | "dim"> = {
  done: "green",
  attention: "yellow",
  stopped: "red",
  quiet: "dim",
};

/**
 * `text` in its tone's colour, or unchanged when colour is off. Whether to
 * colour at all is the caller's decision (the command line's `useColour`), so
 * styleText is told not to make its own.
 */
export function paint(colour: boolean, tone: Tone, text: string): string {
  return colour ? styleText(STYLE[tone], text, { validateStream: false }) : text;
}
