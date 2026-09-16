# CLI and Configuration — Slice 4: See What Happened to a Run After the Fact

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 4 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Give someone who was not watching a `delivery status` command that reads one run's record in the repository, without changing it, and says in plain language what happened: what picking an unfinished run up will do next, how a closed run finished and where its work is, the whole escalation packet for a run that needs a decision, and why an aborted run stopped.

**Architecture:** No library change and no new library API. `status` is `load` plus lookup tables, exactly as the spec says: `readRun` (`src/cli/runs.ts`) already reads one run's record back, `summariseOutcome` (`src/cli/outcome.ts`) already turns a finished run's outcome into a headline and the lines under it, and `RESUME_PHRASES` (`src/cli/output.ts`) already translates what a resumed run will do next. This slice adds the reader that was missing: `src/cli/runs.ts` gains `allRuns` (every run, finished or not, most recently touched first) with `unfinishedRuns` re-expressed as a filter over it, `src/cli/output.ts` exposes the next-step phrase that `pickingUp` already computes, `src/cli/outcome.ts` exposes the packet read it already does, and one new file `src/cli/status-command.ts` composes those into the report and the command. Nothing in this slice calls `advance`, and nothing in it writes.

**Tech Stack:** Node ≥ 22, TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), commander 14, zod 4, vitest 5, git, the vendored `@jorj/claude-mock` through the contributor test seam. No new dependency: this slice needs nothing beyond `node:fs` and what the CLI layer already imports.

## Global Constraints

- **Buy-vs-build:** this slice carries no Build note, so the spec's own architecture is the constraint, verbatim: "`status` is `load` plus lookup tables, never `advance`. For an unfinished run it prints the translated `resumeAction`. For a finished run it prints the `CaseFileOutcome` (`kind`, `reason`, `at`). When `kind` is `escalated`, it reads the packet named by `packetRef` from the run's `refs/` and prints `decision`, `evidence`, `dead_ends`, `why_now` and `references` verbatim (`src/triage-role-config.ts:29-36`), followed by the retained branch and worktree location." And: "No new library API is needed beyond `DEFAULT_BUDGETS`." Nothing in `src/` outside `src/cli/` changes. No new dependency, no new persisted field, no run index.
- **Operability / DX:** this slice carries no Operational note. It adds one subcommand to an existing command, no build step, no dependency and no environment of its own; slice 1's harness, local-run story and CI cover it unchanged. What it changes is what the command accepts and what it prints, so the README, the sample project's walkthrough and the command's own `--help` are updated in the task that adds the command (see Scaffolding Impact).
- **Command surface (spec, verbatim):** "`delivery status [<run-id> | --last] [--repo <path>] [--all]` Read-only. For an unfinished run, prints the plain-language 'what happens next'; for a finished run, the outcome, or the escalation packet when escalated (see Terminal output). `--all` *(SHOULD)* lists every run under `.delivery/runs/` instead of looking up one. Never advances state." **`--all` is not in this slice**: it is a SHOULD, and the slice scope places it in slice 6 ("Script Against Runs With Machine-Readable Output", "`delivery status --all` lists every run in the repository"). Do not add it here.
- **`--json` is not in this slice** either, for the same reason: slice 6 owns it. `status` prints plain-language lines in every environment.
- **Exit codes (spec, verbatim):** "`status` and `init` exit `0` on success and `2` when the named run or repository is not found." A `status` on an escalated or aborted run is a *successful read*, so it exits `0`. The run's own exit code (`EXIT.escalated`, `EXIT.aborted`) belongs to `delivery run`, never to `status`. `EXIT` (`src/cli/failures.ts`) is unchanged: `{ ok: 0, unexpected: 1, configuration: 2, agentRuntime: 3, escalated: 4, aborted: 5 }`.
- **Where runs live (spec, verbatim):** "**Case file:** `<repo>/.delivery/runs/<run-id>/`." "**Worktree:** outside the repository, at `<state-home>/delivery-service/worktrees/<repo-key>/<run-id>`." Both are pure functions of `(repo, run-id)` in `src/cli/run-location.ts` (`runsRoot`, `runPlace`); `status` recomputes them and stores nothing.
- **Copy:** "Every message names the problem and the fix without harness vocabulary ('worktree', 'envelope', 'surface', a state name)." "States are translated, never shown raw in the human stream." British English, no em-dashes in any user-facing string or document. The command speaks in the first person where it speaks of itself, matching slices 1 to 3. Exact user-facing strings that a test asserts on are exported constants or built by exported functions, as in slices 1 to 3.
- **The deliberate exception to that copy rule** is the escalation packet's own five fields, which the spec says to print **verbatim**. They are the harness's own account, already written for a person (`src/escalation-packet.ts:60-95`), and paraphrasing them here is exactly what the slice exists to prevent. They are printed under plain-language headings, unchanged.
- **Colour:** decorative only, through `paint` (`src/cli/output.ts`), which is already off when `--no-color` is passed, `NO_COLOR` is set or stdout is not a terminal. Every line `status` prints says its meaning in words.
- **Refusal ordering:** repository first (`findRepository`), then the run. A repository with no runs at all, and a run id that names nothing, are both `EXIT.configuration` with a message saying how to start a run.
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests while working (`npx vitest run <file> -t "<name>"`); the last task ends with one wider check (Task 3, Step 8). No task's own tests need `npm run build`: they all drive `runCli` in process. The one wider check at the end runs `npm test`, which builds first, because the earlier slices' acceptance tests drive the compiled command.
- **TDD and commits:** red, then green, then commit. Every commit message is one line saying what changed, a blank line, a paragraph saying why, a blank line, and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Two decisions this plan makes, and why

