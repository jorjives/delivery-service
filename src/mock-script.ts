import { readFile, writeFile } from "node:fs/promises";

/*
 * Typed views over claude-mock's own script and journal formats
 * (vendor/claude-mock/src/mock.ts and src/cli.ts). Plain types, not schemas:
 * claude-mock validates its own script, and a second validator here would only
 * drift from it. They change when the vendored copy does, and
 * src/mock-script.test.ts checks the script types against it.
 */

/** One scripted turn: consumed by the first prompt it matches within a session. */
export interface MockExpectation {
  /** Omit to match any prompt. When both are given, both must hold. */
  when?: { promptContains?: string; promptMatches?: string };
  /** Applied for real inside the session's working directory, before the reply. */
  effects?: Array<{ write: { path: string; content: string } } | { edit: { path: string; old: string; new: string } }>;
  /** Assistant text, and the result's text. */
  reply?: string;
  /** The structured result: for a harness role, its envelope. */
  json?: unknown;
  /** Ends the turn as an error result carrying this text. */
  fail?: { message: string };
  /** Milliseconds to wait before answering this turn. */
  delayMs?: number;
}

/** A whole script. Every session re-reads it from the start, so a run of several sessions sees every expectation afresh each time. */
export interface MockScript {
  init?: { slash_commands?: unknown[] };
  /** Default wait before answering each turn; an expectation's own `delayMs` wins. */
  delayMs?: number;
  expectations: MockExpectation[];
}

/** One line of claude-mock's journal: what a session was sent and what it consumed. */
export type JournalEvent =
  | { session_id: string; event: "matched"; prompt: string; expectation: number }
  | { session_id: string; event: "unmatched"; prompt: string }
  | { session_id: string; event: "effect_failed"; prompt: string; expectation: number; error: string }
  | { session_id: string; event: "finished"; turns: number; unconsumed: number[] };

/** Write `script` where claude-mock will read it: the same JSON a person would write by hand. */
export async function writeMockScript(scriptPath: string, script: MockScript): Promise<void> {
  await writeFile(scriptPath, JSON.stringify(script, null, 2) + "\n", "utf-8");
}

/** Every event claude-mock journalled, in order. A journal no session wrote is empty, not an error. */
export async function readJournal(journalPath: string): Promise<JournalEvent[]> {
  let text: string;
  try {
    text = await readFile(journalPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JournalEvent);
}

/** Every prompt the harness sent, whether or not an expectation matched it, in the order sent. */
export function promptsSent(journal: JournalEvent[]): string[] {
  return journal.flatMap((e) => (e.event === "matched" || e.event === "unmatched" ? [e.prompt] : []));
}

function waitingFor(when: MockExpectation["when"]): string {
  const clauses = [
    ...(when?.promptContains !== undefined ? [`containing ${JSON.stringify(when.promptContains)}`] : []),
    ...(when?.promptMatches !== undefined ? [`matching /${when.promptMatches}/`] : []),
  ];
  return clauses.length === 0 ? "any prompt" : `a prompt ${clauses.join(" and ")}`;
}

/**
 * Fail unless every expectation in `script` was used by some session in
 * `journal`. Judged across the whole journal, not per session: each session
 * re-reads the script, so its own `finished.unconsumed` lists expectations
 * other sessions used. The failure names each unused expectation by position
 * and by what it was waiting for, and shows each distinct prompt that matched
 * nothing, which is usually the typo to fix.
 */
export function assertFullyConsumed(journal: JournalEvent[], script: MockScript): void {
  const used = new Set(journal.flatMap((e) => (e.event === "matched" ? [e.expectation] : [])));
  const unused = script.expectations.flatMap((expectation, index) =>
    used.has(index) ? [] : [`  expectation ${index}: waiting for ${waitingFor(expectation.when)}`],
  );
  if (unused.length === 0) return;

  const unmatched = [...new Set(journal.flatMap((e) => (e.event === "unmatched" ? [e.prompt] : [])))];
  const lines = [
    `The script was not fully used: ${unused.length} of ${script.expectations.length} expectations never matched a prompt.`,
    ...unused,
    ...(unmatched.length === 0
      ? []
      : ["", "Prompts the harness sent that matched no expectation:", ...unmatched.flatMap((prompt, i) => [`--- prompt ${i + 1} ---`, prompt])]),
  ];
  throw new Error(lines.join("\n"));
}
