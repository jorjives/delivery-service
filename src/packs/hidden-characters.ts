/** Control, format (direction, zero-width, byte-order mark), line-separator and paragraph-separator characters: the ones that do not show as themselves on a terminal. */
const HIDDEN = "[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]";
const HIDDEN_ANY = new RegExp(HIDDEN, "u");
const HIDDEN_ALL = new RegExp(HIDDEN, "gu");

/** True when the text holds any hidden character, a line break and a tab included. */
export const hasHidden = (text: string): boolean => HIDDEN_ANY.test(text);

const SHOWN: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

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