Recorded here because this was an unattended run with no human to validate them.

1. **Bare `delivery status`, with neither a run id nor `--last`, reports the most recently touched run.** The slice's own Delivers line is "can type `delivery status` in the repository and read the outcome", so bare `status` must do something useful. The command is read-only, so picking the most recent run cannot finish the wrong run the way a guessed `resume` could; there is nothing to ask about. `--last` is therefore accepted and documented as the explicit form of that default, and the handler never branches on it. It is declared on the command in `program.ts` but deliberately absent from `StatusOptions`, so no dead field invites a later reader to "wire it up".

2. **An escalated run's "where the work was kept" is checked against the disk, not asserted from the design.** The spec's Diagnosability note says "escalated runs keep their branch and worktree for inspection", but the built-in closers do not: `teardownWorktree` (`src/closer-support.ts:41-49`) force-removes the scratch working copy on any outcome that is not `accepted` and keeps only the branch, which is why `summariseOutcome` already says "Nothing was changed on `<base>`" rather than "the work is on the branch" (`src/cli/outcome.ts:109-112`). Printing a path that is not there would be the easy choice and would waste the reader's time. `status` therefore names the branch and the run's own record folder always, and names the working copy only when it is still on disk (a teardown that failed, or a custom closer that kept it). That is the honest reading of "where the retained branch and working copy are".

## Scaffolding Impact

- **Proactive, a new subcommand needs its own help:** `delivery status` is registered in `src/cli/program.ts` with a description and help for `[run-id]`, `--last` and `--repo`, and appears in `delivery --help`'s command list → Task 3.
- **Reactive, `README.md` describes a tool that can start and resume runs but never report on one:** it gains a "See what happened to a run" section covering bare `status`, `status <run-id>`, `status --last`, what each kind of outcome prints, and that it only ever reads → Task 3.
- **Reactive, `examples/sample-project/README.md` walks a person through a first run and a resumed one, and stops there:** its walkthrough gains the one-line "check on it later" step, which is what the slice's UAT asks a person to do → Task 3. (`tests/sample-project.test.ts` asserts the folder's file list, not the README's text, so editing it is safe.)
- **Unchanged, checked:** `CONTRIBUTING.md` (no new build, test or run step; the `DELIVERY_TEST_MOCK_SCRIPT` seam is untouched and still accurate, and `status` never starts an agent so the seam does not apply to it); `package.json` (no new dependency, no new script, `bin` and `exports` unchanged); `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push` (all call `npm test`); `vitest.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js` (the new file sits under the existing `src/**` globs); `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md`, `docs/provisioning.md`, `docs/single-surface-control-flow.md`, `docs/multi-surface-control-flow.md`, `docs/agent-interface.md` (library contracts and control flow, unchanged: this slice adds no library API and changes no gate, closer, role or state behaviour); `examples/sample-project/package.json`, `add.js`, `add.test.js`.

---

### Task 1: Every run a repository holds, and a finish time a person can read ✅ DONE (deliver-slice)

Discovery today only answers "which runs did not finish" (`unfinishedRuns`), because resume is the only thing that has ever asked. `status --last`, and bare `status`, mean the most recently touched run whether it finished or not, so the general question moves underneath and the resume question becomes a filter over it. `readableUtc` is the same job `startedAt` already does for a run id's own timestamp, done once for an ISO 8601 string so a finished run can say when it finished in the same words.

**Files:**
- Modify: `src/cli/runs.ts`
- Test: `src/cli/runs.test.ts`

