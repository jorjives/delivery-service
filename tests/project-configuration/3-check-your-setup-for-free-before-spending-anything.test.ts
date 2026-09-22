// Slice 3: Check Your Setup for Free Before Spending Anything
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-22 against commit a8d05b5
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js) against a throwaway git repository,
// never through the scripted agent, because `delivery validate` never starts
// one — that is the whole point of the slice. No claude-mock, no network, no
// sign-in: this file proves that by never wiring any of them up.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../../src/git-env.js";
import { NO_CONFIG, READY } from "../../src/cli/validate-command.js";
import { BOTH_TASK_AND_TASKS, sameTask } from "../../src/cli/config.js";
import { EXIT } from "../../src/cli/failures.js";
import { git, runDelivery } from "../helpers.js";

const COMPLETE = {
  domain: "A small tool that greets people by name.",
  tasks: ["add a function that says hello", "add a function that says goodbye", "add a function that waves"],
  gate: { type: "command", command: "npm test", parseMode: "exitcode" },
  closer: { type: "commit-to-branch" },
};

/** A throwaway git repository, seeded the way a UAT walkthrough would set one up. */
function freshRepo(config: unknown, files: Record<string, string> = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-3-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample-project", version: "1.0.0" }));
  if (config !== undefined) writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config, null, 2));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content);
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

