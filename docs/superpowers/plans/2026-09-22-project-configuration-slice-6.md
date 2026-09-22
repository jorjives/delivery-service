# Project Configuration — Slice 6: Set Up a Whole Project by Following One Guide

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 6 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`
**Status:** ✅ Complete — 2026-09-22

**Goal:** Ship a second example project, `examples/project-configuration-example/`, with a checked-in `delivery.config.json` using `domain`, a two-entry `tasks` list and a `roles.worker` override, and a guide, `docs/project-configuration.md`, that takes a reader from copying it to a checked, previewed and completed list and then adding to it, proven by a test that runs the guide's own commands.

**Architecture:** No source under `src/` changes: every command this slice teaches already exists. The slice is one fixture, one guide and one test, following the getting-started precedent (`examples/sample-project/`, `docs/getting-started.md`, `tests/getting-started-guide.test.ts`, `tests/sample-project.test.ts`). The guide test copies the fixture into a scratch repository, runs the compiled `dist/cli/main.js` for each command the guide shows, routes the agent to the vendored `claude-mock` through the existing `DELIVERY_TEST_MOCK_SCRIPT` seam, and compares what the command printed with the guide's own ```` ```text ```` blocks. The two helpers that read those blocks move from the getting-started test into `tests/helpers.ts` so both guide tests share them.

