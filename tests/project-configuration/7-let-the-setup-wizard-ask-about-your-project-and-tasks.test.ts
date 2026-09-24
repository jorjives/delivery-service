// Slice 7: Let the Setup Wizard Ask About Your Project and Tasks
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-23 against commit d583e21
//
// `delivery init`'s questions cannot be driven through a real terminal here (no
// pty, and the command reads the process's own stdin/stdout regardless of what a
// test passes it). This file drives the seam the wizard is built on instead
// (`initCommand`'s `Ask`, from src/cli/init-fixtures.ts) with a scripted `Ask` —
// exactly what a person answering the prompts would supply — against a real
// sample-project copy, then drives real subprocess `delivery validate`,
// `delivery preview` and `delivery run` (tests/helpers.ts's runDelivery, over
// the compiled dist/cli/main.js, agent routed to the vendored scripted agent
// for the run) to prove the written file is what those commands actually read.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { context, scriptedAsk } from "../../src/cli/init-fixtures.js";
import { CONFIG_FILE, DESCRIPTION_QUESTION, LEFT_ALONE, NOTHING_TO_DO, WRITTEN, initCommand } from "../../src/cli/init.js";
import { READY } from "../../src/cli/validate-command.js";
import { REPO_ROOT, git, runDelivery } from "../helpers.js";

const DESCRIPTION = "A small tool that greets people by name, in French.";
const TASK_1 = "Add a function that greets a person by name, with a test.";
const TASK_2 = "Write a README section explaining how to run the tests.";

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-7-state-"));
}

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-7-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
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

describe("UAT: set up a whole small project by answering questions", () => {
  it(
    "writes a description and two tasks, validates and previews cleanly, and runs the first task",
    async () => {
      const repo = sampleProjectCopy();

      // Step 1 & 2: `delivery init`; describe the project, accept the suggested
      // check and closing action, then enter two tasks and press Enter to stop.
      const { ask, asked } = scriptedAsk({ texts: [DESCRIPTION, undefined, TASK_1, TASK_2] });
      const { ctx, lines } = context(repo);
      expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

      const file = CONFIG_FILE(repo);
      expect(lines).toEqual([WRITTEN(file)]);
      expect(asked[0]).toBe(DESCRIPTION_QUESTION);
      expect(JSON.parse(readFileSync(file, "utf-8"))).toMatchObject({
        domain: DESCRIPTION,
        tasks: [TASK_1, TASK_2],
        gate: { type: "command", command: "npm test", parseMode: "exitcode" },
        closer: { type: "commit-to-branch" },
      });

      // Step 3: `delivery validate`, then `delivery preview`.
      const validate = runDelivery(["validate"], { cwd: repo });
      expect(validate.status).toBe(EXIT.ok);
      expect(validate.stdout).toContain("✓ domain description: present");
      expect(validate.stdout).toContain("✓ 2 tasks queued");
      expect(validate.stdout).toContain(READY);

      const preview = runDelivery(["preview"], { cwd: repo });
      expect(preview.status).toBe(EXIT.ok);
      expect(preview.stdout).toContain(DESCRIPTION);
      expect(preview.stdout).toContain(TASK_1);

      // The written file can be run immediately, with no flags.
      const env = {
        ...process.env,
        XDG_STATE_HOME: scratchState(),
        [TEST_MOCK_SCRIPT]: await scriptFile(completes("greet.js", "export const greet = (name) => `Bonjour ${name}`;\n")),
      };
      const run = runDelivery(["run"], { cwd: repo, env });
      expect(run.status).toBe(EXIT.ok);
      expect(run.stdout).toContain("Task 1 of 2");
      expect(run.stdout).toMatch(/branch surface\/\S+/);
    },
  );
});

describe("acceptance criteria", () => {
  it("skips the description when the answer is left blank, leaving it out of the file", async () => {
    const repo = sampleProjectCopy();
    const { ask } = scriptedAsk({ texts: ["", undefined, TASK_1] });
    const { ctx } = context(repo);
    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    const config = JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"));
    expect(config).not.toHaveProperty("domain");
    expect(config.tasks).toEqual([TASK_1]);
  });

  it("asks for tasks one at a time, refusing a blank first answer and a repeat, until a blank answer stops it", async () => {
    const repo = sampleProjectCopy();
    // Blank first task is refused (NOTHING_TO_DO); then a task; then that same
    // task again is refused (ALREADY_LISTED); then a second, different task;
    // then a blank answer, which now stops the list rather than being refused.
    const { ask, asked, refused } = scriptedAsk({ texts: [DESCRIPTION, undefined, "", TASK_1, TASK_1, TASK_2, ""] });
    const { ctx } = context(repo);
    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(refused).toEqual([NOTHING_TO_DO, "You've already said that one. Say something different."]);
    const config = JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"));
    expect(config.tasks).toEqual([TASK_1, TASK_2]);
    // One task, entered alone, is still written as a one-entry list, not the
    // singular `task` field.
    expect(asked.some((q) => "message" in q && q.message.includes("first thing"))).toBe(true);
  });

  it("uses everyday words in every question, with none of the harness's internal vocabulary", () => {
    const forbidden = ["domain", "queue", "intent", "gate", "closer", "worktree", "envelope", "surface", "case file", "role config", "schema"];
    const questionText = [
      DESCRIPTION_QUESTION.message,
      "What's the first thing you'd like done? Say it the way you'd say it to a colleague.",
      "What else would you like done? Press Enter when that's everything.",
    ].join(" ");
    for (const word of forbidden) expect(questionText.toLowerCase()).not.toContain(word);
  });

  it("leaves an existing configuration file untouched when declining to overwrite it", async () => {
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
