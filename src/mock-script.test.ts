import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Expectation, Script } from "../vendor/claude-mock/src/mock.js";
import { assertFullyConsumed, promptsSent, readJournal, writeMockScript } from "./testing.js";
import type { JournalEvent, MockExpectation, MockScript } from "./testing.js";

const scratch = () => mkdtemp(join(tmpdir(), "mock-script-"));

/**
 * True only when A and B are the same type. Mutual assignability is not enough
 * here: every field of an expectation is optional, so a mirror missing one would
 * still be assignable both ways.
 */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

describe("the script types", () => {
  it("mirror claude-mock's own script format exactly", () => {
    // Checked by `npm run lint` (tsc) against the vendored source: if either side
    // changes shape, one of these assignments stops compiling.
    const script: Same<MockScript, Script> = true;
    const expectation: Same<MockExpectation, Expectation> = true;
    // @ts-expect-error an expectation is not a whole script, so Same must be able to say false
    const control: Same<MockExpectation, Script> = true;
    expect([script, expectation, control]).toEqual([true, true, true]);
  });
});

describe("writeMockScript", () => {
  it("writes the same file a hand-written script would", async () => {
    const scriptPath = join(await scratch(), "mock.json");
    const script: MockScript = {
      expectations: [
        {
          when: { promptContains: "add a greeting" },
          effects: [{ write: { path: "greeting.txt", content: "hello\n" } }],
          json: { status: "completed", rationale: "wrote the greeting" },
        },
      ],
    };

    await writeMockScript(scriptPath, script);

    expect(await readFile(scriptPath, "utf-8")).toBe(`{
  "expectations": [
    {
      "when": {
        "promptContains": "add a greeting"
      },
      "effects": [
        {
          "write": {
            "path": "greeting.txt",
            "content": "hello\\n"
          }
        }
      ],
      "json": {
        "status": "completed",
        "rationale": "wrote the greeting"
      }
    }
  ]
}
`);
  });
});

describe("readJournal", () => {
  it("reads every journal line as an event, in the order written", async () => {
    const journalPath = join(await scratch(), "journal.jsonl");
    const events: JournalEvent[] = [
      { session_id: "a", event: "matched", prompt: "add a greeting", expectation: 0 },
      { session_id: "a", event: "effect_failed", prompt: "add a greeting", expectation: 0, error: "Error: edit: string not found in x" },
      { session_id: "a", event: "finished", turns: 1, unconsumed: [1] },
      { session_id: "b", event: "unmatched", prompt: "something else" },
      { session_id: "b", event: "finished", turns: 1, unconsumed: [0, 1] },
    ];
    await writeFile(journalPath, events.map((e) => JSON.stringify(e) + "\n").join(""), "utf-8");

    expect(await readJournal(journalPath)).toEqual(events);
  });

  it("reads a journal no session ever wrote as empty", async () => {
    expect(await readJournal(join(await scratch(), "never-written.jsonl"))).toEqual([]);
  });
});

describe("promptsSent", () => {
  it("lists every prompt the harness sent, matched or not, in the order sent", () => {
    const journal: JournalEvent[] = [
      { session_id: "a", event: "matched", prompt: "first", expectation: 0 },
      { session_id: "a", event: "finished", turns: 1, unconsumed: [] },
      { session_id: "b", event: "unmatched", prompt: "second" },
      { session_id: "b", event: "finished", turns: 1, unconsumed: [0] },
    ];

    expect(promptsSent(journal)).toEqual(["first", "second"]);
  });
});

describe("assertFullyConsumed", () => {
  const script: MockScript = {
    expectations: [
      { when: { promptContains: "## Setback" }, json: { status: "reroute" } },
      { when: { promptMatches: "^## Task" }, json: { status: "completed" } },
      { when: { promptContains: "gate", promptMatches: "repair$" }, json: { status: "completed" } },
      { json: { status: "completed" } },
    ],
  };

  it("passes when every expectation was used, even though each session re-reads the whole script", () => {
    const journal: JournalEvent[] = [
      { session_id: "a", event: "matched", prompt: "## Task one", expectation: 1 },
      { session_id: "a", event: "finished", turns: 1, unconsumed: [0, 2, 3] },
      { session_id: "b", event: "matched", prompt: "## Setback", expectation: 0 },
      { session_id: "b", event: "finished", turns: 1, unconsumed: [1, 2, 3] },
      { session_id: "c", event: "matched", prompt: "gate repair", expectation: 2 },
      { session_id: "c", event: "finished", turns: 1, unconsumed: [0, 1, 3] },
      { session_id: "d", event: "matched", prompt: "anything", expectation: 3 },
      { session_id: "d", event: "finished", turns: 1, unconsumed: [0, 1, 2] },
    ];

    expect(() => assertFullyConsumed(journal, script)).not.toThrow();
  });

  it("fails listing each unused expectation by position and by what it was waiting for", () => {
    const journal: JournalEvent[] = [
      { session_id: "a", event: "matched", prompt: "## Task one", expectation: 1 },
      { session_id: "a", event: "finished", turns: 1, unconsumed: [0, 2, 3] },
    ];

    expect(() => assertFullyConsumed(journal, script)).toThrow(
      [
        "The script was not fully used: 3 of 4 expectations never matched a prompt.",
        '  expectation 0: waiting for a prompt containing "## Setback"',
        '  expectation 2: waiting for a prompt containing "gate" and matching /repair$/',
        "  expectation 3: waiting for any prompt",
      ].join("\n"),
    );
  });

  it("also shows each distinct prompt that matched nothing", () => {
    const typo: MockScript = { expectations: [{ when: { promptContains: "add a greting" }, json: {} }] };
    const journal: JournalEvent[] = [
      { session_id: "a", event: "unmatched", prompt: "## Task\nadd a greeting" },
      { session_id: "a", event: "finished", turns: 1, unconsumed: [0] },
      { session_id: "b", event: "unmatched", prompt: "## Task\nadd a greeting" },
      { session_id: "b", event: "finished", turns: 1, unconsumed: [0] },
    ];

    let message = "";
    try {
      assertFullyConsumed(journal, typo);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toBe(
      [
        "The script was not fully used: 1 of 1 expectations never matched a prompt.",
        '  expectation 0: waiting for a prompt containing "add a greting"',
        "",
        "Prompts the harness sent that matched no expectation:",
        "--- prompt 1 ---",
        "## Task\nadd a greeting",
      ].join("\n"),
    );
  });

  it("lists every expectation when no session ran at all", () => {
    expect(() => assertFullyConsumed([], { expectations: [{ json: {} }] })).toThrow(
      "The script was not fully used: 1 of 1 expectations never matched a prompt.\n  expectation 0: waiting for any prompt",
    );
  });
});
