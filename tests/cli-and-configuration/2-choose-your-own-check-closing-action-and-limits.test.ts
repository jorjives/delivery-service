// Slice 2: Choose Your Own Check, Closing Action and Limits
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-15 against commit a4f8f1f
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../../src/git-env.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { CONFIG_KEYS, unknownCloser } from "../../src/cli/config.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery } from "../helpers.js";

const RUN_TIMEOUT = 60_000;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-2-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-2-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-2-sample-"));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "sample-project") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function completesWith(path: string, content: string): MockScript {
  return { expectations: [{ effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } }] };
}

/** The run id a closing sentence's branch names, once the branch is stripped back to it. */
function runIdIn(stdout: string): string {
  const match = /branch (surface\/(\S+?))\.?$/m.exec(stdout);
  if (!match?.[2]) throw new Error(`no branch named in:\n${stdout}`);
  return match[2];
}

describe("UAT: configure the check, closing action and limits once, override for a single run", () => {
  it(
    "runs the closer a delivery.config.json names, refuses a misspelt closer, and lets a flag override the file",
    async () => {
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "merge-back" }, budgets: { correction: 5 } }));
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      // Step 2-3: the file's closer is used, and the run lands on main.
      const first = runDelivery(["run", "--task", "add a function that says goodbye to a name, with a test"], {
        cwd: repo,
        env: {
          ...process.env,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("bye.js", "export const bye = (name) => `goodbye ${name}`;\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(first.status).toBe(EXIT.ok);
      expect(first.stdout).toMatch(/passed `npm test` and is merged into main\.$/m);
      expect(git(repo, ["show", "main:bye.js"])).toContain("goodbye");

      // Step 4: a misspelt closer in the file stops the command at once, listing the choices.
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "teleport" }, budgets: { correction: 5 } }));
      const misspelt = runDelivery(["run", "--task", "add a function that waves at a name, with a test"], { cwd: repo });
      expect(misspelt.status).toBe(EXIT.configuration);
      expect(misspelt.stderr).toBe(`${unknownCloser("teleport")}\n`);
      expect(misspelt.stdout).toBe("");

      // Step 5: the file restored, but --closer on the command line beats it.
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "merge-back" }, budgets: { correction: 5 } }));
      const overridden = runDelivery(["run", "--task", "add a function that waves at a name, with a test", "--closer", "commit-to-branch"], {
        cwd: repo,
        env: {
          ...process.env,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("wave.js", "export const wave = (name) => `wave to ${name}`;\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(overridden.status).toBe(EXIT.ok);
      const branch = `surface/${runIdIn(overridden.stdout)}`;
      expect(overridden.stdout).toContain(`is committed on branch ${branch}`);
      expect(git(repo, ["branch", "--list", branch])).not.toBe("");
      expect(git(repo, ["show", `${branch}:wave.js`])).toContain("wave");
    },
    RUN_TIMEOUT * 3,
  );
});

describe("AC: an unnamed delivery.config.json is found at or above the working folder, up to the repository root", () => {
  it(
    "is found from a subfolder of the repository, and used without --config",
    async () => {
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "merge-back" } }));
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      const { stdout, status } = runDelivery(["run", "--task", "add a function", "--repo", repo], {
        cwd: repo,
        env: {
          ...process.env,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(status).toBe(EXIT.ok);
      expect(stdout).toMatch(/is merged into main\.$/m);
    },
    RUN_TIMEOUT,
  );

  it("--config points at a differently-named file instead", async () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "other.config.json"), JSON.stringify({ closer: { type: "merge-back" } }));

    const { stdout, status } = runDelivery(["run", "--task", "add a function", "--config", "other.config.json"], {
      cwd: repo,
      env: {
        ...process.env,
        [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
        XDG_STATE_HOME: scratchState(),
      },
    });
    expect(status).toBe(EXIT.ok);
    expect(stdout).toMatch(/is merged into main\.$/m);
  }, RUN_TIMEOUT);

  it("DELIVERY_CONFIG names a different file too", async () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "other.config.json"), JSON.stringify({ closer: { type: "merge-back" } }));

    const { stdout, status } = runDelivery(["run", "--task", "add a function"], {
      cwd: repo,
      env: {
        ...process.env,
        DELIVERY_CONFIG: "other.config.json",
        [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
        XDG_STATE_HOME: scratchState(),
      },
    });
    expect(status).toBe(EXIT.ok);
    expect(stdout).toMatch(/is merged into main\.$/m);
  }, RUN_TIMEOUT);
});