**Interfaces:**
- Consumes: `readdir`, `stat` from `node:fs/promises`; `load` from `../case-file.js`; `FileNotFound` from `../errors.js`; `runsRoot` from `./run-location.js` — all already imported by this file.
- Produces, from `src/cli/runs.ts`:
  - `function allRuns(repoPath: string): Promise<RunRecord[]>` — every readable run, most recently touched first
  - `function unfinishedRuns(repoPath: string): Promise<RunRecord[]>` — unchanged signature and behaviour, now a filter over `allRuns`
  - `function readableUtc(iso: string): string` — `"2026-09-14 21:05 UTC"`
  - `const NOTHING_HERE: string`
  - unchanged and still exported: `RunRecord`, `readRun`, `startedAt`, `describeRun`, `unfinishedRunFound`, `NOTHING_TO_RESUME`, `NOTHING_CHOSEN`, `severalRuns`, `chooseRun`, `alreadyFinished`

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/runs.test.ts`. The file's existing `writeRun(repoPath, runId, intent, finished = false)` helper and `scratchRepo()` already write both kinds of record, so nothing new is needed to set them up. Import `allRuns`, `NOTHING_HERE` and `readableUtc` alongside the existing imports from `./runs.js`.

```ts
describe("every run a repository holds", () => {
  it("finds none in a repository that has never run anything", async () => {
    expect(await allRuns(await scratchRepo())).toEqual([]);
  });

  it("includes the runs that finished as well as the ones that did not", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting");

    expect((await allRuns(repo)).map((record) => record.runId).sort()).toEqual([
      "add-a-greeting-20260915T211500Z",
      "reverse-a-word-20260915T210000Z",
    ]);
  });

  it("puts the most recently touched run first, so `--last` needs no other bookkeeping", async () => {
    const repo = await scratchRepo();
    const older = await writeRun(repo, "reverse-a-word-20260915T210000Z", "reverse a word", true);
    const newer = await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting", true);
    const longAgo = new Date("2026-09-15T21:00:00.000Z");
    await utimes(join(older, "case.json"), longAgo, longAgo);
    await utimes(join(older, "log.jsonl"), longAgo, longAgo);

    const [first] = await allRuns(repo);
    expect(first?.dir).toBe(newer);
  });

  it("passes over a folder that never became a run, and still reports one that cannot be read back", async () => {
    const repo = await scratchRepo();
    await mkdir(join(runsRoot(repo), "never-started-20260915T210000Z"), { recursive: true });
    await writeRun(repo, "add-a-greeting-20260915T211500Z", "add a greeting", true);
    expect((await allRuns(repo)).map((record) => record.runId)).toEqual(["add-a-greeting-20260915T211500Z"]);

    await writeFile(join(runsRoot(repo), "add-a-greeting-20260915T211500Z", "case.json"), "{ not json");
    await expect(allRuns(repo)).rejects.toThrow(CorruptCaseFile);
  });
});

