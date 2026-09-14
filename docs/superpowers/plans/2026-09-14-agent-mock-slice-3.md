# Agent Mock — Slice 3: Prove a Whole Pipeline Against a Scripted Agent

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-13-agent-mock-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-13-agent-mock-design.md`

**Goal:** Add `runSurfaceAgainstMock`, one call that runs a single surface (worker, gate, close) against the vendored claude-mock with the caller's real role configurations, gate, closer and triage choice, plus typed script and journal helpers (`MockScript`, `writeMockScript`, `readJournal`, `promptsSent`, `assertFullyConsumed`) so a test can assert what the harness sent and that the script was fully used.

**Architecture:** `src/mock-script.ts` holds plain TypeScript types mirroring claude-mock's own script and journal JSON (checked against the vendored source's types at compile time) and four small helpers. `src/scripted-surface-run.ts` composes the unchanged production pieces: it writes the script to a scratch directory, creates the case file with the caller's header (which pins the gate and closer as data), builds `createAgentPort(roleConfigs, mockSessionEnvironment(...))`, resolves the closer with `resolveCloser`, and calls the surface driver's `run` once. The driver itself provisions the worktree and resolves the gate from the pinned header, exactly as in production. Both modules are published through `src/testing.ts`.

**Tech Stack:** Node ≥ 22, TypeScript 6 (strict, Node16 ESM, `noUncheckedIndexedAccess`), vitest, ESLint flat config (`typescript-eslint` strict), `tsx` for demos, git, the vendored `@jorj/claude-mock`.

## Global Constraints

- **Buy-vs-build (Build note):** the run is composed from the unchanged production pieces: `createAgentPort` (`src/agent-invoke.ts`), `run` (`src/surface.ts`), `resolveCloser` (`src/resolve-closer.ts`), gate resolution (the driver's own `resolveGate` call in `src/run-gate.ts`), provisioning (the driver's own `provisionWorktree` call) and the real-temporary-git-repository pattern (`initTempRepo`, `src/temp-repo.ts`). There is **no** test-mode runner and no driver logic in the new module. No production file changes behaviour.
- **Script and journal types mirror claude-mock exactly, as plain types, not zod schemas.** Mirror the vendored source, not the spec's sketch where they differ: `when` is `{ promptContains?: string; promptMatches?: string }` (both may be given, both must hold; `vendor/claude-mock/src/mock.ts` `matches`), `init.slash_commands` is `unknown[]`, and an `effect_failed` journal event carries `prompt`, `expectation` and `error` (`vendor/claude-mock/src/cli.ts`), not the spec's `detail`. `src/mock-script.test.ts` proves the script types against the vendored `Expectation` and `Script` types at compile time.
- **`MockScript` is the object form** (`{ init?, delayMs?, expectations }`), as the spec defines it. claude-mock also accepts a bare array; hand-written bare-array scripts in existing tests stay valid and are not converted.
- **Journal assertions are small helpers**, not a log-assertion library: `readJournal`, `promptsSent`, `assertFullyConsumed`. No new dependency of any kind.
- **Consumption is judged across sessions.** Every agent invocation is a fresh claude-mock process that re-reads the whole script, so an expectation counts as used if **any** `matched` event in the journal names its index. `finished.unconsumed` is per session and must not be used for this.
- **The gate flows through the case-file header**, not a second resolution: the driver already resolves `header.gateRef` against `location.repoPath`. `runSurfaceAgainstMock` does not call `resolveGate` itself.
- **Triage is the caller's choice, as a factory** `(agent: AgentPort) => TriagePort`, because an agent-backed triage must wrap the same scripted agent port the helper builds internally. Callers pass `() => deterministicRouter` or `createAgentTriage`.
- **`assertFullyConsumed` is opt-in**, never called by `runSurfaceAgainstMock`: a legitimate script may hold expectations for a branch a run never takes. It passes exactly when every expectation was used; it throws a plain `Error` (the precedent `fakeAgentPort` set for the testing API).
- **Public surface:** after this slice `src/testing.ts` exports exactly these values: `assertFullyConsumed`, `fakeAgentPort`, `mockSessionEnvironment`, `promptsSent`, `readJournal`, `runSurfaceAgainstMock`, `writeMockScript`; and these types: `RoleHandlers`, `MockSessionPaths`, `MockExpectation`, `MockScript`, `JournalEvent`, `ScriptedSurfaceRun`, `ScriptedSurfaceResult`. `src/index.ts` does not change.
- **No network, no API key:** the scripted run reaches the agent only through `mockSessionEnvironment` (which strips credentials), and the scratch repositories have no remote.
- **Messages name the fix, not the mechanism** (house rule, `docs/configuring-a-role.md`). No em-dashes in outward-facing copy: error messages, demo output, `CONTRIBUTING.md`.
- **Imports:** tests and demos take the testing API from the public entry point (`./testing.js`, `../src/testing.js`).
- **Every tracked `.ts` file outside `vendor/` is inside `tsconfig.json`'s `include`** (`tests/typecheck-coverage.test.ts`); new files go under `src/` or `demos/`.
- **Commands:** run everything from the worktree root. Never `cd` into another checkout. Run only each task's own targeted tests; the full suite runs once in the final review. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first.

## Scaffolding Impact

- **Proactive, vendored-copy sync:** `src/mock-script.ts` now mirrors claude-mock's script and journal formats, and `src/mock-script.test.ts` type-checks the vendored `src/mock.ts`. `vendor/README.md` says the vendored TypeScript "is not ... type-checked by this repository" and its "Updating it" section does not mention the mirror → updated in Task 1.
- **Proactive, public testing API test:** the "public testing entry point" assertions live in `src/agent-port-double.test.ts`, which is the wrong home now that the barrel carries four modules → moved to `src/testing.test.ts` (tidy, own commit) and extended in Task 1 and Task 3.
- **Reactive, duplicated journal parsing:** five hand-rolled JSONL parsers cast journal lines to `{ event: string; prompt?: string }` (`src/agent-invoke.test.ts`, `src/mock-session.test.ts`, `src/surface.test.ts`, `demos/triage-slice-1-informed-retry.ts`, `demos/triage-slice-3-last-attempt.ts`) → replaced with `readJournal` / `promptsSent` in Task 2, demo output unchanged.
- **Proactive, contributor docs:** `CONTRIBUTING.md` tells contributors how to use `fakeAgentPort` and `mockSessionEnvironment` but not how to prove a pipeline → paragraph added in Task 3.
- **Proactive, run story:** new `npm run demo:mock-slice-3` script in `package.json` → Task 4.
- **Unchanged, checked:** `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push` (no new step: the new tests run under `npm test`), `README.md`, `src/index.ts`, `eslint.config.js` (the cast guard is untouched; no new cast), `docs/agent-interface.md` §Relationship to the mock (already describes the journal as the verification seam; still true). The adopter guide and the `docs/configuring-a-role.md` pointer are Slice 5's.

---

### Task 1: Typed script and journal helpers

**Files:**
- Create: `src/testing.test.ts` (moved from `src/agent-port-double.test.ts`, then extended)
- Modify: `src/agent-port-double.test.ts` (remove the moved `describe` block and its now-unused imports)
- Create: `src/mock-script.ts`
- Create: `src/mock-script.test.ts`
- Modify: `src/testing.ts`
- Modify: `vendor/README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (exported from `src/mock-script.ts` and re-exported from `src/testing.ts`):
  - `interface MockExpectation { when?: { promptContains?: string; promptMatches?: string }; effects?: Array<{ write: { path: string; content: string } } | { edit: { path: string; old: string; new: string } }>; reply?: string; json?: unknown; fail?: { message: string }; delayMs?: number }`
  - `interface MockScript { init?: { slash_commands?: unknown[] }; delayMs?: number; expectations: MockExpectation[] }`
  - `type JournalEvent = { session_id: string; event: "matched"; prompt: string; expectation: number } | { session_id: string; event: "unmatched"; prompt: string } | { session_id: string; event: "effect_failed"; prompt: string; expectation: number; error: string } | { session_id: string; event: "finished"; turns: number; unconsumed: number[] }`
  - `writeMockScript(scriptPath: string, script: MockScript): Promise<void>`
  - `readJournal(journalPath: string): Promise<JournalEvent[]>` (an absent journal is `[]`)
  - `promptsSent(journal: JournalEvent[]): string[]` (prompts of `matched` and `unmatched` events, in journal order)
  - `assertFullyConsumed(journal: JournalEvent[], script: MockScript): void` (throws `Error`)

