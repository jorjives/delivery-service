// Project configuration, slice 6: a new adopter sets up a whole project by following
// docs/project-configuration.md in examples/project-configuration-example. This runs
// the guide's own commands, in the guide's order, against the compiled command and a
// copy of the example, and checks that what the guide says you will see is what the
// command prints, so the guide cannot drift from the tool. The agent is routed to the
// vendored scripted agent, as in tests/getting-started-guide.test.ts, so this needs
// no network and no sign-in.

import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { writeMockScript, type MockExpectation } from "../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { readConfig, type DeliveryConfig } from "../src/cli/config.js";
import { EXIT } from "../src/cli/failures.js";
import { allRuns } from "../src/cli/runs.js";
import { documented, git, outputBlock, REPO_ROOT, runDelivery, sectionOf, useScratch } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/project-configuration.md"), "utf-8");
const EXAMPLE = join(REPO_ROOT, "examples", "project-configuration-example");
const RUN_TIMEOUT = 120_000;

const STEP = {
  get: "## 1. Get the example project",
  describe: "## 2. Describe your project",
  list: "## 3. List what you want done",
  check: "## 4. Choose how the work is checked, and what happens to it",
  tools: "## 5. Decide what the agent may do",
  validate: "## 6. Check your setup",
  preview: "## 7. See what the agent will be told",
  run: "## 8. Run the list",
  add: "## 9. Add to the list",
  further: "## Going further",
} as const;

const scratch = useScratch();

/** A guide section's first ```json block, parsed: a configuration file as the guide shows it. */
function jsonBlock(section: string): DeliveryConfig {
  const match = /```json\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) throw new Error(`no \`\`\`json block in:\n${section}`);
  return JSON.parse(match[1]) as DeliveryConfig;
}

/**
 * The first line the guide shows that the command did not print, in the guide's
 * order, or nothing when every line is there. A line of just "…" marks where the
 * guide leaves out a long middle, and matches nothing itself.
 */
function missingFrom(stdout: string, lines: string[]): string | undefined {
  let rest = stdout;
  for (const line of lines) {
    if (line === "…") continue;
    const match = documented(line).exec(rest);
    if (!match) return line;
    rest = rest.slice(match.index + match[0].length);
  }
  return undefined;
}

/** A scripted turn that answers one task by adding a module and its passing test, so the example's `npm test` passes. */
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

type Result = ReturnType<typeof runDelivery>;
let config: DeliveryConfig;
let edited: DeliveryConfig;
let project: string;
let validate: Result;
let preview: Result;
let firstRun: Result;
let secondRun: Result;

beforeAll(async () => {
  config = await readConfig(join(EXAMPLE, "delivery.config.json"));
  edited = jsonBlock(sectionOf(guide, STEP.add, STEP.further));
  const [first, second, added] = edited.tasks as [string, string, string];

  // Step 1, as written: copy the example and make it a repository.
  project = join(scratch("project-config-guide-"), "text-helpers");
  cpSync(EXAMPLE, project, { recursive: true });
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "user.email", "harness@example.invalid"]);
  git(project, ["config", "user.name", "Harness"]);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-q", "-m", "Start the example project"]);

  const scriptPath = join(scratch("project-config-guide-script-"), "mock.json");
  await writeMockScript(scriptPath, {
    expectations: [
      adds(first, "slug", '(title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-")', 'assert.equal(slug("Hello World"), "hello-world")'),
      adds(second, "shorten", "(text, length) => text.slice(0, length)", 'assert.equal(shorten("abcdef", 3), "abc")'),
      adds(added, "countWords", '(sentence) => sentence.split(" ").length', 'assert.equal(countWords("one two three"), 3)'),
    ],
  });
  const env = { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("project-config-guide-state-") };

  // Steps 6 to 8, as written.
  validate = runDelivery(["validate"], { cwd: project, env });
  preview = runDelivery(["preview"], { cwd: project, env });
  firstRun = runDelivery(["run"], { cwd: project, env });

  // Step 9, as written: the guide's edited file, committed, then the list run again.
  writeFileSync(join(project, "delivery.config.json"), JSON.stringify(edited, null, 2) + "\n");
  git(project, ["commit", "-q", "-am", "Add a task to the list"]);
  secondRun = runDelivery(["run"], { cwd: project, env });
}, RUN_TIMEOUT * 2);