describe("a time a person can read", () => {
  it("reads an ISO timestamp back as a date, a time and the zone it is in", () => {
    expect(readableUtc("2026-09-14T21:05:09.123Z")).toBe("2026-09-14 21:05 UTC");
  });

  it("says when there is nothing in this repository to report on, and how to start something", () => {
    expect(NOTHING_HERE).toContain("delivery run --task");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/runs.test.ts -t "every run a repository holds"`
Expected: FAIL — `allRuns is not a function` (and the same for `readableUtc` and `NOTHING_HERE` in the second block).

- [ ] **Step 3: Write the implementation**

In `src/cli/runs.ts`, replace the whole `unfinishedRuns` function (lines 39-66) with these two, keeping the existing `touchedAt` helper above them untouched:

```ts
/**
 * Every run this repository is holding, most recently touched first, so "the
 * last one" needs no other bookkeeping.
 *
 * A folder with no record in it was never a run (the process died between
 * making the folder and writing the case file), so it is passed over. A record
 * that is there but cannot be read back is the user's to hear about, so it is
 * not swallowed: it stops the command with the message that names the folder.
 */
export async function allRuns(repoPath: string): Promise<RunRecord[]> {
  let entries;
  try {
    entries = await readdir(runsRoot(repoPath), { withFileTypes: true });
  } catch {
    return []; // nothing has ever run here
  }

  const read = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) =>
      readRun(repoPath, entry.name).catch((err) => {
        if (err instanceof FileNotFound) return undefined;
        throw err;
      }),
    ),
  );
  const found = await Promise.all(
    read
      .filter((record): record is RunRecord => record !== undefined)
      .map(async (record) => ({ record, touchedAt: await touchedAt(record.dir) })),
  );
  return found.sort((a, b) => b.touchedAt - a.touchedAt).map(({ record }) => record);
}

/** The runs this repository is still holding: a record with no outcome, which is what an interrupted run leaves behind. */
export async function unfinishedRuns(repoPath: string): Promise<RunRecord[]> {
  return (await allRuns(repoPath)).filter((record) => !record.caseFile.outcome);
}
```

Then add, next to `startedAt` (which it now shares its wording with):

```ts
/** An ISO 8601 timestamp as a person reads it: the date, the minute, and the zone it is in. */
export function readableUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
```

and next to `NOTHING_TO_RESUME`:

```ts
export const NOTHING_HERE =
  'No runs have been started in this repository yet, so there is nothing to report on. Start one with `delivery run --task "..."`.';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/runs.test.ts`
Expected: PASS — the new blocks, and every test that was already there, because `unfinishedRuns` keeps its signature, its ordering and its errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/runs.ts src/cli/runs.test.ts
git commit -m "Find every run a repository holds, not only the unfinished ones

Reporting on a run after the fact asks a more general question than resuming
one does: the most recently touched run may well have finished. allRuns answers
that question and unfinishedRuns becomes a filter over it, so both commands
share one reader and one ordering. readableUtc gives a finished run the same
words for its finish time that a run id already gets for its start time.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: What one run's record says ✅ DONE (deliver-slice)

The report itself, as a list of lines, with no discovery, no writing and no process around it. Three small exports move out of the way first, so this composes what is already written rather than restating it: `nextStep` is the phrase `pickingUp` already looks up, and `packetOf` is the packet read `summariseOutcome` already does.

**Files:**
- Modify: `src/cli/output.ts` (extract `nextStep` from `pickingUp`)
- Modify: `src/cli/outcome.ts` (export the existing `packetOf`)
- Modify: `src/cli/command-fixtures.ts` (a run record on disk, for this task's tests and Task 3's)
- Create: `src/cli/status-command.ts`
- Test: `src/cli/status-command.test.ts`

**Interfaces:**
- Consumes: `existsSync` from `node:fs`; `branchName` from `../provision.js`; `EscalationPacket` type from `../triage-role-config.js`; `CommandContext` from `./context.js`; `summariseOutcome` and the newly exported `packetOf` from `./outcome.js`; `paint` and the newly exported `nextStep` from `./output.js`; `runPlace` from `./run-location.js`; `RunRecord`, `readRun`, `startedAt` and `readableUtc` from `./runs.js`; `taskIntent` from `./settings.js`.
- Produces:
  - from `src/cli/output.ts`: `function nextStep(caseFile: CaseFile): string`
  - from `src/cli/outcome.ts`: `function packetOf(dir: string, packetRef: string | undefined): Promise<EscalationPacket | undefined>` (already written, now exported)
  - from `src/cli/command-fixtures.ts`: `const ESCALATION: EscalationPacket`, `function writeRunRecord(repoPath: string, options: { runId: string; task?: string; outcome?: CaseFileOutcome; packet?: EscalationPacket }): Promise<string>`
  - from `src/cli/status-command.ts`: `function statusReport(record: RunRecord, ctx: CommandContext): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

First add the shared fixture to `src/cli/command-fixtures.ts`, since both this task's tests and Task 3's need a run's record on disk without paying for a whole run. Add these imports to the ones already at the top of that file: `mkdir` from `node:fs/promises`, `setBaseBranch`, `setOutcome`, `writeRef` alongside the existing `create` from `../case-file.js`, and the types `CaseFileOutcome` from `../schema.js` and `EscalationPacket` from `../triage-role-config.js`. Then append:

```ts
/** Test support: the packet a stopped run leaves for whoever picks it up, in the shape `src/escalation-packet.ts` builds. */
export const ESCALATION: EscalationPacket = {
  decision:
    "The worker stopped because it judged it lacked authority. Decide whether to grant that authority or take the action yourself.",
  evidence: "the task asks me to delete files I was not given",
  dead_ends: "1. The first attempt rewrote the caller instead of the function.",
  why_now: "The worker reported that it lacks the authority to go on; an authority limit goes straight to a person.",
  references: ["worker-1-0", "triage-1-0"],
};

/**
 * Test support: one run's record on disk, exactly as the run loop leaves it,
 * without paying for a whole run. No `outcome` leaves it unfinished, which is
 * what an interruption leaves behind.
 */
export async function writeRunRecord(
  repoPath: string,
  { runId, task = TASK, outcome, packet }: { runId: string; task?: string; outcome?: CaseFileOutcome; packet?: EscalationPacket },
): Promise<string> {
  const dir = join(runsRoot(repoPath), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef: { intent: task }, gateRef: GATE, closerRef: DEFAULT_CLOSER }, DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  if (outcome) {
    const packetRef = packet === undefined ? undefined : await writeRef(dir, "escalation", packet);
    await setOutcome(dir, { ...outcome, ...(packetRef === undefined ? {} : { packetRef }) });
  }
  return dir;
}
```

Then create `src/cli/status-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { CaseFileOutcome } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { ESCALATION, writeRunRecord } from "./command-fixtures.js";
import { runPlace, runsRoot } from "./run-location.js";
import { readRun } from "./runs.js";
import { statusReport } from "./status-command.js";

const AT = "2026-09-14T21:05:09.123Z";
const RUN_ID = "add-a-hello-function-20260914T210309Z";
const TASK = "add a function that says hello to a name, with a test";

/** A context with nobody in front of it: no colour, no answers, and its own state folder so the working copy's place is this test's. */
async function context(): Promise<CommandContext> {
  return {
    cwd: "/nowhere",
    env: { XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "status-state-")) },
    colour: false,
    stdin: Object.assign(Readable.from([]), { isTTY: undefined }),
    writeLine: () => undefined,
  };
}

/** A repository holding exactly one run's record, and the report that record makes. */
async function reportOn(
  record: { runId: string; task?: string; outcome?: CaseFileOutcome; packet?: EscalationPacket },
  ctx: CommandContext,
): Promise<{ repo: string; lines: string[] }> {
  const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
  await writeRunRecord(repo, record);
  return { repo, lines: await statusReport(await readRun(repo, record.runId), ctx) };
}

describe("what a run's record says about an unfinished run", () => {
  it("says it did not finish, what picking it up will do next, and how to pick it up", async () => {
    const { lines } = await reportOn({ runId: RUN_ID, task: TASK }, await context());
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      "This run hasn't finished. Picking it up will carry on with getting the agent going.",
      `To finish it: delivery resume ${RUN_ID}`,
    ]);
  });
});

describe("what a run's record says about a closed run", () => {
  it("says what was done, when it finished, and the branch the work is on", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, task: TASK, outcome: { kind: "closed", source: "closer", reason: "committed", at: AT } },
      await context(),
    );
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      `Done: the change for "${TASK}" passed \`npm test\` and is committed on branch surface/${RUN_ID}.`,
      "It finished 2026-09-14 21:05 UTC.",
      `main was not changed. To look at the work: git log surface/${RUN_ID}`,
    ]);
  });
});

