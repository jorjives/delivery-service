/** Control, format (direction, zero-width, byte-order mark), line-separator and paragraph-separator characters: the ones that do not show as themselves on a terminal. */
const HIDDEN = "[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]";
const HIDDEN_ANY = new RegExp(HIDDEN, "u");
const HIDDEN_ALL = new RegExp(HIDDEN, "gu");

/** True when the text holds any hidden character, a line break and a tab included. */
export const hasHidden = (text: string): boolean => HIDDEN_ANY.test(text);

const SHOWN: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/**
 * A file name or path with every hidden character written as `<U+202E>`, so the name reads as the name the
 * file has. Pack text uses `showHidden`, which writes `‮`; a name is shown in the form a reader types.
 */
export function showName(text: string): string {
  return text.replace(HIDDEN_ALL, (char) => `<U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}>`);
}

/**
 * The text with every hidden character written out as visible text (`\x1b`, `‮`), so it can be read
 * and cannot drive the terminal. A newline, and a tab, stay as they are when `keep` says so.
 */
export function showHidden(text: string, keep: { newline: boolean; tab: boolean }): string {
  return text.replace(HIDDEN_ALL, (char) => {
    if ((char === "\n" && keep.newline) || (char === "\t" && keep.tab)) return char;
    const shown = SHOWN[char];
    if (shown !== undefined) return shown;
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) return `\\x${code.toString(16).padStart(2, "0")}`;
    return code <= 0xffff ? `\\u${code.toString(16).padStart(4, "0")}` : `\\u{${code.toString(16)}}`;
  });
}

/** One hidden character found in a text: how it reads when shown, and where (1-based line and column, counted in characters). */
export interface HiddenAt {
  shown: string;
  line: number;
  column: number;
}

/**
 * Every hidden character in the text with its place. A newline and a tab are left out when `keep` says
 * they are part of the text's layout, as in instructions; they are counted everywhere else.
 */
export function hiddenAt(text: string, keep: { newline: boolean; tab: boolean }): HiddenAt[] {
  const found: HiddenAt[] = [];
  let line = 1;
  let column = 0;
  for (const char of text) {
    column += 1;
    if (char === "\n" && keep.newline) {
      line += 1;
      column = 0;
    } else if (HIDDEN_ANY.test(char) && !(char === "\t" && keep.tab)) {
      found.push({ shown: showHidden(char, { newline: false, tab: false }), line, column });
    }
  }
  return found;
}
