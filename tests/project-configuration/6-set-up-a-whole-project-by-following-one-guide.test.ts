// Slice 6: Set Up a Whole Project by Following One Guide
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-22 against commit db78ca75fa2f0ca78b1ca2a5f43632fda20ec22b
//
// Drives the compiled `delivery` command as the new adopter described in the UAT
// would: a copy of the shipped `examples/project-configuration-example`, made into
// a throwaway git repository, checked, previewed, and run down its list, then run
// again after adding a task. Routed to the vendored scripted agent (TEST_MOCK_SCRIPT),
// as the getting-started and project-configuration guide tests are, so this needs no
// network, no API key and no real Claude Code sign-in.
//
// This is deliberately independent of tests/project-configuration-guide.md's fidelity
// test (which parses docs/project-configuration.md itself and re-runs its exact
// commands to prove the guide cannot drift from the tool): this file instead asserts
// the UAT's own script and the slice's acceptance criteria directly, so a change to
// the guide's prose cannot silently mask a regression in the underlying behaviour.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockExpectation } from "../../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { git, REPO_ROOT, runDelivery, useScratch } from "../helpers.js";

const EXAMPLE = join(REPO_ROOT, "examples", "project-configuration-example");
const EXAMPLE_CONFIG = JSON.parse(readFileSync(join(EXAMPLE, "delivery.config.json"), "utf-8"));
const RUN_TIMEOUT = 120_000;

const scratch = useScratch();

/** A scripted turn that answers one task by adding a module and its passing test, so `npm test` passes. */
function adds(intent: string, name: string, body: string, check: string): MockExpectation {
  return {
    when: { promptContains: intent },
    effects: [
      { write: { path: `${name}.js`, content: `export const ${name} = ${body};\n` } },
      {
        write: {
          path: `${name}.test.js`,
          content: `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${name} } from "./${name}.js";\n\ntest("${name}", () => ${check});\n`,
        },
      },
    ],
    json: { status: "completed", rationale: `added ${name}.js and its test` },
  };
}

describe("UAT: set up a whole project by following the project-configuration guide", () => {
  it("checks, previews and runs the example's queue in order, then adds a task and runs again", async () => {
    // Step 1: get the example project, as the guide's own "get the example" step does.
    const project = join(scratch("uat-slice-6-"), "text-helpers");
    cpSync(EXAMPLE, project, { recursive: true });
    git(project, ["init", "-q", "-b", "main"]);
    git(project, ["config", "user.email", "harness@example.invalid"]);
    git(project, ["config", "user.name", "Harness"]);
    git(project, ["add", "-A"]);
    git(project, ["commit", "-q", "-m", "Start the example project"]);

    const [first, second] = EXAMPLE_CONFIG.tasks as [string, string];
    const scriptPath = join(scratch("uat-slice-6-script-"), "mock.json");
    await writeMockScript(scriptPath, {
      expectations: [
        adds(first, "slug", '(title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-")', 'assert.equal(slug("Hello World"), "hello-world")'),
        adds(second, "shorten", "(text, length) => text.slice(0, length)", 'assert.equal(shorten("abcdef", 3), "abc")'),
      ],
    });
    const env = { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("uat-slice-6-state-") };

    // Step 2: "check your setup" - `delivery validate` passes, offline, before anything runs.
    const validate = runDelivery(["validate"], { cwd: project, env });
    expect(validate.stderr).toBe("");
    expect(validate.status).toBe(EXIT.ok);
    expect(validate.stdout).toContain("✓ domain description: present");
    expect(validate.stdout).toContain("✓ 2 tasks queued");
    expect(validate.stdout).toContain("Ready to run");

    // Step 3: "see what the agent will be told" - the example's description is in the instructions.
    const preview = runDelivery(["preview"], { cwd: project, env });
    expect(preview.status).toBe(EXIT.ok);
    expect(preview.stdout).toContain(`Next up is Task 1 of 2: ${first}`);
    expect(preview.stdout).toContain(EXAMPLE_CONFIG.domain);

    // Step 4: "run the list" - both tasks close in order, each naming its branch.
    const run = runDelivery(["run"], { cwd: project, env });
    expect(run.status).toBe(EXIT.ok);
    const taskOneIndex = run.stdout.indexOf(`Task 1 of 2: ${first}`);
    const taskTwoIndex = run.stdout.indexOf(`Task 2 of 2: ${second}`);
    expect(taskOneIndex).toBeGreaterThanOrEqual(0);
    expect(taskTwoIndex).toBeGreaterThan(taskOneIndex);
    expect(run.stdout).toMatch(/passed `npm test` and is committed on branch surface\/\S+\./g);
    expect(run.stdout).toContain("Every task on your list is done.");

    // Step 5: "add to the list" - one more sentence, committed, then run again.
    const third = "add a function that counts the words in a sentence, with a test";
    const edited = { ...EXAMPLE_CONFIG, tasks: [...EXAMPLE_CONFIG.tasks, third] };
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify(edited, null, 2) + "\n");
    git(project, ["commit", "-q", "-am", "Add a task to the list"]);

    await writeMockScript(scriptPath, {
      expectations: [adds(third, "countWords", '(sentence) => sentence.split(" ").length', 'assert.equal(countWords("one two three"), 3)')],
    });
    const secondRun = runDelivery(["run"], { cwd: project, env });
    expect(secondRun.status).toBe(EXIT.ok);
    expect(secondRun.stdout).toContain(`Task 3 of 3: ${third}`);
    expect(secondRun.stdout).not.toMatch(/^Task [12] of 3/m);
    expect(secondRun.stdout).toContain("Every task on your list is done.");
  }, RUN_TIMEOUT * 2);
});