- [ ] **Step 1: Tidy: move the barrel assertions to their own test file**

Create `src/testing.test.ts` with the block currently at the end of `src/agent-port-double.test.ts`, unchanged:

```ts
import { describe, it, expect } from "vitest";
import * as testing from "./testing.js";
import * as index from "./index.js";

describe("the public testing entry point", () => {
  it("publishes the testing API and nothing else", () => {
    expect(Object.keys(testing).sort()).toEqual(["fakeAgentPort", "mockSessionEnvironment"]);
  });

  it("leaves the main entry point unchanged", () => {
    expect(Object.keys(index)).not.toContain("fakeAgentPort");
    expect(Object.keys(index)).not.toContain("mockSessionEnvironment");
  });
});
```

In `src/agent-port-double.test.ts`, delete the whole `describe("the public testing entry point", ...)` block and the two imports only it used:

```ts
import * as testing from "./testing.js";
import * as index from "./index.js";
```

Keep `import { fakeAgentPort } from "./testing.js";`.

- [ ] **Step 2: Run the moved tests**

Run: `npx vitest run src/testing.test.ts src/agent-port-double.test.ts`
Expected: PASS, same test count as before the move (the two barrel tests now report under `src/testing.test.ts`).

Run: `npx eslint src/testing.test.ts src/agent-port-double.test.ts`
Expected: no output.

