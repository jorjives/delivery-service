// Slice 4: See Exactly What the Agent Will Be Told
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-22 against commit 997d56d
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js) against a throwaway git repository,
// never through the scripted agent, because `delivery preview` never starts
// one — that is the slice's whole point. No claude-mock, no network, no
// sign-in.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CONFIG } from "../../src/cli/validate-command.js";
import { noSuchTask, previewIntro, RULE, SINGLE_TASK, TASK_NUMBER } from "../../src/cli/preview-command.js";
import { NO_TASK } from "../../src/cli/settings.js";
import { EXIT } from "../../src/cli/failures.js";
import { git, runDelivery } from "../helpers.js";

const COMPLETE = {
  domain: "A small tool that greets people by name.",
  tasks: ["add a function that says hello", "add a function that says goodbye", "add a function that waves"],
  gate: { type: "command", command: "npm test", parseMode: "exitcode" },
  closer: { type: "commit-to-branch" },
};

/** A throwaway git repository, seeded the way a UAT walkthrough would set one up. */
function freshRepo(config: unknown, prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample-project", version: "1.0.0" }));
  if (config !== undefined) writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config, null, 2));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function writeConfig(repo: string, config: unknown): void {
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config, null, 2));
}

describe("UAT: see exactly what the agent will be told", () => {
  it("previews the next task's instructions, shows an edited description, then a task by number and a number past the end", () => {
    const repo = freshRepo(COMPLETE, "uat-slice-4-");

    // Step 1: preview the next task.
    const first = runDelivery(["preview"], { cwd: repo });
    expect(first.status).toBe(EXIT.ok);
    const firstLines = first.stdout.split("\n");
    expect(firstLines[0]).toBe(`Next up is Task 1 of 3: ${COMPLETE.tasks[0]}`);
    expect(firstLines[2]).toBe(previewIntro("worker"));
    expect(firstLines[3]).toBe(RULE);
    expect(first.stdout).toContain(COMPLETE.domain);
    expect(first.stdout).toContain(`"intent": "${COMPLETE.tasks[0]}"`);

    // Step 2: reword the description in the file and preview again.
    const reworded = "A tiny tool that greets people warmly by their first name.";
    writeConfig(repo, { ...COMPLETE, domain: reworded });
    const reread = runDelivery(["preview"], { cwd: repo });
    expect(reread.stdout).toContain(reworded);
    expect(reread.stdout).not.toContain(COMPLETE.domain);

    // Step 3: a task chosen by its number shows that task instead.
    const byNumber = runDelivery(["preview", "--queue-index", "3"], { cwd: repo });
    expect(byNumber.status).toBe(EXIT.ok);
    expect(byNumber.stdout.split("\n")[0]).toBe(`Task 3 of 3: ${COMPLETE.tasks[2]}`);
    expect(byNumber.stdout).toContain(`"intent": "${COMPLETE.tasks[2]}"`);

    // Step 4: a number past the end names how many tasks there are.
    const pastEnd = runDelivery(["preview", "--queue-index", "9"], { cwd: repo });
    expect(pastEnd.stderr.trimEnd()).toBe(noSuchTask(9, 3));
    expect(pastEnd.stdout).toBe("");
    expect(pastEnd.status).toBe(EXIT.configuration);
  });
});

describe("acceptance criteria", () => {
  it("shows the gate-maintenance role's instructions", () => {
    const repo = freshRepo(COMPLETE, "uat-slice-4-role-");
    const { stdout, status } = runDelivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain(previewIntro("gate-maintenance"));
  });

  it("previews a single `task` and refuses a task number for it", () => {
    const repo = freshRepo({ ...COMPLETE, tasks: undefined, task: { intent: COMPLETE.tasks[0] } }, "uat-slice-4-single-");
    const preview = runDelivery(["preview"], { cwd: repo });
    expect(preview.stdout.split("\n")[0]).toBe(`Your task: ${COMPLETE.tasks[0]}`);
    expect(preview.status).toBe(EXIT.ok);

    const numbered = runDelivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(numbered.stderr.trimEnd()).toBe(SINGLE_TASK);
    expect(numbered.status).toBe(EXIT.configuration);
  });

  it("gives the same 'no task' message delivery run gives, when the file names no task at all", () => {
    const repo = freshRepo({ ...COMPLETE, tasks: undefined }, "uat-slice-4-notask-");
    const preview = runDelivery(["preview"], { cwd: repo });
    const run = runDelivery(["run"], { cwd: repo });
    expect(preview.stderr.trimEnd()).toBe(NO_TASK);
    expect(preview.stderr.trimEnd()).toBe(run.stderr.trimEnd());
    expect(preview.status).toBe(EXIT.configuration);
  });

  it("rejects a task number that isn't a whole number from 1", () => {
    const repo = freshRepo(COMPLETE, "uat-slice-4-badnum-");
    const { stderr, status } = runDelivery(["preview", "--queue-index", "0"], { cwd: repo });
    expect(stderr).toContain(TASK_NUMBER);
    expect(status).toBe(EXIT.configuration);
  });

  it("gives the same single plain-language message delivery validate gives, for a configuration problem", () => {
    const repo = freshRepo(undefined, "uat-slice-4-noconfig-");
    const validate = runDelivery(["validate"], { cwd: repo });
    const preview = runDelivery(["preview"], { cwd: repo });
    expect(validate.stderr.trimEnd()).toBe(NO_CONFIG);
    expect(preview.stderr.trimEnd()).toBe(validate.stderr.trimEnd());
    expect(preview.stdout).toBe("");
    expect(preview.status).toBe(EXIT.configuration);
  });

  it("uses no harness vocabulary in the preview output", () => {
    const repo = freshRepo(COMPLETE, "uat-slice-4-words-");
    const { stdout } = runDelivery(["preview"], { cwd: repo });
    expect(stdout).not.toMatch(/worktree|envelope|surface|role config/i);
  });
});