describe("the project-configuration guide", () => {
  it("walks through every step of setting up a project, each with the command it asks the reader to type", () => {
    for (const heading of Object.values(STEP)) expect(guide).toContain(`\n${heading}\n`);
    const get = sectionOf(guide, STEP.get, STEP.describe);
    expect(get).toContain("cp -r examples/project-configuration-example");
    expect(get).toContain("git init -b main");
    expect(sectionOf(guide, STEP.validate, STEP.preview)).toContain("delivery validate");
    expect(sectionOf(guide, STEP.preview, STEP.run)).toContain("delivery preview");
    expect(sectionOf(guide, STEP.run, STEP.add)).toContain("delivery run");
    const add = sectionOf(guide, STEP.add, STEP.further);
    expect(add).toContain("git commit -am");
    expect(add).toContain("delivery run");
  });

  it("shows the example's configuration file exactly as it ships", () => {
    expect(jsonBlock(sectionOf(guide, STEP.get, STEP.describe))).toEqual(config);
  });

  it("explains each setting it uses in its own step", () => {
    expect(sectionOf(guide, STEP.describe, STEP.list)).toContain("`domain`");
    expect(sectionOf(guide, STEP.list, STEP.check)).toContain("`tasks`");
    const check = sectionOf(guide, STEP.check, STEP.tools);
    for (const key of ["`gate`", "`closer`", "`commit-to-branch`", "`merge-back`", "`open-pr`"]) expect(check).toContain(key);
    expect(sectionOf(guide, STEP.tools, STEP.validate)).toContain("`roles`");
  });

  it("shows what `delivery validate` prints, exactly", () => {
    expect(validate.stderr).toBe("");
    expect(validate.status).toBe(EXIT.ok);
    expect(validate.stdout.split("\n").filter(Boolean)).toEqual(outputBlock(sectionOf(guide, STEP.validate, STEP.preview)));
  });

  it("shows what `delivery preview` prints, with the example's description inside the instructions", () => {
    expect(preview.status).toBe(EXIT.ok);
    const shown = outputBlock(sectionOf(guide, STEP.preview, STEP.run));
    expect(shown).toContain(config.domain);
    expect(missingFrom(preview.stdout, shown)).toBeUndefined();
  });

  it("shows `delivery run` closing every listed task, in order, exactly as it prints it", () => {
    expect(firstRun.stderr).toBe("");
    expect(firstRun.status).toBe(EXIT.ok);
    expect(missingFrom(firstRun.stdout, outputBlock(sectionOf(guide, STEP.run, STEP.add)))).toBeUndefined();
  });

  it("adds one task to the end of the list, and running again runs just that task, as the guide shows", () => {
    expect(edited.tasks).toHaveLength((config.tasks?.length ?? 0) + 1);
    expect({ ...edited, tasks: edited.tasks?.slice(0, -1) }).toEqual(config);
    expect(secondRun.status).toBe(EXIT.ok);
    expect(secondRun.stdout).not.toMatch(/^Task [12] of 3/m);
    expect(missingFrom(secondRun.stdout, outputBlock(sectionOf(guide, STEP.add, STEP.further)))).toBeUndefined();
  });

  it("leaves one closed run per task, each told the example's description and given its worker's tool list", async () => {
    const runs = await allRuns(project);
    expect(runs.map((run) => run.caseFile.header.taskDef.intent).sort()).toEqual([...(edited.tasks as string[])].sort());
    for (const run of runs) {
      expect(run.caseFile.outcome?.kind).toBe("closed");
      expect(run.caseFile.header.domainPrompt).toBe(config.domain);
      expect(run.caseFile.header.roleOverrides).toEqual(config.roles);
    }
  });

  it("walks through the setup in plain words, and sends extenders to the gate, closer and role guides", () => {
    // Fenced blocks are the command's own output and the file's own keys; the prose is the guide's.
    const prose = sectionOf(guide, "# Setting up a project", STEP.further).replace(/```[\s\S]*?```/g, "").toLowerCase();
    for (const word of ["worktree", "envelope", "surface", "case file", "role config", "schema"]) expect(prose).not.toContain(word);
    const further = sectionOf(guide, STEP.further);
    for (const doc of ["writing-a-gate.md", "writing-a-closer.md", "configuring-a-role.md"]) expect(further).toContain(doc);
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });
});