- [ ] **Step 3: Commit the tidy**

```bash
git add src/testing.test.ts src/agent-port-double.test.ts
git commit -m "Move the public testing entry point tests to their own file

The barrel's assertions lived in the fakeAgentPort test file because the
barrel once held only fakeAgentPort. It now publishes the scripted session
helper too, and is about to publish the script, journal and pipeline
helpers, so its contract belongs beside src/testing.ts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing tests**

Replace the first `it` in `src/testing.test.ts` so the barrel's new exports are part of the contract:

```ts
  it("publishes the testing API and nothing else", () => {
    expect(Object.keys(testing).sort()).toEqual([
      "assertFullyConsumed",
      "fakeAgentPort",
      "mockSessionEnvironment",
      "promptsSent",
      "readJournal",
      "writeMockScript",
    ]);
  });
```

Create `src/mock-script.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Expectation, Script } from "../vendor/claude-mock/src/mock.js";
import { assertFullyConsumed, promptsSent, readJournal, writeMockScript } from "./testing.js";
import type { JournalEvent, MockExpectation, MockScript } from "./testing.js";

const scratch = () => mkdtemp(join(tmpdir(), "mock-script-"));

/** True only when A and B are assignable both ways. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

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
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run src/mock-script.test.ts src/testing.test.ts`
Expected: FAIL. `src/mock-script.test.ts` fails to import `assertFullyConsumed` etc. (`is not a function` / undefined exports); `src/testing.test.ts` fails the export-list comparison.

- [ ] **Step 6: Write the implementation**

Create `src/mock-script.ts`:

```ts
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
```

Append to `src/testing.ts`:

```ts
export { assertFullyConsumed, promptsSent, readJournal, writeMockScript } from "./mock-script.js";
export type { JournalEvent, MockExpectation, MockScript } from "./mock-script.js";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/mock-script.test.ts src/testing.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/mock-script.ts src/mock-script.test.ts src/testing.ts src/testing.test.ts`
Expected: no output. (tsc is what enforces the `Same<...>` mirror check and the `@ts-expect-error` control.)

- [ ] **Step 8: Record the mirror in `vendor/README.md`**

In `vendor/README.md`, replace the paragraph:

```markdown
The vendored TypeScript is not linted or type-checked by this repository
(`eslint.config.js`, `tests/typecheck-coverage.test.ts`); it belongs to its own project.
```

with:

```markdown
The vendored TypeScript is not linted by this repository and is not part of its
`tsconfig.json` include (`eslint.config.js`, `tests/typecheck-coverage.test.ts`); it belongs
to its own project. One file is compiled here indirectly: `src/mock-script.test.ts` imports
the script types from `vendor/claude-mock/src/mock.ts` to prove `src/mock-script.ts` mirrors
them.
```

In the "Updating it" section, immediately before the line beginning "Then update the upstream commit above.", add this paragraph:

```markdown
`src/mock-script.ts` mirrors the script and journal formats as plain types. After a sync,
`npm run lint` fails if the script types drifted; the journal events are written ad hoc in
`src/cli.ts`, so compare its `journal({...})` calls against `JournalEvent` by eye.
```

- [ ] **Step 9: Commit**

```bash
git add src/mock-script.ts src/mock-script.test.ts src/testing.ts src/testing.test.ts vendor/README.md
git commit -m "Add typed claude-mock script and journal helpers to the testing API

A pipeline test needs to write a script, read back what the harness sent,
and prove every scripted expectation was used, without hand-parsing JSONL
or reading claude-mock's source. The types mirror the vendored format and
are checked against it at compile time; consumption is judged across the
whole journal because each session re-reads the script from the start.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Replace hand-rolled journal parsing with the typed helpers

**Files:**
- Modify: `src/agent-invoke.test.ts:1-20` (import), `:113-117` (parse)
- Modify: `src/mock-session.test.ts:2` (import), `:85-89` (parse)
- Modify: `src/surface.test.ts:18` (import), `:1589-1592` (parse)
- Modify: `demos/triage-slice-1-informed-retry.ts` (`sentPrompts` and its call)
- Modify: `demos/triage-slice-3-last-attempt.ts` (`sentPrompts` and its call)

**Interfaces:**
- Consumes: `readJournal(journalPath: string): Promise<JournalEvent[]>` and `promptsSent(journal: JournalEvent[]): string[]` from `src/testing.ts` (Task 1).
- Produces: nothing new; no observable behaviour changes.

The existing tests are the safety net here: this is a refactor, so they must pass before and after, and the two demos must print the same output.

- [ ] **Step 1: Capture the demos' output and run the affected tests before the change**

```bash
BEFORE=$(mktemp -d)
npx tsx demos/triage-slice-1-informed-retry.ts > "$BEFORE/triage-1.txt"
npx tsx demos/triage-slice-3-last-attempt.ts > "$BEFORE/triage-3.txt"
echo "$BEFORE"
npx vitest run src/agent-invoke.test.ts src/mock-session.test.ts src/surface.test.ts
```

Expected: both demos exit 0; tests PASS. Keep the printed `$BEFORE` path for Step 4.

- [ ] **Step 2: Replace the parsers**

`src/agent-invoke.test.ts`: change `import { mockSessionEnvironment } from "./testing.js";` to

```ts
import { mockSessionEnvironment, promptsSent, readJournal } from "./testing.js";
```

and replace

```ts
    const prompts = (await readFile(journalPath, "utf-8"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { event: string; prompt?: string })
      .filter((entry) => entry.event === "matched")
      .map((entry) => entry.prompt);
```

with

```ts
    const prompts = promptsSent(await readJournal(journalPath));
```

(`readFile` stays imported: it is still used for `.env` further down.)

`src/mock-session.test.ts`: change `import { mkdtemp, readFile, writeFile } from "node:fs/promises";` to `import { mkdtemp, writeFile } from "node:fs/promises";`, change `import { mockSessionEnvironment } from "./testing.js";` to

```ts
import { mockSessionEnvironment, promptsSent, readJournal } from "./testing.js";
```

and replace

```ts
    const events = (await readFile(journalPath, "utf-8"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { event: string; prompt?: string });
    expect(events.find((e) => e.event === "matched")?.prompt).toContain("add a greeting");
```

with

```ts
    expect(promptsSent(await readJournal(journalPath))[0]).toContain("add a greeting");
```

`src/surface.test.ts`: change `import { fakeAgentPort, mockSessionEnvironment } from "./testing.js";` to

```ts
import { fakeAgentPort, mockSessionEnvironment, promptsSent, readJournal } from "./testing.js";
```

and replace

```ts
    const prompts = (await readFile(journalPath, "utf-8"))
      .split("\n").filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { event: string; prompt?: string })
      .filter((e) => e.event === "matched").map((e) => e.prompt ?? "");
```

with

```ts
    const prompts = promptsSent(await readJournal(journalPath));
```

(`readFile` stays imported: it is still used at line 135.)

`demos/triage-slice-1-informed-retry.ts`: change `import { mockSessionEnvironment } from "../src/testing.js";` to

```ts
import { mockSessionEnvironment, promptsSent, readJournal } from "../src/testing.js";
```

delete the whole `function sentPrompts(journalPath: string): string[] { ... }`, and replace

```ts
  const [, triagePrompt = "", secondWorker = ""] = sentPrompts(journalPath);
```

with

```ts
  const [, triagePrompt = "", secondWorker = ""] = promptsSent(await readJournal(journalPath));
```

`demos/triage-slice-3-last-attempt.ts`: change `import { mockSessionEnvironment } from "../src/testing.js";` to

```ts
import { mockSessionEnvironment, promptsSent, readJournal } from "../src/testing.js";
```

delete the whole `function sentPrompts(journal: string): string[] { ... }` (its `existsSync` guard is now `readJournal`'s empty-journal rule), and replace

```ts
    prompts: sentPrompts(journal),
```

with

```ts
    prompts: promptsSent(await readJournal(journal)),
```

Update the `prompts` field's doc comment in that file's `Ran` interface from `/** Every prompt the mock matched, in order. */` to `/** Every prompt the harness sent the mock, in order. */`.

- [ ] **Step 3: Run the affected tests after the change**

Run: `npx vitest run src/agent-invoke.test.ts src/mock-session.test.ts src/surface.test.ts tests/triage-and-router`
Expected: PASS, same counts as Step 1 (plus the triage UAT suites, which assert on the two demos' output).

Run: `npx tsc --noEmit && npx eslint src/agent-invoke.test.ts src/mock-session.test.ts src/surface.test.ts demos/triage-slice-1-informed-retry.ts demos/triage-slice-3-last-attempt.ts`
Expected: no output.

Run: `git grep -n 'as { event: string' -- src demos tests`
Expected: no matches.

- [ ] **Step 4: Confirm the demos print the same output**

```bash
BEFORE=<the path printed in Step 1>
npx tsx demos/triage-slice-1-informed-retry.ts > "$BEFORE/triage-1.after.txt"
npx tsx demos/triage-slice-3-last-attempt.ts > "$BEFORE/triage-3.after.txt"
mask() { sed -E 's#/tmp/[^ ]*#<tmp>#g; s#[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z#<time>#g' "$1"; }
diff <(mask "$BEFORE/triage-1.txt") <(mask "$BEFORE/triage-1.after.txt") && diff <(mask "$BEFORE/triage-3.txt") <(mask "$BEFORE/triage-3.after.txt") && echo SAME
```

Expected: `SAME`.

- [ ] **Step 5: Commit**

```bash
git add src/agent-invoke.test.ts src/mock-session.test.ts src/surface.test.ts demos/triage-slice-1-informed-retry.ts demos/triage-slice-3-last-attempt.ts
git commit -m "Read claude-mock journals through the typed testing helpers