describe("acceptance criteria", () => {
  it("ships a second example project with a description, at least two tasks and one worker override", () => {
    expect(typeof EXAMPLE_CONFIG.domain).toBe("string");
    expect(EXAMPLE_CONFIG.domain.trim().length).toBeGreaterThan(0);
    expect(Array.isArray(EXAMPLE_CONFIG.tasks)).toBe(true);
    expect(EXAMPLE_CONFIG.tasks.length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLE_CONFIG.roles?.worker).toBeDefined();
  });

  it("leaves the original sample project working unchanged, as the no-configuration first run", () => {
    // The getting-started guide's own sample project must still exist and carry no
    // delivery.config.json, since getting-started depends on it as the no-config case.
    const sample = mkdtempSync(join(tmpdir(), "uat-slice-6-sample-check-"));
    cpSync(join(REPO_ROOT, "examples", "sample-project"), sample, { recursive: true });
    git(sample, ["init", "-q", "-b", "main"]);
    git(sample, ["config", "user.email", "harness@example.invalid"]);
    git(sample, ["config", "user.name", "Harness"]);
    git(sample, ["add", "-A"]);
    git(sample, ["commit", "-q", "-m", "seed"]);
    const validate = runDelivery(["validate"], { cwd: sample });
    expect(validate.status).toBe(EXIT.configuration);
  });

  it("points to the new guide from getting started, and links extenders on to the gate, closer and role guides", () => {
    const gettingStarted = readFileSync(join(REPO_ROOT, "docs", "getting-started.md"), "utf-8");
    expect(gettingStarted).toContain("project-configuration.md");

    const guide = readFileSync(join(REPO_ROOT, "docs", "project-configuration.md"), "utf-8");
    for (const doc of ["writing-a-gate.md", "writing-a-closer.md", "configuring-a-role.md"]) expect(guide).toContain(doc);
    // Fenced blocks are the command's own output (e.g. branch names like `surface/<run-id>`);
    // the vocabulary ban applies to the guide's prose, not the tool's own naming.
    const prose = guide.replace(/```[\s\S]*?```/g, "").toLowerCase();
    for (const word of ["worktree", "envelope", "surface", "case file", "role config"]) {
      expect(prose).not.toContain(word);
    }
  });

  it("records the release as additive in a changeset naming the new guide", () => {
    const changesets = readFileSync(
      join(REPO_ROOT, ".changeset", "set-up-a-whole-project-from-one-guide.md"),
      "utf-8",
    );
    expect(changesets).toContain('"delivery-service": minor');
    expect(changesets).toContain("docs/project-configuration.md");
  });
});
