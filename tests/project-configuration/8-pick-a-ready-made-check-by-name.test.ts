// Slice 8: Pick a Ready-Made Check by Name
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-23 against commit e090bae
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js) against a throwaway git repository,
// routed to the vendored scripted agent (TEST_MOCK_SCRIPT) for the one step
// that starts a run, exactly as the UAT's own steps do.

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeMockScript } from "../../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { READY } from "../../src/cli/validate-command.js";
import { git, REPO_ROOT, runDelivery, useScratch } from "../helpers.js";

const TASK = "create a CHANGES.md file with a one-line summary of this project";

const scratch = useScratch();

/** A throwaway git repository, seeded the way the UAT walkthrough sets one up. */
function freshRepo(gate: unknown): string {
  const repo = scratch("uat-slice-8-");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample-project", version: "1.0.0", scripts: { test: "node --test" } }));
  writeFileSync(
    join(repo, "delivery.config.json"),
    JSON.stringify({ domain: "A small tool.", tasks: [TASK], gate, closer: { type: "commit-to-branch" } }, null, 2),
  );
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

/**
 * A scripted turn that writes CHANGES.md, so a run's check has something to find. Kept outside the
 * repository, never inside it: the write fence (Task 11/12) makes the project's own main folder
 * read-only to the agent's session, and claude-mock's journal would otherwise try to write there.
 */
async function mockScriptFor(): Promise<string> {
  const path = join(scratch("uat-slice-8-mock-"), "mock.json");
  await writeMockScript(path, {
    expectations: [
      {
        effects: [{ write: { path: "CHANGES.md", content: "Initial summary of this project.\n" } }],
        json: { status: "completed", rationale: "added CHANGES.md" },
      },
    ],
  });
  return path;
}

describe("UAT: pick a ready-made check by name", () => {
  it(
    "describes the file-exists preset in plain words, runs the task it names, then lists the four names on a misspelling",
    async () => {
      // Step 1: the check is the `file-exists` preset naming a file that does not exist yet.
      const repo = freshRepo({ type: "file-exists", path: "CHANGES.md" });

      // Step 2: `delivery validate` describes the check as "checks that CHANGES.md exists".
      const validated = runDelivery(["validate"], { cwd: repo });
      expect(validated.stdout).toContain("✓ gate: checks that CHANGES.md exists");
      expect(validated.stdout).toContain(READY);
      expect(validated.status).toBe(EXIT.ok);

      // Step 3: the run finishes with the work on a branch containing the new file.
      const env = { ...process.env, [TEST_MOCK_SCRIPT]: await mockScriptFor() };
      const run = runDelivery(["run"], { cwd: repo, env });
      expect(run.stdout).toContain(`passed \`test -f 'CHANGES.md'\``);
      expect(run.stdout).toMatch(/branch surface\/\S+/);
      expect(run.status).toBe(EXIT.ok);
      const branch = /branch (surface\/[^\s.]+)/.exec(run.stdout)?.[1];
      expect(branch).toBeDefined();
      expect(git(repo, ["show", `${branch}:CHANGES.md`])).toContain("Initial summary");

      // Step 4: the preset name is misspelled; validate lists the four valid names in one line.
      const config = JSON.parse(readFileSync(join(repo, "delivery.config.json"), "utf-8"));
      writeConfig(repo, { ...config, gate: { type: "flie-exists", path: "CHANGES.md" } });
      const misspelled = runDelivery(["validate"], { cwd: repo });
      expect(misspelled.stderr.trimEnd()).toBe(
        "I don't know the check `flie-exists`. The ready-made checks are `test-runner`, `file-exists`, `command-succeeds`, `schema-validates` and `commits-ahead`. To write one out in full, see docs/writing-a-gate.md.",
      );
      expect(misspelled.status).toBe(EXIT.configuration);
    },
  );
});

describe("acceptance criteria", () => {
  it("describes each of the four presets in plain words, with only the detail it needs", () => {
    const cases: Array<[unknown, string]> = [
      [{ type: "test-runner" }, "✓ gate: runs your tests with `npm test`"],
      [{ type: "test-runner", command: "npm run test:unit" }, "✓ gate: runs your tests with `npm run test:unit`"],
      [{ type: "file-exists", path: "CHANGES.md" }, "✓ gate: checks that CHANGES.md exists"],
      [{ type: "command-succeeds", command: "npm run lint" }, "✓ gate: checks that `npm run lint` succeeds"],
      [
        { type: "schema-validates", file: "data.json", schema: "data.schema.json" },
        "✓ gate: checks that data.json matches the shape in data.schema.json",
      ],
    ];
    for (const [gate, expected] of cases) {
      const repo = freshRepo(gate);
      const { stdout, status } = runDelivery(["validate"], { cwd: repo });
      expect(stdout).toContain(expected);
      expect(stdout).toContain(READY);
      expect(status).toBe(EXIT.ok);
    }
  });

  it(
    "runs exactly as the equivalent written-out gate would: same check, same outcome, same message",
    async () => {
      const viaPreset = freshRepo({ type: "file-exists", path: "CHANGES.md" });
      const viaWrittenOut = freshRepo({ type: "command", command: "test -f 'CHANGES.md'", parseMode: "exitcode" });

      const presetEnv = { ...process.env, [TEST_MOCK_SCRIPT]: await mockScriptFor() };
      const writtenOutEnv = { ...process.env, [TEST_MOCK_SCRIPT]: await mockScriptFor() };

      const presetRun = runDelivery(["run"], { cwd: viaPreset, env: presetEnv });
      const writtenOutRun = runDelivery(["run"], { cwd: viaWrittenOut, env: writtenOutEnv });

      const stripRunId = (text: string): string => text.replaceAll(/[\w-]*\d{8}T\d{6}Z/g, "<run-id>");
      expect(stripRunId(presetRun.stdout)).toBe(stripRunId(writtenOutRun.stdout));
      expect(presetRun.status).toBe(writtenOutRun.status);
    },
  );

  it("refuses an unknown preset name, and separately a preset missing the one detail it needs", () => {
    const unknown = runDelivery(["validate"], { cwd: freshRepo({ type: "not-a-real-preset" }) });
    expect(unknown.stderr.trimEnd()).toBe(
      "I don't know the check `not-a-real-preset`. The ready-made checks are `test-runner`, `file-exists`, `command-succeeds`, `schema-validates` and `commits-ahead`. To write one out in full, see docs/writing-a-gate.md.",
    );
    expect(unknown.status).toBe(EXIT.configuration);

    const repoMissingDetail = freshRepo({ type: "file-exists" });
    const missingDetail = runDelivery(["validate"], { cwd: repoMissingDetail });
    expect(missingDetail.stderr.trimEnd()).toBe(
      `I can't use ${join(repoMissingDetail, "delivery.config.json")}: the ready-made check \`file-exists\` needs \`path\`, the file that should exist.`,
    );
    expect(missingDetail.status).toBe(EXIT.configuration);
  });

  it("keeps an existing written-out gate definition working unchanged", () => {
    const repo = freshRepo({ type: "command", command: "npm test", parseMode: "exitcode" });
    const { stdout, status } = runDelivery(["validate"], { cwd: repo });
    expect(stdout).toContain("✓ gate: runs `npm test`");
    expect(stdout).toContain(READY);
    expect(status).toBe(EXIT.ok);
  });

  it("shows a preset as the simplest way to choose a check in the project-configuration guide", () => {
    const guide = readFileSync(join(REPO_ROOT, "docs", "project-configuration.md"), "utf-8");
    expect(guide).toContain('{ "gate": { "type": "test-runner" } }');
    expect(guide).toContain("The simplest way to choose one is by name");
    for (const name of ["test-runner", "file-exists", "command-succeeds", "schema-validates"]) expect(guide).toContain(`\`${name}\``);
  });
});