Five tests and demos each parsed the journal by hand and cast every line to
a loose shape. readJournal and promptsSent now do that once, against the
event types that mirror claude-mock, so a journal format change breaks one
place instead of five. Output and assertions are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `runSurfaceAgainstMock`, one scripted end-to-end surface run

**Files:**
- Create: `src/scripted-surface-run.ts`
- Create: `src/scripted-surface-run.test.ts`
- Modify: `src/testing.ts`
- Modify: `src/testing.test.ts`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `MockScript`, `JournalEvent`, `writeMockScript`, `readJournal` (Task 1, `src/mock-script.ts`); `promptsSent`, `assertFullyConsumed` (Task 1, in tests); production `create` (`src/case-file.ts`), `createAgentPort` and `RoleConfigs` (`src/agent-invoke.ts`), `mockSessionEnvironment` (`src/mock-session.ts`), `resolveCloser` (`src/resolve-closer.ts`), `run` and `RunResult` (`src/surface.ts`), `AgentPort`, `SurfaceLocation`, `TriagePort` (`src/ports.ts`), `BudgetSet`, `CloserRef`, `CreateHeader` (`src/schema.ts`).
- Produces (exported from `src/scripted-surface-run.ts` and re-exported from `src/testing.ts`):
  - `interface ScriptedSurfaceRun { dir: string; location: SurfaceLocation; header: CreateHeader & { closerRef: CloserRef }; budgets: BudgetSet; roleConfigs: RoleConfigs; triage: (agent: AgentPort) => TriagePort; script: MockScript }`
  - `interface ScriptedSurfaceResult { result: RunResult; journal: JournalEvent[] }`
  - `runSurfaceAgainstMock(input: ScriptedSurfaceRun): Promise<ScriptedSurfaceResult>`