**Tech Stack:** Node ≥ 22, TypeScript strict, vitest, git, the vendored `claude-mock`, changesets. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Follow the estate's "one fixture, one guide, one test" convention from the getting-started guide. Link to the existing gate, closer and role guides as chapters; do not copy their content into the new guide." So: one new fixture folder, one new guide, one guide test (plus the fixture's own shape test, mirroring `tests/sample-project.test.ts`); the guide's "Going further" section links to `writing-a-gate.md`, `writing-a-closer.md` and `configuring-a-role.md` and restates none of their contracts.
- **Operability (this slice's Operational note, verbatim):** "The guide is executed by a regression test that runs its own commands against the built command and the example project with the scripted agent, so the documentation cannot drift from the tool. The existing sample project is left exactly as it is, because the getting-started guide and its test depend on it as the no-configuration first run. This phase ships as a minor version with a changelog entry: it only adds surface." Landed by Task 3 (guide test), Task 5 (changeset), and by no task touching `examples/sample-project/`.
- **Spec, Scaffolding (verbatim):** "One new fixture, `examples/project-configuration-example/`, following Item 8's "one fixture, one guide, one test" convention. The unified guide is `docs/project-configuration.md`; the gate, closer and role guides remain the extender reference it links to, not content it forks."
- **Spec, Testing (verbatim):** "`docs/project-configuration.md` gets a test in the style of `tests/getting-started-guide.test.ts`, executing the guide's own commands against the built CLI and the example fixture with the agent routed to `claude-mock`." and "Example project test: `validate` passes, `preview` shows the domain sentence in the system prompt, and running the queue yields closed runs in order whose headers carry the domain prompt and the overridden worker config's effect."
- **Accessibility (spec):** no "worktree", "envelope", "surface", "case file", "role config" or schema terms in the guide's declarative walkthrough.
- **Copy:** British English; no em-dashes in anything a person reads (the guide, the example's README, the changeset, README, getting-started).
- **Do not modify** `examples/sample-project/` or anything under `src/`.
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the session's `Co-Authored-By` trailer.
- **Running a targeted test:** the guide test runs the compiled command, so build first: `npm run build && npx vitest run <file>`.

### Decisions settled for this plan (unattended run)

- **The example is a text-helpers library** (one `capitalise` function and its `node:test` test), not a copy of the sample project, so its two tasks and its description read as a real small project. Its `package.json` `test` script is `node --test`, as the sample's is, so the check needs no dependency.
- **The worker override is a tool list without `Bash`** (`["Read", "Glob", "Grep", "Edit", "Write"]`), not replacement instructions. It keeps the built-in worker sentences (replacing them would drop the harness's own guidance for a real run), is safe to leave in a copied project, and shows up plainly in both `validate` ("✓ worker: your own tool list") and `preview` (the tools line loses "run commands").
- **The gate is written out** (`{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`) rather than inferred, because the guide's step 4 is "choose a built-in check" and an omitted gate teaches nothing. `parseMode` is required by the current schema (verified: omitting it is refused).
- **The two tasks start with different five-word slugs** ("add a function that turns…", "add a function that shortens…", and the guide's added "add a function that counts…"): run ids are the first five words plus the second the run started, and two tasks starting in the same second must not collide.
- **The guide tells the reader to commit the edited list** before running again. Without it the command prints its "you have uncommitted changes" note, which the guide would then have to show; the file is checked in, so committing is also the honest instruction.
- **The vocabulary check strips fenced blocks.** The run's closing sentence is the command's own output and names the branch `surface/<run-id>`; the guide shows that output verbatim. Renaming branches is outside this slice. The check therefore covers the guide's prose (everything outside ```` ``` ```` fences) up to "Going further", which is the part the guide's author controls.
- **`validate`'s output is compared exactly** (it has no variable part); the run blocks are compared line by line, in order, with `<run-id>` standing for the run id; the preview block uses a line of just `…` where the guide leaves out the long middle of the instructions.
- **Stateful guide steps run once in `beforeAll`** (copy, validate, preview, run, edit, commit, run), capturing each command's result; each `it` then asserts on one step. The `it`s do not depend on each other's order.
- **The fixture's run-record assertions live in the guide test**, not the fixture test: the guide test already drives the fixture's queue, so asserting the records there (closed, description pinned, worker override pinned) avoids a second end-to-end run. The fixture test stays static, like `tests/sample-project.test.ts`.
- **Changelog:** every command and key this phase added already has a pending minor changeset (`check-your-setup-for-free`, `see-what-the-agent-will-be-told`, `queue-tasks-in-plain-words`, `describe-your-project-once`, `tune-a-role-from-the-config-file`). This slice adds one for the guide and example, and a release test that the phase's commands and keys are recorded (in `CHANGELOG.md` or a pending changeset, so it survives `changeset version`) and that no pending entry is a major bump.

## Scaffolding Impact

- **Proactive (new thing to verify):** the guide's regression test, `tests/project-configuration-guide.test.ts`, is picked up by the existing vitest include glob and runs under `npm test` / `make verify` / CI with no configuration change; it needs `dist/` built, which `npm test` already does → Task 3.
- **Inherited (Operational note):** guide executed by a regression test → Task 3; sample project untouched → no task edits it; minor changeset → Task 5.
- **Reactive:** `CONTRIBUTING.md` says which guide tests run which guides; add the new guide and its example → Task 3.
- **Reactive:** `docs/getting-started.md` "Where to go next" gains the new guide as the next step → Task 4.
- **Reactive:** `README.md` Quick start and Documentation list gain the new guide → Task 4.
- **Reactive:** `.changeset/set-up-a-whole-project-from-one-guide.md` (minor) → Task 5.
- `delivery --help`, `src/`, `docs/configuring-a-role.md`, `docs/writing-a-gate.md`, `docs/writing-a-closer.md`: unchanged (no behaviour changes; the new guide links to them).
- No `CLAUDE.md` / `AGENTS.md` exists in this repository.

---

### Task 1: Share the guide-output helpers between guide tests (tidy first) ✅ DONE (deliver-slice)

**Files:**
- Modify: `tests/helpers.ts` (add `outputBlock`, `documented`)
- Modify: `tests/getting-started-guide.test.ts` (delete its local copies, import them)

**Interfaces:**
- Consumes: nothing.
- Produces: `tests/helpers.ts` exports `outputBlock(section: string): string[]` and `documented(line: string): RegExp`, behaviour identical to the current local functions in `tests/getting-started-guide.test.ts`.

This is a pure move: no behaviour changes, so the existing getting-started test is the test.

- [ ] **Step 1: Confirm the getting-started guide test passes before the move**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 2: Move the two helpers**

Append to `tests/helpers.ts`:

```ts
/** A guide section's first ```text block: what the guide says you will see, blank lines dropped. */
export function outputBlock(section: string): string[] {
  const match = /```text\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) throw new Error(`no \`\`\`text block in:\n${section}`);
  return match[1].split("\n").filter(Boolean);
}

/** One line a guide shows, as a pattern: `<run-id>` and `<when>` stand for the parts that differ every run. */
export function documented(line: string): RegExp {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("<run-id>", "\\S+").replaceAll("<when>", ".+")}$`, "m");
}
```

In `tests/getting-started-guide.test.ts`, delete the local `outputBlock` and `documented` functions (and their doc comments), and change the helpers import to:

```ts
import { documented, git, outputBlock, REPO_ROOT, runDelivery, sectionOf, useScratch } from "./helpers.js";
```

- [ ] **Step 3: Run the same test again**

Run: `npx vitest run tests/getting-started-guide.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers.ts tests/getting-started-guide.test.ts
git commit -m "Move the guide-output helpers into the shared test helpers

A second guide test is about to compare a guide's shown output with what the
command prints; sharing the two helpers keeps both guides read by one rule
rather than two copies that can drift."
```

---

### Task 2: Ship the project-configuration example ✅ DONE (deliver-slice)

**Files:**
- Create: `examples/project-configuration-example/package.json`
- Create: `examples/project-configuration-example/text.js`
- Create: `examples/project-configuration-example/text.test.js`
- Create: `examples/project-configuration-example/delivery.config.json`
- Create: `examples/project-configuration-example/README.md`
- Test: `tests/project-configuration-example.test.ts`

**Interfaces:**
- Consumes: `readConfig(file: string): Promise<DeliveryConfig>` from `src/cli/config.ts` (the harness's own loader, so the fixture is checked against the real schema); `REPO_ROOT` from `tests/helpers.ts`.
- Produces: the fixture path `examples/project-configuration-example/`, and its config, whose exact contents Task 3's guide shows and whose `tasks` Task 3's test scripts the agent for:
  - `tasks[0]` = `"add a function that turns a title into a URL slug, with a test"`
  - `tasks[1]` = `"add a function that shortens long text to a given length, with a test"`

- [ ] **Step 1: Write the failing fixture test**

Create `tests/project-configuration-example.test.ts`:

```ts
// The project-configuration example: the complete project docs/project-configuration.md
// walks a reader through. What its commands print is proven by
// tests/project-configuration-guide.test.ts; this file holds what the fixture itself
// must be, as tests/sample-project.test.ts does for the no-configuration sample.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/cli/config.js";
import { REPO_ROOT } from "./helpers.js";

const EXAMPLE = join(REPO_ROOT, "examples", "project-configuration-example");
const config = () => readConfig(join(EXAMPLE, "delivery.config.json"));

describe("the project-configuration example", () => {
  it("checks in a configuration with a project description, a list of tasks and a worker override", async () => {
    const { domain, tasks, roles } = await config();
    expect(domain?.trim()).toBeTruthy();
    expect(tasks?.length).toBeGreaterThanOrEqual(2);
    expect(roles?.worker).toBeDefined();
  });

  it("chooses a built-in check and closing action, so the project needs no code of its own", async () => {
    const { gate, closer } = await config();
    expect(gate?.type).toBe("command");
    expect(closer?.type).toBe("commit-to-branch");
  });

  it("passes its own tests as shipped, so the first task starts from green", () => {
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: EXAMPLE, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });

  it("ships only its source and its configuration, so a copy is ready for git init", () => {
    expect(readdirSync(EXAMPLE).sort()).toEqual(["README.md", "delivery.config.json", "package.json", "text.js", "text.test.js"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/project-configuration-example.test.ts`
Expected: FAIL, every test (ENOENT: the folder does not exist).

- [ ] **Step 3: Create the fixture**

`examples/project-configuration-example/package.json`:

```json
{
  "name": "text-helpers",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

`examples/project-configuration-example/text.js`:

```js
/** Capitalises the first letter of a word. */
export function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
```

`examples/project-configuration-example/text.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { capitalise } from "./text.js";

test("capitalises the first letter of a word", () => {
  assert.equal(capitalise("hello"), "Hello");
});
```

`examples/project-configuration-example/delivery.config.json` (exactly this; Task 3's guide shows it verbatim and its test compares the two):

```json
{
  "domain": "A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.",
  "tasks": [
    "add a function that turns a title into a URL slug, with a test",
    "add a function that shortens long text to a given length, with a test"
  ],
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "roles": {
    "worker": { "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"] }
  }
}
```

`examples/project-configuration-example/README.md`:

```markdown
# Project configuration example

A small library of text helpers, set up as a project: its `delivery.config.json` describes
the project, lists two things to do, checks the work with the project's own tests, commits
work that passes to a new branch, and keeps the agent from running commands.

[Setting up a project](../../docs/project-configuration.md) walks through it, from copying
this folder to running the whole list and adding to it.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/project-configuration-example.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add examples/project-configuration-example tests/project-configuration-example.test.ts
git commit -m "Ship a project-configuration example project

A new adopter needs a complete project to set up, not a blank folder: this one
uses a description, a two-task list and a worker override, with a built-in
check and closing action. The no-configuration sample project stays as it is,
because the getting-started guide depends on it."
```

---

### Task 3: Write the project-configuration guide, proven by its own commands ✅ DONE (deliver-slice)

**Files:**
- Create: `docs/project-configuration.md`
- Test: `tests/project-configuration-guide.test.ts`
- Modify: `CONTRIBUTING.md` (the paragraph ending "change the guide with the testing API.", around line 64)

**Interfaces:**
- Consumes: `outputBlock`, `documented`, `git`, `REPO_ROOT`, `runDelivery`, `sectionOf`, `useScratch` from `tests/helpers.ts` (Task 1); the fixture from Task 2; `writeMockScript`, `MockExpectation` from `src/testing.ts`; `TEST_MOCK_SCRIPT` from `src/cli/agent-session.ts`; `EXIT` from `src/cli/failures.ts`; `allRuns(repoPath): Promise<RunRecord[]>` from `src/cli/runs.ts` (`RunRecord.caseFile.header.{taskDef, domainPrompt, roleOverrides}`, `RunRecord.caseFile.outcome?.kind`); `readConfig` from `src/cli/config.ts`.
- Produces: `docs/project-configuration.md` with exactly these headings, which Task 4 links to:
  `# Setting up a project`, `## What you need`, `## 1. Get the example project`, `## 2. Describe your project`, `## 3. List what you want done`, `## 4. Choose how the work is checked, and what happens to it`, `## 5. Decide what the agent may do`, `## 6. Check your setup`, `## 7. See what the agent will be told`, `## 8. Run the list`, `## 9. Add to the list`, `## Going further`.

- [ ] **Step 1: Write the failing guide test**

Create `tests/project-configuration-guide.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx vitest run tests/project-configuration-guide.test.ts`
Expected: FAIL at import: ENOENT reading `docs/project-configuration.md`.

- [ ] **Step 3: Write the guide**

Create `docs/project-configuration.md` with exactly this content (the ```` ```text ```` blocks are what the commands print; the test compares them line by line, so do not reword them):

````markdown
# Setting up a project

[Getting started](getting-started.md) ran one task you typed on the command line. A
project is more than that: it has things an agent should know before it starts, more
than one thing to do, and an owner who wants to check the setup before any agent time
is spent. This guide sets one up from start to finish, in a complete example project
that ships with the harness. You describe the project, list what you want done, choose
how the work is checked and what happens to it, check the setup, read what the agent
will be told, run the whole list, and then add to it.

All of it lives in one file of plain settings, `delivery.config.json`, checked in beside
your code. You write no code and read no harness source.

## What you need

- The `delivery` command, installed as [Getting started](getting-started.md) describes.
- Node.js 22 or later, and `git`.
- For steps 8 and 9, Claude Code, signed in. Check with `claude auth status`; if it says
  you are not signed in, run `claude auth login`, or set `ANTHROPIC_API_KEY`. Checking and
  previewing your setup need no sign-in and no network.

## 1. Get the example project

The harness ships an example project: a small library of text helpers with one function,
its test, and a finished `delivery.config.json`. Copy it somewhere outside the harness
checkout and make it a git repository:

```bash
cp -r examples/project-configuration-example ~/text-helpers
cd ~/text-helpers
git init -b main
git add -A
git commit -m "Start the example project"
```

This is its whole configuration file. The next four steps explain it a setting at a time.

```json
{
  "domain": "A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.",
  "tasks": [
    "add a function that turns a title into a URL slug, with a test",
    "add a function that shortens long text to a given length, with a test"
  ],
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "roles": {
    "worker": { "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"] }
  }
}
```

## 2. Describe your project

`domain` says what your project is, in your own words: a sentence or two about what it
does, what it is built with, and anything an agent should know before it starts. Every
agent on every run is told it before its own instructions, so you never retype it. A run
keeps the description it started with: editing it changes the next run, not one already
going.

A description that runs to several paragraphs is easiest in a `delivery.config.js` that
exports the same settings, with the description in a template literal. The
[readme](../README.md#configure-it-once) shows that form.

## 3. List what you want done

`tasks` is your list, in the order you want it done, one plain sentence per thing. Write
each the way you would ask a colleague: what you want, and that it should come with a
test. `delivery run` works down the list one task at a time, and the work for each task
ends up on a branch of its own.

The list is yours to edit between runs. A new sentence runs in its place. Rewording a
sentence makes it a new task, which is also how you ask for a finished one again.
Deleting a sentence leaves what already ran in the history. An empty sentence, or two
that say exactly the same thing, are refused before anything runs.

## 4. Choose how the work is checked, and what happens to it

`gate` is the check that decides whether the agent's work is good: the agent's own word
is never taken as proof. The example uses the project's own tests. `"command": "npm test"`
runs them, and `"parseMode": "exitcode"` means the check passes when the command
succeeds. Any command that succeeds when the work is good and fails when it is not will
do.

`closer` is what happens to work that passes the check. The example's `commit-to-branch`
commits it to a new branch and leaves `main` alone, so you look at it before you merge
it. The other built-in choices are `merge-back`, which merges it into your main branch,
and `open-pr`, which opens a pull request.

## 5. Decide what the agent may do

`roles` changes what an agent is told and which tools it may use. The example keeps the
built-in instructions for the agent that does each task, the worker, and gives it a
shorter list of tools, without `Bash`: it can read, search and edit files, but cannot run
commands. Leave `roles` out and every agent keeps its built-in instructions and tools.

## 6. Check your setup

Before spending anything, check the file:

```bash
delivery validate
```

```text
Checking delivery.config.json…
✓ domain description: present
✓ 2 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
✓ worker: your own tool list
Ready to run.
```

Each tick is one thing it read. If something is wrong it prints the one thing to fix
instead, and nothing starts. It needs no sign-in and no network and changes nothing, so
run it as often as you like, and in CI on every push.

## 7. See what the agent will be told

```bash
delivery preview
```

It prints the instructions the first task on your list will be given, word for word, with
your description in place, and then what the agent may do. The middle is long, so it is
shortened here:

```text
Next up is Task 1 of 2: add a function that turns a title into a URL slug, with a test
What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.
…
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files.
```

"run commands" is missing from the last line because of the shorter tool list in step 5.
`delivery preview --queue-index 2` shows the second task instead. Like `delivery
validate`, it needs no sign-in and changes nothing.

## 8. Run the list

```bash
delivery run
```

```text
Task 1 of 2: add a function that turns a title into a URL slug, with a test
Starting run <run-id>: add a function that turns a title into a URL slug, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that turns a title into a URL slug, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Task 2 of 2: add a function that shortens long text to a given length, with a test
Starting run <run-id>: add a function that shortens long text to a given length, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that shortens long text to a given length, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
```

Each task ends by naming the branch its work is on. Your `main` branch is untouched: read
what the agent did with `git log -p <branch>`, and merge what you like.

If the run stops part way, because you closed the terminal or pressed Ctrl-C, run
`delivery run` again in the same folder. It carries on with the task it was on, then the
rest of the list. `delivery status --all` lists every run so far.

## 9. Add to the list

Add one more sentence to the end of `tasks`, in your own words. For example:

```json
{
  "domain": "A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.",
  "tasks": [
    "add a function that turns a title into a URL slug, with a test",
    "add a function that shortens long text to a given length, with a test",
    "add a function that counts the words in a sentence, with a test"
  ],
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "roles": {
    "worker": { "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"] }
  }
}
```

The file is part of your project, so commit the change, then run the list again:

```bash
git commit -am "Add a task to the list"
delivery run
```

```text
Task 3 of 3: add a function that counts the words in a sentence, with a test
Starting run <run-id>: add a function that counts the words in a sentence, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that counts the words in a sentence, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
```

Only your new task runs. The first two already have finished runs, and what is left to do
is worked out afresh each time from what has already run, so nothing is stored that could
fall out of step with your file. The count is always the list as it is written now.

## Going further

Everything above uses the harness's built-in pieces. When you need your own, each has a
guide of its own:

- [Writing a gate](writing-a-gate.md): a check of your own, written in code, in place of a command.
- [Writing a closer](writing-a-closer.md): your own way of handling work that passes, such as notifying a channel.
- [Configuring a role](configuring-a-role.md#from-the-configuration-file): changing an agent's instructions as well as its tools, and why a misspelled tool name only shows up during a run.
- [Testing your delivery pipeline](testing-your-pipeline.md): proving your own check, closing action and roles together against a scripted agent.

To start a configuration for a project of your own, run `delivery init` in it: it asks what
checks the work, what happens to work that passes, and what you would like done, and writes
the file for you. The [readme](../README.md#configure-it-once) lists every setting.
````

Note on the preview block: `outputBlock` drops blank lines, so the blank line the command prints after the heading needs no line in the guide; `missingFrom` matches lines in order and skips the `…` lines.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/project-configuration-guide.test.ts`
Expected: PASS (9 tests). If a block differs from what the command prints, the failing assertion names the first missing line: correct the guide to what the command prints (the command is not changed in this slice).

- [ ] **Step 5: Say in CONTRIBUTING which test runs the new guide**

In `CONTRIBUTING.md`, after the sentence ending "`tests/testing-your-pipeline-guide.test.ts` runs its worked tests: change the guide with the testing API.", add a new paragraph:

```markdown
`docs/getting-started.md` and `docs/project-configuration.md` are run the same way, by
`tests/getting-started-guide.test.ts` and `tests/project-configuration-guide.test.ts`, against
the example projects in `examples/`: a change to what a command prints changes those guides in
the same commit. Leave `examples/sample-project/` without a configuration file; it is the
no-configuration first run.
```

- [ ] **Step 6: Commit**

```bash
git add docs/project-configuration.md tests/project-configuration-guide.test.ts CONTRIBUTING.md
git commit -m "Add a guide that sets up a whole project, run by its own test

A new adopter needs one path from an empty configuration to a finished list:
describe the project, list tasks, choose a built-in check and closing action,
validate, preview, run and edit the list. The test runs the guide's commands
against the example project and the scripted agent, so the guide cannot drift
from what the command prints."
```

---

### Task 4: Point newcomers from getting started to the new guide ✅ DONE (deliver-slice)

**Files:**
- Modify: `docs/getting-started.md` ("## Where to go next", its first bullet)
- Modify: `tests/getting-started-guide.test.ts` (the "says what a reader needs, and points on to the other guides" test)
- Modify: `README.md` ("## Quick start" paragraph and "## Documentation" list)

**Interfaces:**
- Consumes: `docs/project-configuration.md` (Task 3).
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing expectation**

In `tests/getting-started-guide.test.ts`, in `it("says what a reader needs, and points on to the other guides", …)`, after `const next = sectionOf(guide, "## Where to go next");` add:

```ts
    // The next step after one task is a whole project: it comes first.
    const firstNext = next.split("\n").find((line) => line.startsWith("- "));
    expect(firstNext).toContain("(project-configuration.md)");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts -t "points on to the other guides"`
Expected: FAIL: the first bullet is about `delivery.config.json` and the readme.

- [ ] **Step 3: Replace the first "Where to go next" bullet**

In `docs/getting-started.md`, replace the first bullet under `## Where to go next` (the one beginning "Settings that belong to a project, such as the check, the closing action and the attempt limits") with:

```markdown
- [Setting up a project](project-configuration.md): the next step. Describe your project
  once, list what you want done, check and preview the setup, and run the whole list, in a
  complete example project. For a project of your own, `delivery init` writes a
  `delivery.config.json` by asking what checks the work, what happens to work that passes,
  and what you would like done; the [readme](../README.md) lists every setting.
```

Leave the other three bullets as they are.

- [ ] **Step 4: Point to it from the README**

In `README.md`, replace the Quick start paragraph:

```markdown
New here? [Getting started](docs/getting-started.md) takes you from installing the command to a
finished run against the sample project.
```

with:

```markdown
New here? [Getting started](docs/getting-started.md) takes you from installing the command to a
finished run against the sample project. Then [Setting up a project](docs/project-configuration.md)
sets up a whole project, with a description and a list of tasks, in a complete example.
```

and in `## Documentation`, after the Getting started bullet, add:

```markdown
- [Setting up a project](docs/project-configuration.md): describe a project, list its tasks, check, preview and run them
```

- [ ] **Step 5: Run the getting-started tests**

Run: `npx vitest run tests/getting-started-guide.test.ts tests/sample-project.test.ts`
Expected: PASS (all tests). The sample project is unchanged and its guide still runs as written.

- [ ] **Step 6: Commit**

```bash
git add docs/getting-started.md tests/getting-started-guide.test.ts README.md
git commit -m "Point newcomers from getting started to setting up a project

Someone who has finished their first run needs to know where to go next; a
whole project with a description and a list of tasks is that step, so it comes
first in the getting-started guide's next steps and in the readme."
```

---

### Task 5: Record the phase as an additive release ✅ DONE (deliver-slice)

**Files:**
- Create: `.changeset/set-up-a-whole-project-from-one-guide.md`
- Modify: `tests/release.test.ts`

**Interfaces:**
- Consumes: the existing pending changesets and `CHANGELOG.md`.
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing release test**

In `tests/release.test.ts`, change the fs import to `import { existsSync, readdirSync, readFileSync } from "node:fs";` and add inside the `describe`:

```ts
  it("records project configuration's commands and settings as an additive release", () => {
    // Pending entries become the changelog on `changeset version`, so read both:
    // this holds before the release and after it.
    const pending = readdirSync(join(REPO_ROOT, ".changeset"))
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .map((name) => read(`.changeset/${name}`));
    const recorded = [read("CHANGELOG.md"), ...pending].join("\n");
    for (const surface of ["delivery validate", "delivery preview", "`domain`", "`tasks`", "`roles`", "docs/project-configuration.md"]) {
      expect(recorded).toContain(surface);
    }
    for (const entry of pending) expect(entry).not.toMatch(/^"delivery-service": major$/m);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/release.test.ts`
Expected: FAIL: `docs/project-configuration.md` is not recorded anywhere.

- [ ] **Step 3: Add the changeset**

Create `.changeset/set-up-a-whole-project-from-one-guide.md`:

```markdown
---
"delivery-service": minor
---

A new guide, `docs/project-configuration.md`, sets up a whole project from start to finish in
an example project that ships with the harness, `examples/project-configuration-example`: it
describes the project in `domain`, lists what to do in `tasks`, chooses a built-in check and
closing action, narrows the worker's tools in `roles`, then checks the setup with `delivery
validate`, reads the agent's instructions with `delivery preview`, runs the whole list with
`delivery run`, and adds to the list afterwards. A test runs the guide's own commands, so what
it shows is what the command prints. Getting started now points to it as the next step.
Nothing about the command itself changes.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/release.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .changeset/set-up-a-whole-project-from-one-guide.md tests/release.test.ts
git commit -m "Record the project-configuration guide as a minor release

This phase only adds surface, so it ships as a minor version; the test holds
that its commands and settings reach the changelog and that nothing pending
claims a breaking change."
```
