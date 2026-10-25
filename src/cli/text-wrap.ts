import { showHidden } from "../packs/hidden-characters.js";

/** The widest line the account writes, in columns. Pack-authored instructions are the one exception: they are shown as written. */
export const INSPECT_WIDTH = 60;

/** Pack-authored words on one line: every hidden character, a line break included, written out as visible text. */
const oneLine = (text: string): string => showHidden(text, { newline: false, tab: false });

/** Greedy word wrap on single spaces, after pack-authored text is made visible. A word too long for the width sits alone on its line, unbroken. */
export function wrap(text: string, indent: string, hanging: string = indent): string[] {
  const lines: string[] = [];
  let line = indent;
  let started = false;
  for (const word of oneLine(text).split(" ")) {
    if (!started) {
      line += word;
      started = true;
    } else if (line.length + 1 + word.length <= INSPECT_WIDTH) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = hanging + word;
    }
  }
  lines.push(line);
  return lines;
}