- [ ] **Step 1: Write the failing tests**

In `src/testing.test.ts`, add `"runSurfaceAgainstMock"` to the expected export list, between `"readJournal"` and `"writeMockScript"`.

Create `src/scripted-surface-run.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "./case-file.js";
import { cleanGitEnv } from "./git-env.js";
import { initTempRepo } from "./temp-repo.js";
import { deterministicRouter } from "./router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
import { assertFullyConsumed, promptsSent, runSurfaceAgainstMock } from "./testing.js";
import type { MockScript, ScriptedSurfaceRun } from "./testing.js";
import type { TriageInput } from "./ports.js";
import type { BudgetSet, CloserRef, GateRef } from "./schema.js";

// Small correction and terminus caps keep the runs that cannot succeed short.
const budgets: BudgetSet = {
  correction: { used: 0, max: 1 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 2 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const INTENT = "add a greeting file that says hello";
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** A worker that, when its prompt contains `trigger`, writes one file and reports completion. */
function workerScript(trigger: string, write: { path: string; content: string }): MockScript {
  return {
    expectations: [
      { when: { promptContains: trigger }, effects: [{ write }], json: { status: "completed", rationale: `wrote ${write.path}` } },
    ],
  };
}

/** One surface in a fresh scratch repository whose gate passes before the worker starts. */
async function scratchRun(script: MockScript, triage: ScriptedSurfaceRun["triage"] = () => deterministicRouter) {
  const scratch = await mkdtemp(join(tmpdir(), "scripted-surface-test-"));
  const dir = await mkdtemp(join(scratch, "case-"));
  const repoPath = initTempRepo("scripted-surface-repo-", { "report.tap": PASSING_TAP });
  const ran = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: join(scratch, "wt") },
    header: { surfaceId: "greeting", taskDef: { intent: INTENT }, gateRef, closerRef },
    budgets,
    roleConfigs,
    triage,
    script,
  });
  return { ...ran, dir, repoPath };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runSurfaceAgainstMock", () => {
  it("lands a scripted worker's change through the real gate and the real closer, with no key and nowhere to push", async () => {
    // A key in the caller's environment must not be what makes the run work.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-be-needed");
    const { result, dir, repoPath } = await scratchRun(workerScript("add a greeting file", { path: "greeting.txt", content: "hello\n" }));

    expect(result.state).toBe("CLOSED");
    expect(result.outcome?.source).toBe("closer");
    const { history } = await load(dir);
    expect(history.flatMap((e) => (e.t === "gate" ? [e.status] : []))).toEqual(["PASS"]);
    expect(git(repoPath, ["show", "main:greeting.txt"])).toBe("hello");
    expect(git(repoPath, ["remote"])).toBe("");
  });

  it("does not land a change the real gate rejects, and hands the setback to the caller's triage", async () => {
    const triggers: TriageInput["trigger"][] = [];
    const recordingTriage: ScriptedSurfaceRun["triage"] = () => ({
      triage: (input) => {
        triggers.push(input.trigger);
        return deterministicRouter.triage(input);
      },
    });

    const { result, dir, repoPath } = await scratchRun(
      workerScript("add a greeting file", { path: "report.tap", content: FAILING_TAP }),
      recordingTriage,
    );

    expect(result.state).toBe("ESCALATED");
    const { history } = await load(dir);
    expect(history.flatMap((e) => (e.t === "gate" ? [e.status] : []))[0]).toBe("FAIL");
    expect(triggers[0]).toBe("gate_fail");
    expect(git(repoPath, ["show", "main:report.tap"])).toBe(PASSING_TAP.trim());
  });

  it("returns the parsed journal, which shows the task's intent reached the worker and the script was fully used", async () => {
    const script = workerScript("add a greeting file", { path: "greeting.txt", content: "hello\n" });

    const { journal } = await scratchRun(script);

    expect(promptsSent(journal)).toHaveLength(1);
    expect(promptsSent(journal)[0]).toContain(`"intent": "${INTENT}"`);
    expect(() => assertFullyConsumed(journal, script)).not.toThrow();
  });

  it("returns a journal whose consumption check shows the prompt sent and the expectation still waiting when the trigger has a typo", async () => {
    const script = workerScript("add a greting file", { path: "greeting.txt", content: "hello\n" });

    const { result, journal, repoPath } = await scratchRun(script);

    expect(result.state).toBe("ESCALATED");
    expect(() => git(repoPath, ["show", "main:greeting.txt"])).toThrow();
    expect(() => assertFullyConsumed(journal, script)).toThrow('expectation 0: waiting for a prompt containing "add a greting file"');
    expect(() => assertFullyConsumed(journal, script)).toThrow(`"intent": "${INTENT}"`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/scripted-surface-run.test.ts src/testing.test.ts`