describe("what a run's record says about an escalated run", () => {
  it("leads with the decision, then quotes the packet's own words, then says where to look", async () => {
    const ctx = await context();
    const { repo, lines } = await reportOn(
      {
        runId: RUN_ID,
        task: TASK,
        outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
        packet: ESCALATION,
      },
      ctx,
    );
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      `This needs your decision: ${ESCALATION.decision}`,
      "It stopped 2026-09-14 21:05 UTC.",
      "",
      "What the harness saw:",
      ESCALATION.evidence,
      "",
      "What had already been tried:",
      ESCALATION.dead_ends,
      "",
      "Why it stopped when it did:",
      ESCALATION.why_now,
      "",
      "The agent sessions behind this:",
      "  worker-1-0",
      "  triage-1-0",
      "",
      "Where to look:",
      `  The branch surface/${RUN_ID} was kept.`,
      "  The agent's working copy has been cleared away.",
      `  Everything this run recorded is in ${join(runsRoot(repo), RUN_ID)}.`,
    ]);
  });

  it("names the agent's working copy while it is still on disk", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, {
      runId: RUN_ID,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });
    const { location } = runPlace(repo, RUN_ID, ctx.env);
    await mkdir(location.worktreePath, { recursive: true });

    const lines = await statusReport(await readRun(repo, RUN_ID), ctx);
    expect(lines).toContain(`  The agent's working copy is still at ${location.worktreePath}.`);
    expect(lines).not.toContain("  The agent's working copy has been cleared away.");
  });

  it("falls back to the recorded reason when the run kept no packet", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT } },
      await context(),
    );
    expect(lines[1]).toBe("This needs your decision: authority limit");
    expect(lines).not.toContain("What had already been tried:");
    expect(lines).toContain("Where to look:");
  });
});

describe("what a run's record says about an aborted run", () => {
  it("says in plain language why it stopped, and where to look", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, task: TASK, outcome: { kind: "aborted", source: "triage", reason: "the task cannot be done", at: AT } },
      await context(),
    );
    expect(lines.slice(0, 3)).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      "The run stopped: the task cannot be done",
      "It stopped 2026-09-14 21:05 UTC.",
    ]);
    expect(lines).toContain(`  The branch surface/${RUN_ID} was kept.`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: FAIL — `Failed to load .../status-command.js` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

First, in `src/cli/output.ts`, split the phrase lookup out of `pickingUp` so both tenses share one table. Replace the existing `pickingUp` (lines 88-91) with:

```ts
/** What a run will do first when it is picked up, read from its log rather than its cursor, which a kill can leave behind. */
export function nextStep(caseFile: CaseFile): string {
  return RESUME_PHRASES[resumeAction(logTail(caseFile))];
}

/** What this run will do first now it has been picked up. */
export function pickingUp(caseFile: CaseFile): string {
  return `Picking up where it left off: ${nextStep(caseFile)}.`;
}
```

Second, in `src/cli/outcome.ts`, export the packet read it already performs: change `async function packetOf(` (line 28) to `export async function packetOf(`, and extend its doc comment's first line to `/** The packet the escalation recorded, or undefined when the run has none to show. Shared with `status`, which prints all of it. */`.

Third, create `src/cli/status-command.ts` with the report (the command itself arrives in Task 3):

```ts
import { existsSync } from "node:fs";
import { branchName } from "../provision.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { packetOf, summariseOutcome } from "./outcome.js";
import { nextStep, paint } from "./output.js";
import { runPlace } from "./run-location.js";
import { readableUtc, startedAt, type RunRecord } from "./runs.js";
import { taskIntent } from "./settings.js";

/**
 * The packet a stopped run left, in the order a person reads it: every field
 * the harness wrote, under a heading saying what it is, and none of it
 * paraphrased. Whoever picks this up was not watching, so the harness's own
 * account is all they have.
 */
function packetLines(packet: EscalationPacket): string[] {
  return [
    "",
    "What the harness saw:",
    packet.evidence,
    "",
    "What had already been tried:",
    packet.dead_ends,
    "",
    "Why it stopped when it did:",
    packet.why_now,
    ...(packet.references.length === 0
      ? []
      : ["", "The agent sessions behind this:", ...packet.references.map((reference) => `  ${reference}`)]),
  ];
}

/**
 * Where a stopped run's work is, checked rather than assumed. The built-in
 * closers keep the branch and clear the scratch working copy away on any
 * outcome that is not accepted, so naming a path that is not there would waste
 * the reader's time; a working copy that did survive is worth naming, and the
 * run's own record is always there.
 */
function whereToLook(record: RunRecord, ctx: CommandContext): string[] {
  const { location } = runPlace(record.repoPath, record.runId, ctx.env);
  return [
    "",
    "Where to look:",
    `  The branch ${branchName(record.caseFile.header.surfaceId)} was kept.`,
    existsSync(location.worktreePath)
      ? `  The agent's working copy is still at ${location.worktreePath}.`
      : "  The agent's working copy has been cleared away.",
    `  Everything this run recorded is in ${record.dir}.`,
  ];
}

