// Slice 7: Set Up a Project by Answering a Few Questions
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-17 against commit b9d748f
// Updated: Project Configuration slice 7 added the description question first
// and writes tasks as a list; the answers still reach the next run unflagged.
//
// `delivery init`'s questions cannot be driven through a real terminal here (no
// pty, and the command reads the process's own stdin/stdout regardless of what a
// test passes it: src/cli/prompts.ts talks to "this process's terminal" when
// given no streams). The project's own architecture already draws the seam
// where that matters: `initCommand` takes the `Ask` that does the asking, so
// this recording drives that seam directly with a scripted `Ask` — exactly what
// a person answering the prompts would supply — against a real sample-project
// copy, then a real subprocess `delivery run` (tests/helpers.ts's runDelivery,
// over the compiled dist/cli/main.js, agent routed to the vendored scripted
// agent) to prove the written file is what the next run actually reads. The one
// step that needs no interactivity — refusing outside a terminal — is driven as
// a genuine subprocess, since spawnSync's piped stdin is never a tty.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { BUILT_IN_CLOSERS, loadConfig } from "../../src/cli/config.js";
import { EXIT } from "../../src/cli/failures.js";
import { context, scriptedAsk } from "../../src/cli/init-fixtures.js";
import {
  CLOSER_QUESTION,
  CONFIG_FILE,
  initCommand,
  LEFT_ALONE,
  NEEDS_A_TERMINAL,
  WRITTEN,
  type ChoiceQuestion,
  type TextQuestion,
} from "../../src/cli/init.js";
import { DEFAULT_CLOSER, resolveProject } from "../../src/cli/settings.js";
import { queueTasks } from "../../src/cli/queue.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const TASK = "add a function that says hello to a name, with a test";

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-7-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-7-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-7-sample-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

const completes = (path: string, content: string): MockScript => ({
  expectations: [{ effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } }],
});

describe("UAT: set up a project for the harness by answering questions instead of writing a file", () => {
  it(
    "accepts the suggested check, commits to a branch, and a run afterwards with no flags uses the answers",
    async () => {
      const repo = sampleProjectCopy();

      // Step 1 & 2: type `delivery init`, accept the suggested check, choose
      // "commit to a branch" and type a first task.
      const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, TASK] });
      const { ctx, lines } = context(repo);
      expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

      // Plain-English questions: what the project is (skipped here), the check
      // (offering the project's own `npm test`), the three closing actions with
      // their one-line descriptions, defaulting to committing to a branch, then
      // the first task and "anything else", answered with Enter.
      expect(asked).toHaveLength(5);
      const [, checkAsked, closerAsked, taskAsked] = asked as [TextQuestion, TextQuestion, ChoiceQuestion, TextQuestion];
      expect(checkAsked.default).toBe("npm test");
      expect(closerAsked).toEqual(CLOSER_QUESTION);
      expect(closerAsked.choices.map((c) => c.value).sort()).toEqual([...BUILT_IN_CLOSERS].sort());
      expect(closerAsked.choices.every((c) => c.description.length > 0)).toBe(true);
      expect(closerAsked.default).toBe(DEFAULT_CLOSER.type);
      expect(taskAsked.message).toContain("first thing you'd like done");

      // Step 3: open the delivery.config.json it created and read it. A config
      // file containing exactly the answers given (Enter for the check, the
      // default closer, and the typed task).
      const file = CONFIG_FILE(repo);
      expect(lines).toEqual([WRITTEN(file)]);
      expect(JSON.parse(readFileSync(file, "utf-8"))).toMatchObject({
        tasks: [TASK],
        gate: { type: "command", command: "npm test", parseMode: "exitcode" },
        closer: { type: "commit-to-branch" },
      });

      // Step 4: type `delivery run` with nothing else and let it finish. A run
      // that uses the written file and finishes with its branch named.
      const env = {
        ...process.env,
        XDG_STATE_HOME: scratchState(),
        [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = (name) => `hello ${name}`;\n")),
      };
      const run = runDelivery(["run"], { cwd: repo, env });
      expect(run.status).toBe(EXIT.ok);
      expect(run.stdout).toMatch(/branch surface\/\S+/);
    },
  );
});

describe("AC: when a config file already exists, it asks before overwriting and leaves the file untouched if declined", () => {
  it("asks nothing else and writes nothing when the answer is no", async () => {
    const repo = sampleProjectCopy();
    const file = CONFIG_FILE(repo);
    writeFileSync(file, '{"placeholder": true}\n');

    const { ask, asked } = scriptedAsk({ confirm: false });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(asked).toHaveLength(1);
    expect(lines).toEqual([LEFT_ALONE(file)]);
    expect(readFileSync(file, "utf-8")).toBe('{"placeholder": true}\n');
  });
});

describe("AC: run outside an interactive terminal, it stops with a plain-language message saying it needs one", () => {
  it("refuses on a real subprocess whose stdin is never a tty", () => {
    const repo = sampleProjectCopy();
    const run = runDelivery(["init"], { cwd: repo, env: process.env });

    expect(run.status).toBe(EXIT.configuration);
    expect(run.stderr).toContain(NEEDS_A_TERMINAL);
    expect(existsSync(CONFIG_FILE(repo))).toBe(false);
  });
});

describe("AC: it asks for a first task in plain language and writes a config file containing the chosen check, closer and task", () => {
  it("writes a check typed by hand and the merge-back closer when those are chosen instead", async () => {
    const repo = mkdtempSync(join(tmpdir(), "uat-slice-7-nocheck-"));
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "scratch", private: true }));

    const { ask, asked } = scriptedAsk({ texts: [undefined, "npm run check", TASK], choice: "merge-back" });
    const { ctx } = context(repo);
    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    // No test script to infer, so the check question offers no default.
    const [, checkAsked] = asked as [TextQuestion, TextQuestion];
    expect(checkAsked.default).toBeUndefined();

    const config = await loadConfig({ startDir: repo, repoPath: repo, flag: undefined, env: {} });
    const project = await resolveProject({}, { env: {}, repoPath: repo, config });
    expect(project.gateRef).toEqual({ type: "command", command: "npm run check", parseMode: "exitcode" });
    expect(project.closerRef).toEqual({ type: "merge-back" });
    expect(queueTasks(config)).toEqual([{ intent: TASK }]);
  });
});