Expected: FAIL: `runSurfaceAgainstMock is not a function` in all four `runSurfaceAgainstMock` tests, and the export-list comparison in `src/testing.test.ts`. (`npx tsc --noEmit` also reports the missing `runSurfaceAgainstMock` / `ScriptedSurfaceRun` exports.)

- [ ] **Step 3: Write the implementation**

Create `src/scripted-surface-run.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "./case-file.js";
import { createAgentPort, type RoleConfigs } from "./agent-invoke.js";
import { mockSessionEnvironment } from "./mock-session.js";
import { readJournal, writeMockScript, type JournalEvent, type MockScript } from "./mock-script.js";
import { resolveCloser } from "./resolve-closer.js";
import { run, type RunResult } from "./surface.js";
import type { AgentPort, SurfaceLocation, TriagePort } from "./ports.js";
import type { BudgetSet, CloserRef, CreateHeader } from "./schema.js";

/** Everything one scripted surface run needs: the project's own configuration, and what the agent will do. */
export interface ScriptedSurfaceRun {
  /** An existing, empty directory for the surface's case file. */
  dir: string;
  /** `repoPath`: a real git repository the surface branches from and closes into. `worktreePath`: where its worktree is created. */
  location: SurfaceLocation;
  /** The task, with the gate and closer named as data. Pinned in the case file, then resolved from there, as in a live run. */
  header: CreateHeader & { closerRef: CloserRef };
  budgets: BudgetSet;
  /** The pinned configuration each role is invoked with, through the real invocation path. */
  roleConfigs: RoleConfigs;
  /**
   * Which triage the surface uses, given the scripted agent port the run builds:
   * `() => deterministicRouter`, or `createAgentTriage` so triage's own replies
   * come from the same script.
   */
  triage: (agent: AgentPort) => TriagePort;
  /** What the scripted agent does and replies. Every session re-reads it from the start. */
  script: MockScript;
}

export interface ScriptedSurfaceResult {
  /** Where the surface ended, and its recorded outcome. */
  result: RunResult;
  /** Every event claude-mock journalled across the run's sessions, in order. */
  journal: JournalEvent[];
}

/**
 * Run one surface to its end against the vendored claude-mock, with the
 * production driver, agent port, gate and closer resolution and provisioning,
 * unchanged. Nothing here decides a transition: any retry or escalation
 * observed is the driver's own. No network, no API key.
 *
 * Whether the script was fully used is not checked here, because a script may
 * hold expectations for a branch this run never takes: call
 * `assertFullyConsumed(journal, script)` when it should have been.
 */
export async function runSurfaceAgainstMock(input: ScriptedSurfaceRun): Promise<ScriptedSurfaceResult> {
  const { dir, location, header, budgets, roleConfigs, triage, script } = input;
  const scratch = await mkdtemp(join(tmpdir(), "scripted-surface-"));
  const scriptPath = join(scratch, "mock.json");
  const journalPath = join(scratch, "journal.jsonl");
  await writeMockScript(scriptPath, script);
  await create(dir, header, budgets);

  const agent = createAgentPort(roleConfigs, mockSessionEnvironment({ scriptPath, journalPath }));
  const result = await run(dir, location, {
    agent,
    triage: triage(agent),
    closer: resolveCloser(header.closerRef, location.repoPath),
  });
  return { result, journal: await readJournal(journalPath) };
}
```