/**
 * One run's record, as a person reads it: which run and what it was asked to
 * do, then what happened. A run that did not finish says what picking it up
 * will do next; a run that stopped says so in the words the harness wrote at
 * the time, and where its work was kept. Pure over the record: this reads, and
 * never advances anything.
 */
export async function statusReport(record: RunRecord, ctx: CommandContext): Promise<string[]> {
  const { caseFile, dir, runId } = record;
  const opening = `Run ${runId}, started ${startedAt(runId)}: ${taskIntent(caseFile.header.taskDef)}`;
  const { outcome } = caseFile;

  if (!outcome) {
    return [
      opening,
      paint(ctx.colour, "quiet", `This run hasn't finished. Picking it up will carry on with ${nextStep(caseFile)}.`),
      `To finish it: delivery resume ${runId}`,
    ];
  }

  const summary = await summariseOutcome(dir, caseFile);
  const finished = [
    opening,
    paint(ctx.colour, summary.tone, summary.headline),
    `${outcome.kind === "closed" ? "It finished" : "It stopped"} ${readableUtc(outcome.at)}.`,
  ];
  if (outcome.kind === "closed") return [...finished, ...summary.details];

  // Not summary.details: that is the live run's short form, which quotes the
  // evidence alone. Whoever reads this later gets the whole packet instead.
  const packet = outcome.kind === "escalated" ? await packetOf(dir, outcome.packetRef) : undefined;
  return [
    ...finished,
    ...(packet ? packetLines(packet) : []),
    ...(outcome.kind === "aborted" ? summary.details : []),
    ...whereToLook(record, ctx),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS — all six tests.

Then run the two files whose exports moved, to confirm nothing that depended on them shifted:

Run: `npx vitest run src/cli/output.test.ts src/cli/outcome.test.ts`
Expected: PASS — `pickingUp` returns the same sentence and `summariseOutcome` the same summary; only their internals were split out.

- [ ] **Step 5: Commit**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts src/cli/command-fixtures.ts src/cli/output.ts src/cli/outcome.ts
git commit -m "Report what one run's record says, in plain language

Someone who was not watching has only the record to go on, so the report leads
with what happened and then hands over the harness's own words: the whole
escalation packet for a run that needs a decision, quoted rather than
paraphrased, and where its branch, working copy and record are, checked against
the disk rather than assumed. The phrase lookup and the packet read were
already written for the live run, so both are shared rather than restated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `delivery status` reads a run without changing it ✅ DONE (deliver-slice)

The command around the report: which run this invocation means, the two ways of not finding one, and the documentation that says the command exists.

**Files:**
- Modify: `src/cli/status-command.ts` (add `statusCommand`)
- Modify: `src/cli/program.ts` (register the subcommand)
- Test: `src/cli/status-command.test.ts`
- Modify: `README.md`
- Modify: `examples/sample-project/README.md`

**Interfaces:**
- Consumes: `resolve` from `node:path`; `EXIT`, `Refusal`, `ExitCode` from `./failures.js`; `findRepository` from `./project.js`; `allRuns`, `NOTHING_HERE`, `readRun` from `./runs.js`; `statusReport` from Task 2; `delivery`, `writeRunRecord`, `ESCALATION`, `PACKAGE` from `./command-fixtures.js`; `initTempRepo` from `../temp-repo.js`.
- Produces, from `src/cli/status-command.ts`:
  - `interface StatusOptions { repo?: string }`
  - `function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode>`

- [ ] **Step 1: Write the failing tests**

Append to `src/cli/status-command.test.ts`. Extend its imports with `readFileSync, statSync` from `node:fs`, `utimes` alongside the existing `mkdtemp, mkdir` from `node:fs/promises`, `initTempRepo` from `../temp-repo.js`, `delivery, PACKAGE` alongside the existing `ESCALATION, writeRunRecord` from `./command-fixtures.js`, `EXIT` from `./failures.js`, and `NOTHING_HERE` alongside the existing `readRun` from `./runs.js`. (`runsRoot` and `join` are already imported by Task 2's block.)

```ts
const CLOSED = { kind: "closed", source: "closer", reason: "committed", at: AT } as const;

/** Push a record's write times into the past, so "most recently touched" is settled by the test rather than by how fast the disk was. */
async function backdate(dir: string): Promise<void> {
  const longAgo = new Date("2026-09-14T21:04:00.000Z");
  for (const name of ["case.json", "log.jsonl"]) await utimes(join(dir, name), longAgo, longAgo);
}

describe("delivery status", () => {
  it("reports on the run whose id it is given", async () => {
    const repo = initTempRepo("status-named-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260914T220000Z", task: "add a goodbye" });

    const { stdout, exitCode } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(`Run ${RUN_ID}`);
    expect(stdout).toContain("It finished 2026-09-14 21:05 UTC.");
    expect(stdout).not.toContain("add a goodbye");
  });

  it("reports on the run touched most recently, whether it is asked with --last or with nothing at all", async () => {
    const repo = initTempRepo("status-last-", { "package.json": PACKAGE });
    await backdate(await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED }));
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260914T220000Z", task: "add a goodbye" });

    const withFlag = await delivery(["status", "--last"], { cwd: repo });
    const bare = await delivery(["status"], { cwd: repo });

    expect(withFlag.stdout).toBe(bare.stdout);
    expect(bare.exitCode).toBe(EXIT.ok);
    expect(bare.stdout).toContain("Run add-a-goodbye-20260914T220000Z");
  });

  it("exits ok after reporting an escalated run: reading it is not the run's own outcome", async () => {
    const repo = initTempRepo("status-escalated-", { "package.json": PACKAGE });
    await writeRunRecord(repo, {
      runId: RUN_ID,
      task: TASK,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });

    const { stdout, exitCode } = await delivery(["status", "--last"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const decision = stdout.indexOf(`This needs your decision: ${ESCALATION.decision}`);
    expect(decision).toBeGreaterThan(-1);
    expect(stdout.indexOf(ESCALATION.evidence)).toBeGreaterThan(decision);
    expect(stdout.indexOf(ESCALATION.dead_ends)).toBeGreaterThan(stdout.indexOf(ESCALATION.evidence));
    expect(stdout.indexOf(ESCALATION.why_now)).toBeGreaterThan(stdout.indexOf(ESCALATION.dead_ends));
    expect(stdout.indexOf("Where to look:")).toBeGreaterThan(stdout.indexOf(ESCALATION.why_now));
  });

  it("leaves the run's record exactly as it found it", async () => {
    const repo = initTempRepo("status-read-only-", { "package.json": PACKAGE });
    const dir = await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    const before = ["case.json", "log.jsonl"].map((name) => ({
      text: readFileSync(join(dir, name), "utf-8"),
      touched: statSync(join(dir, name)).mtimeMs,
    }));

    await delivery(["status", "--last"], { cwd: repo });

    expect(
      ["case.json", "log.jsonl"].map((name) => ({
        text: readFileSync(join(dir, name), "utf-8"),
        touched: statSync(join(dir, name)).mtimeMs,
      })),
    ).toEqual(before);
  });

  it("says how to start a run when this repository has never had one, and stops", async () => {
    const repo = initTempRepo("status-empty-", { "package.json": PACKAGE });

    const { stderr, exitCode } = await delivery(["status"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(NOTHING_HERE);
    expect(stderr).not.toContain("    at ");
  });

  it("says how to start a run when the id names nothing, and stops", async () => {
    const repo = initTempRepo("status-unknown-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });

    const { stderr, exitCode } = await delivery(["status", "never-ran-20260101T000000Z"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).toContain('delivery run --task "..."');
    expect(stderr).not.toContain("    at ");
  });

  it("describes itself in the help, and is listed among the commands", async () => {
    const repo = initTempRepo("status-help-", { "package.json": PACKAGE });

    const top = await delivery(["--help"], { cwd: repo });
    const own = await delivery(["status", "--help"], { cwd: repo });

    expect(top.stdout).toContain("status [options] [run-id]");
    expect(own.stdout).toContain("Usage: delivery status");
    expect(own.stdout).toContain("--last");
    expect(own.stdout).toContain("--repo");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/status-command.test.ts -t "delivery status"`
Expected: FAIL — `error: unknown command 'status'` on stderr and `EXIT.configuration` from every test.

- [ ] **Step 3: Write the implementation**

Append to `src/cli/status-command.ts`, and add `resolve` from `node:path`, `EXIT`, `Refusal` and the `ExitCode` type from `./failures.js`, `findRepository` from `./project.js`, and `allRuns`, `NOTHING_HERE`, `readRun` to the existing `./runs.js` import:

```ts
/**
 * What `delivery status` was given on the command line besides the run id.
 * `--last` is accepted and documented as the explicit form of the default, so
 * it is not a field here: with no id at all this command already reports the
 * run touched most recently, and a field nothing reads would invite someone to
 * wire up a second meaning it does not have.
 */
export interface StatusOptions {
  repo?: string;
}

/** The run this command means when no id was given: the one whose record was written most recently, finished or not. */
async function mostRecent(repoPath: string): Promise<RunRecord> {
  const [latest] = await allRuns(repoPath);
  if (latest === undefined) throw new Refusal(NOTHING_HERE, EXIT.configuration);
  return latest;
}

/**
 * `delivery status`: read one run's record and say what happened to it, for
 * whoever was not watching when it ended. It only ever reads, so it is safe to
 * run against a run that is still going, and a run that needed a person is
 * still a successful read: the exit code says whether the report could be
 * made, never what the run itself decided.
 */
export async function statusCommand(runId: string | undefined, options: StatusOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const record = runId === undefined ? await mostRecent(repoPath) : await readRun(repoPath, runId);
  for (const line of await statusReport(record, ctx)) ctx.writeLine(line);
  return EXIT.ok;
}
```

Then register it in `src/cli/program.ts`, after the `resume` command block (line 79) and before the `try`, importing `statusCommand` and its `StatusOptions` type from `./status-command.js`:

```ts
  program
    .command("status")
    .description("say what happened to a run: how it finished, or what decision it needs from you, without changing anything")
    .argument("[run-id]", "the run to read (default: the one touched most recently)")
    .option("--last", "read the run touched most recently, which is also what no run id means")
    .option("--repo <path>", "the git repository the run belongs to (default: the current folder)")
    .action(async (runId: string | undefined, options: StatusOptions, command: Command) => {
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await statusCommand(runId, options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        stdin: io.stdin,
        writeLine: (line) => io.stdout.write(`${line}\n`),
      });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/status-command.test.ts`
Expected: PASS — all thirteen tests, the six from Task 2 included.

- [ ] **Step 5: Commit the command**

```bash
git add src/cli/status-command.ts src/cli/status-command.test.ts src/cli/program.ts
git commit -m "Add delivery status, which reads a run without changing it

An escalation is only useful if the person who must act on it can read it
after the terminal that ran it has gone. status finds the run by id, or the one
touched most recently when no id is given, and prints its report; it never
calls advance and never writes, so it is safe against a run that is still
going. Reading a run that needs a decision is a successful read, so it exits
ok: the escalated exit code belongs to the run itself.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Document the command**

In `README.md`, add a new section immediately after the "Pick up a run that was interrupted" section (which ends with the paragraph about `--fresh`, before "## Configure it once"):

````markdown
## See what happened to a run

To find out how a run ended, in a new terminal or days later:

```bash
delivery status
```

It reads the run touched most recently and says what happened to it. `delivery status <run-id>`
names a run instead, and `delivery status --last` is the explicit form of the default. It only
ever reads: it never moves a run on, so it is safe to run while one is still going.

What you get depends on how the run ended:

- **Finished:** what was done, when it finished, and the branch the work is on.
- **Stopped for a decision:** the decision it needs from you first, then the evidence behind it,
  what had already been tried, why it stopped when it did, and the agent sessions it covers, all
  in the harness's own words. Then where its branch, its working copy and its record are.
- **Stopped for another reason:** why, in plain language.
- **Not finished yet:** what picking it up will carry on with, and the command to do that.

`status` exits 0 whenever it could read the run and 2 when it could not find one, so a run that
needs your decision is still a successful read. The exit codes in the table above are the run's
own, reported by `delivery run`.
````

In `examples/sample-project/README.md`, add a step after the existing step 6 (the one about running `delivery run` again):

````markdown
7. To check on a run later, in a new terminal, run `delivery status` in the same folder. It
   prints what happened without changing anything: if the run needs a decision from you, that
   comes first, with the evidence behind it underneath.
````

- [ ] **Step 7: Confirm the documented commands are the real ones**

Run: `npx vitest run src/cli/status-command.test.ts -t "describes itself in the help"`
Expected: PASS — the command, `--last` and `--repo` are all registered exactly as the README describes them.

- [ ] **Step 8: Check nothing else moved**

Run: `npm run lint && npm test`
Expected: PASS — the new file lints and typechecks under the existing globs, and slices 1 to 3 still
pass, which is what proves `nextStep`, `packetOf` and `unfinishedRuns` were split out rather than
changed. `npm test` builds first, which the slice-1 to slice-3 acceptance tests need because they
drive the compiled command rather than `runCli` in process. If anything here fails, fix it before
committing; do not commit a red suite.

- [ ] **Step 9: Commit the documentation**

```bash
git add README.md examples/sample-project/README.md
git commit -m "Describe delivery status in the readme and the sample project walkthrough

Both documents took a reader from a first run to picking up an interrupted one
and stopped there, which left the one command written for the person who was
not watching undocumented. The sample project's walkthrough gains the same step
the slice's own acceptance test performs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for whoever executes this plan

- **Do not add `--all` or `--json`.** Both are SHOULD-tier and belong to slice 6 of the slice scope. `status` here reports on exactly one run.
- **Do not change what `delivery run` prints at the end of an escalated run.** Its short form (decision, then evidence) is slice 1's, is asserted by `tests/cli-and-configuration/1-*.test.ts` and `src/cli/outcome.test.ts`, and is deliberately shorter than `status`'s: the person at the terminal watched the run happen, and the person reading `status` did not.
- **Do not make `status` advance anything**, including "just to refresh the cursor". The read-only test is there because a report that quietly moved a run on would be worse than no report.
- **Report the worktree discrepancy as spec drift when the slice is marked complete.** The design spec's Diagnosability note and this slice's AC 4 both say an escalated run keeps its working copy for inspection, but `teardownWorktree` (`src/closer-support.ts:41-49`) removes it on every outcome that is not `accepted`, keeping only the branch. Decision 2 above resolves this honestly in `status`, which is the whole of this slice's remit; whoever verifies AC 4 must not read "The agent's working copy has been cleared away." as a failure, and whoever closes the slice should record that the spec, not the code, is the thing that is wrong. Changing the closers is out of scope here: it is library behaviour, it would contradict `summariseOutcome`'s existing "Nothing was changed on `<base>`" copy, and this slice's own constraint is that nothing outside `src/cli/` changes.