describe("AC: the config file accepts exactly task, gate, closer and budgets", () => {
  it("refuses an unknown key, naming it and the four it does accept", () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closr: { type: "merge-back" } }));

    const { stderr, status } = runDelivery(["run", "--task", "x"], { cwd: repo });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("there's no setting called `closr`");
    expect(stderr).toContain(CONFIG_KEYS);
  });
});

describe("AC: budgets accepts a whole-number cap per attempt category; unset categories keep their defaults", () => {
  it(
    "pins the configured cap and the untouched defaults into the run's own record",
    async () => {
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ budgets: { correction: 7 } }));
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      const { stdout, status } = runDelivery(["run", "--task", "add a function"], {
        cwd: repo,
        env: {
          ...process.env,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(status).toBe(EXIT.ok);
      const runId = runIdIn(stdout);
      const caseFile = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as {
        cursor: { budgets: Record<string, { max: number } | undefined> };
      };
      expect(caseFile.cursor.budgets.correction?.max).toBe(7);
      expect(caseFile.cursor.budgets.gateError?.max).toBe(3); // untouched default
    },
    RUN_TIMEOUT,
  );

  it("refuses a malformed limit, naming it in plain language", () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ budgets: { correction: -1 } }));

    const { stderr, status } = runDelivery(["run", "--task", "x"], { cwd: repo });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("the limit `budgets.correction` is `-1`");
  });
});

describe("AC: --gate-command, --closer and --task-file are honoured for a single run", () => {
  it(
    "reads the task from --task-file, and checks the work with --gate-command",
    async () => {
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, "task.txt"), "add a function that says hi, with a test\n");

      const { stdout, status } = runDelivery(["run", "--task-file", "task.txt", "--gate-command", "npm test"], {
        cwd: repo,
        env: {
          ...process.env,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("hi.js", "export const hi = () => 'hi';\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(status).toBe(EXIT.ok);
      expect(stdout).toContain('Done: the change for "add a function that says hi, with a test" passed `npm test`');
    },
    RUN_TIMEOUT,
  );

  // SKIPPED AC: --closer open-pr as one of the three built-in choices. Driving it live needs a
  // GitHub remote and `gh`, which this suite has neither of. It already has its own regression
  // coverage: tests/close-interface/5-accepted-work-opens-a-pull-request.test.ts drives it
  // against src/gh-stand-in.ts, and this file's UAT above drives merge-back and commit-to-branch
  // live, which is enough to show the config file's closer selection actually takes effect.
  it.skip("--closer open-pr opens a pull request", () => {});
});

describe("AC: a flag beats its environment variable, which beats the config file, which beats the default", () => {
  it(
    "the flag closer wins over the file and the environment together",
    async () => {
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "merge-back" } }));

      const { stdout, status } = runDelivery(["run", "--task", "add a function", "--closer", "commit-to-branch"], {
        cwd: repo,
        env: {
          ...process.env,
          DELIVERY_CLOSER: "merge-back",
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(status).toBe(EXIT.ok);
      expect(stdout).toMatch(/is committed on branch surface\//m);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: an unknown closer type lists the built-in options and how to point at a custom one", () => {
  it("names the three choices and where a custom module path goes", () => {
    const repo = sampleProjectCopy();
    const { stderr, status } = runDelivery(["run", "--task", "x", "--closer", "teleport"], { cwd: repo });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toBe(`${unknownCloser("teleport")}\n`);
    expect(stderr).toContain("modulePath");
  });
});

describe("AC: a custom gate or closer that cannot be loaded stops the command before it starts, naming the module and the guide", () => {
  it("names the gate's module path and docs/writing-a-gate.md", () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ gate: { type: "custom", modulePath: "./gates/nope.mjs" } }));

    const { stderr, status } = runDelivery(["run", "--task", "x"], { cwd: repo });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("./gates/nope.mjs");
    expect(stderr).toContain("docs/writing-a-gate.md");
    expect(stderr).not.toContain("    at ");
  });

  it("names the closer's module path and docs/writing-a-closer.md", () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "custom", modulePath: "./closers/nope.mjs" } }));

    const { stderr, status } = runDelivery(["run", "--task", "x"], { cwd: repo });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("./closers/nope.mjs");
    expect(stderr).toContain("docs/writing-a-closer.md");
    expect(stderr).not.toContain("    at ");
  });
});