Append to `src/testing.ts`:

```ts
export { runSurfaceAgainstMock } from "./scripted-surface-run.js";
export type { ScriptedSurfaceResult, ScriptedSurfaceRun } from "./scripted-surface-run.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/scripted-surface-run.test.ts src/testing.test.ts`
Expected: PASS (the four runs spawn claude-mock sessions; each finishes in well under vitest's 5 s default).

Run: `npx tsc --noEmit && npx eslint src/scripted-surface-run.ts src/scripted-surface-run.test.ts src/testing.ts src/testing.test.ts`
Expected: no output.

Mutation check (do not commit): in `src/scripted-surface-run.ts` temporarily replace `closer: resolveCloser(header.closerRef, location.repoPath),` with `closer: resolveCloser({ type: "commit-to-branch" }, location.repoPath),` and rerun `npx vitest run src/scripted-surface-run.test.ts`. Expected: the first test FAILS on `main:greeting.txt`. Revert the line and rerun: PASS.

- [ ] **Step 5: Tell contributors how to prove a pipeline**

In `CONTRIBUTING.md`, after the paragraph ending "never name the `claude-mock` command or rely on `PATH`." and before the `fakeAgentPort` paragraph, add:

```markdown
To prove a gate, a closer and role configurations work together, run one surface end to end
against `claude-mock` with `runSurfaceAgainstMock` from `src/testing.ts`, in a scratch
repository made with `initTempRepo`. It returns the run's result and the parsed journal:
`promptsSent(journal)` shows what the harness sent, and `assertFullyConsumed(journal, script)`
fails naming any expectation the run never used. Every agent session re-reads the whole
script, so give each expectation a `when` clause once a run makes more than one call.
```

- [ ] **Step 6: Commit**

```bash
git add src/scripted-surface-run.ts src/scripted-surface-run.test.ts src/testing.ts src/testing.test.ts CONTRIBUTING.md
git commit -m "Add runSurfaceAgainstMock to prove a whole pipeline offline

An extender could script one invocation but had no way to run their real
gate, closer and role configurations through a complete surface without a
live agent. This composes the unchanged driver, agent port, closer
resolution and provisioning over a scratch repository and returns the
result with the parsed journal, so worker to gate to close is tested
deterministically at no cost.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The scripted-pipeline demo

**Files:**
- Create: `demos/agent-mock-slice-3-scripted-pipeline.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `runSurfaceAgainstMock`, `ScriptedSurfaceResult` (Task 3); `assertFullyConsumed`, `promptsSent`, `MockScript` (Task 1); `initTempRepo` (`src/temp-repo.ts`), `cleanGitEnv` (`src/git-env.ts`), `deterministicRouter` (`src/router.ts`), `workerRoleConfig`, `gateMaintenanceRoleConfig` (`src/role-config.ts`), `triageRoleConfig` (`src/triage-role-config.ts`).
- Produces: `npm run demo:mock-slice-3`, printing three numbered sections whose headings the UAT phase will assert on:
  - `--- 1. The script given to the agent, and how the surface closed ---`
  - `--- 2. What the harness sent the worker, and the consumption check ---`
  - `--- 3. The same run with a typo in the trigger phrase ---`

- [ ] **Step 1: Write the demo**

Create `demos/agent-mock-slice-3-scripted-pipeline.ts`:

```ts
/**
 * UAT demo for Agent Mock Slice 3: Prove a Whole Pipeline Against a Scripted Agent.
 *
 * 1. Runs one surface, worker to gate to close, against the scripted agent: a
 *    real command gate judges the scripted change and the real merge-back
 *    closer lands it on main in a scratch repository.
 * 2. Prints the prompt the harness sent the worker, and the consumption check.
 * 3. Reruns with a script whose trigger phrase has a typo, and prints the
 *    consumption check's failure.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no other setup. No network, no API key.
 *
 * Usage: npm run demo:mock-slice-3
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { cleanGitEnv } from "../src/git-env.js";
import { initTempRepo } from "../src/temp-repo.js";
import { deterministicRouter } from "../src/router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { triageRoleConfig } from "../src/triage-role-config.js";
import { assertFullyConsumed, promptsSent, runSurfaceAgainstMock } from "../src/testing.js";
import type { JournalEvent, MockScript, ScriptedSurfaceResult } from "../src/testing.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 3 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const INTENT = "add a greeting file that says hello";

/** A worker that, when its prompt contains `phrase`, writes greeting.txt and reports completion. */
function scriptTriggeredBy(phrase: string): MockScript {
  return {
    expectations: [
      {
        when: { promptContains: phrase },
        effects: [{ write: { path: "greeting.txt", content: "hello\n" } }],
        json: { status: "completed", rationale: "wrote greeting.txt" },
      },
    ],
  };
}

async function runWith(name: string, script: MockScript): Promise<ScriptedSurfaceResult & { repoPath: string }> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `mock-pipeline-demo-${name}-`));
  const dir = path.join(scratch, "case");
  fs.mkdirSync(dir);
  const repoPath = initTempRepo(`mock-pipeline-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const ran = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: path.join(scratch, "wt") },
    header: { surfaceId: name, taskDef: { intent: INTENT }, gateRef, closerRef },
    budgets,
    roleConfigs: { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    triage: () => deterministicRouter,
    script,
  });
  return { ...ran, repoPath };
}