describe("UAT: check your setup for free before spending anything", () => {
  it("ticks off a ready project, catches an emptied task, catches a duplicated task, then ticks again once restored", () => {
    const repo = freshRepo(COMPLETE);

    // Step 1: a complete project validates cleanly.
    const ready = runDelivery(["validate"], { cwd: repo });
    expect(ready.stdout).toBe(
      [
        "Checking delivery.config.json…",
        "✓ domain description: present",
        "✓ 3 tasks queued",
        "✓ gate: runs `npm test`",
        "✓ closer: commits to a new branch",
        READY,
        "",
      ].join("\n"),
    );
    expect(ready.status).toBe(EXIT.ok);

    // Step 2: the second task's sentence is replaced with empty quotes.
    writeConfig(repo, { ...COMPLETE, tasks: [COMPLETE.tasks[0], "", COMPLETE.tasks[2]] });
    const emptied = runDelivery(["validate"], { cwd: repo });
    expect(emptied.stderr).toContain("`tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.");
    expect(emptied.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(emptied.stdout).not.toContain(READY);
    expect(emptied.status).toBe(EXIT.configuration);

    // Step 3: the sentence is put back, then the first task's sentence is copied over the third.
    writeConfig(repo, { ...COMPLETE, tasks: [COMPLETE.tasks[0], COMPLETE.tasks[1], COMPLETE.tasks[0]] });
    const duplicated = runDelivery(["validate"], { cwd: repo });
    expect(duplicated.stderr).toContain(sameTask(1, 3));
    expect(duplicated.stdout).not.toContain(READY);
    expect(duplicated.status).toBe(EXIT.configuration);

    // Step 4: the file is restored.
    writeConfig(repo, COMPLETE);
    const restored = runDelivery(["validate"], { cwd: repo });
    expect(restored.stdout).toContain(READY);
    expect(restored.status).toBe(EXIT.ok);

    // At no point did validate start a run: no run records exist, and the
    // working tree carries only the config edits the walkthrough itself made.
    expect(() => readdirSync(join(repo, ".delivery"))).toThrow();
  });
});

describe("acceptance criteria", () => {
  it("reports every refusal validate is responsible for, in one plain line with the configuration exit code", () => {
    const cases: Array<[string, unknown, string]> = [
      ["an empty description", { ...COMPLETE, domain: "  " }, "`domain` is empty. Describe your project in a sentence or two, or remove it."],
      ["an empty list", { ...COMPLETE, tasks: [] }, "`tasks` is empty. Add at least one sentence describing what you want done"],
      ["both a single task and a list", { ...COMPLETE, task: { intent: "add a page" } }, BOTH_TASK_AND_TASKS],
    ];
    for (const [, config, expectedFragment] of cases) {
      const repo = freshRepo(config);
      const { stdout, stderr, status } = runDelivery(["validate"], { cwd: repo });
      expect(stderr).toContain(expectedFragment);
      expect(stderr.trimEnd().split("\n")).toHaveLength(1);
      expect(stdout).not.toContain(READY);
      expect(status).toBe(EXIT.configuration);
    }
  });

  it("names a custom gate module that can't be loaded", () => {
    const repo = freshRepo({ ...COMPLETE, gate: { type: "custom", modulePath: "./gate.mjs" } });
    const { stdout, stderr, status } = runDelivery(["validate"], { cwd: repo });
    expect(stderr).toContain("Couldn't load the custom gate at `./gate.mjs`");
    expect(stdout).not.toContain(READY);
    expect(status).toBe(EXIT.configuration);
  });

  it("names a custom closer module that can't be loaded", () => {
    const repo = freshRepo({ ...COMPLETE, closer: { type: "custom", modulePath: "./closer.mjs" } });
    const { stdout, stderr, status } = runDelivery(["validate"], { cwd: repo });
    expect(stderr).toContain("Couldn't load the custom closer at `./closer.mjs`");
    expect(stdout).not.toContain(READY);
    expect(status).toBe(EXIT.configuration);
  });

  it("says there is no config file, and points to delivery init and the getting-started guide", () => {
    const repo = freshRepo(undefined);
    const { stdout, stderr, status } = runDelivery(["validate"], { cwd: repo });
    expect(stderr.trimEnd()).toBe(NO_CONFIG);
    expect(stderr).toContain("delivery init");
    expect(stderr).toContain("getting-started");
    expect(stdout).toBe("");
    expect(status).toBe(EXIT.configuration);
  });

  it("succeeds with no Claude Code executable or sign-in reachable, and leaves the repository and its run records untouched", () => {
    const repo = freshRepo(COMPLETE);
    const before = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() });

    // No CLAUDE_CODE_* / ANTHROPIC_* credentials on the child's environment at
    // all — a bare PATH is the closest a subprocess test gets to "no agent
    // runtime installed". If validate ever reached for one, this would surface
    // as a crash rather than a silent pass.
    const bareEnv = { PATH: process.env.PATH ?? "" };
    const { stdout, status } = runDelivery(["validate"], { cwd: repo, env: bareEnv });

    expect(stdout).toContain(READY);
    expect(status).toBe(EXIT.ok);
    const after = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() });
    expect(after).toBe(before);
    expect(() => readdirSync(join(repo, ".delivery"))).toThrow();
  });

  it("accepts the same --repo and --config options delivery run does", () => {
    const repo = freshRepo(COMPLETE);
    const elsewhere = mkdtempSync(join(tmpdir(), "uat-slice-3-elsewhere-"));

    const viaRepo = runDelivery(["validate", "--repo", repo], { cwd: elsewhere });
    expect(viaRepo.stdout).toContain(READY);
    expect(viaRepo.status).toBe(EXIT.ok);

    rmSync(join(repo, "delivery.config.json"));
    mkdirSync(join(repo, "config"), { recursive: true });
    writeFileSync(join(repo, "config", "custom.json"), JSON.stringify(COMPLETE, null, 2));
    const viaConfig = runDelivery(["validate", "--config", "config/custom.json"], { cwd: repo });
    expect(viaConfig.stdout.split("\n")[0]).toBe("Checking config/custom.json…");
    expect(viaConfig.stdout).toContain(READY);
    expect(viaConfig.status).toBe(EXIT.ok);
  });

  it("validates cleanly against an existing four-setting file from before descriptions and lists", () => {
    const repo = freshRepo({
      task: { intent: "add a function that says hello" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
      budgets: { correction: 5 },
    });
    const { stdout, status } = runDelivery(["validate"], { cwd: repo });
    expect(stdout).toContain("✓ domain description: none (it's optional)");
    expect(stdout).toContain("✓ 1 task, set in `task`");
    expect(stdout).toContain("✓ closer: merges into your base branch");
    expect(stdout).toContain(READY);
    expect(status).toBe(EXIT.ok);
  });
});