function onMain(repoPath: string, file: string): string {
  try {
    return execFileSync("git", ["show", `main:${file}`], { cwd: repoPath, encoding: "utf-8", env: cleanGitEnv(), stdio: "pipe" }).trim();
  } catch {
    return "(not on main)";
  }
}

const indent = (text: string) => text.split("\n").map((l) => `   ${l}`).join("\n");

function consumption(journal: JournalEvent[], script: MockScript): string {
  try {
    assertFullyConsumed(journal, script);
    return "Consumption check passed: every scripted expectation was used.";
  } catch (err) {
    return `Consumption check failed:\n${indent((err as Error).message)}`;
  }
}

async function main(): Promise<void> {
  console.log("=== Agent Mock Slice 3: a whole pipeline against a scripted agent ===\n");

  const script = scriptTriggeredBy("add a greeting file");
  console.log("--- 1. The script given to the agent, and how the surface closed ---");
  console.log(indent(JSON.stringify(script, null, 2)));
  const happy = await runWith("greeting", script);
  console.log(`Surface finished:     ${happy.result.state}`);
  console.log(`Closing report:       ${happy.result.outcome?.reason ?? "-"}`);
  console.log(`greeting.txt on main: ${onMain(happy.repoPath, "greeting.txt")}\n`);

  console.log("--- 2. What the harness sent the worker, and the consumption check ---");
  const [workerPrompt = ""] = promptsSent(happy.journal);
  const replyFormat = workerPrompt.indexOf("## Reply format");
  console.log(indent((replyFormat === -1 ? workerPrompt : workerPrompt.slice(0, replyFormat)).trimEnd()));
  console.log(`The task's wording reached the worker: ${workerPrompt.includes(INTENT) ? "yes" : "NO"}`);
  console.log(`${consumption(happy.journal, script)}\n`);

  console.log("--- 3. The same run with a typo in the trigger phrase ---");
  const typo = scriptTriggeredBy("add a greting file");
  console.log(`Trigger phrase: ${JSON.stringify(typo.expectations[0]?.when?.promptContains)}`);
  const broken = await runWith("greeting-typo", typo);
  console.log(`Surface finished:     ${broken.result.state}`);
  console.log(`greeting.txt on main: ${onMain(broken.repoPath, "greeting.txt")}`);
  console.log(consumption(broken.journal, typo));
}

await main();
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"demo:mock-slice-1": "npx tsx demos/agent-mock-slice-1-honest-double.ts",` add:

```json
    "demo:mock-slice-3": "npx tsx demos/agent-mock-slice-3-scripted-pipeline.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:mock-slice-3`
Expected, exit 0, and:
- Section 1 prints the script JSON with `"promptContains": "add a greeting file"`, then `Surface finished:     CLOSED`, a closing report starting `Fast-forwarded main`, and `greeting.txt on main: hello`.
- Section 2 prints the prompt's `## Task` section containing `"intent": "add a greeting file that says hello"`, then `The task's wording reached the worker: yes` and `Consumption check passed: every scripted expectation was used.`
- Section 3 prints `Trigger phrase: "add a greting file"`, `Surface finished:     ESCALATED`, `greeting.txt on main: (not on main)`, then `Consumption check failed:` followed by `expectation 0: waiting for a prompt containing "add a greting file"`, `Prompts the harness sent that matched no expectation:` and the full worker prompt, once.

Run: `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN npm run demo:mock-slice-3 | grep -c "Consumption check"`
Expected: `2`.

Run: `npx tsc --noEmit && npx eslint demos/agent-mock-slice-3-scripted-pipeline.ts && npx vitest run tests/typecheck-coverage.test.ts`
Expected: no lint output; PASS.

- [ ] **Step 4: Commit**

```bash
git add demos/agent-mock-slice-3-scripted-pipeline.ts package.json
git commit -m "Add the scripted-pipeline demo

The slice's UAT has a reviewer run one command and read, in order, a
surface closing with its change on main, the prompt the worker was sent,
the consumption check passing, and the same check failing with the sent
prompt when the trigger phrase has a typo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
