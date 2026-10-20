// The workflow examples: each folder under examples/ named here turns a way people work with
// coding agents into a project configuration. This copies each one as its README says, checks
// `delivery validate` accepts it, then runs it against the scripted agent in
// tests/workflow-examples/ and checks the outcome the README promises. The cheats at the end
// prove each example's own checks refuse the shortcut its README says they refuse. Nothing here
// needs the network or a sign-in, except the dependency upgrade, whose rehearsal installs from
// the registry and so is only validated.

import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import type { MockScript } from "../src/testing.js";
import { git, REPO_ROOT, runDelivery, useScratch } from "./helpers.js";

const RUN_TIMEOUT = 180_000;
const EXAMPLES = [
  "plan-then-build-example",
  "test-first-example",
  "spec-to-backlog-example",
  "research-notebook-example",
  "compound-engineering-example",
  "migration-campaign-example",
  "flaky-test-example",
  "docs-drift-example",
  "ad-copy-example",
  "issue-to-pr-example",
  "dependency-upgrade-example",
];

const scratch = useScratch();

/** A copy of the example made into a repository, as each README's "Try it" does. */
function project(example: string, edit?: (config: Record<string, unknown>) => void): string {
  const path = join(scratch(`${example}-`), example);
  cpSync(join(REPO_ROOT, "examples", example), path, { recursive: true });
  if (edit !== undefined) {
    const file = join(path, "delivery.config.json");
    const config = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    edit(config);
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  }
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["config", "user.email", "harness@example.invalid"]);
  git(path, ["config", "user.name", "Harness"]);
  git(path, ["add", "-A"]);
  git(path, ["commit", "-q", "-m", "Start the example"]);
  return path;
}

function scripted(script: MockScript | string): NodeJS.ProcessEnv {
  const path = join(scratch("workflow-script-"), "mock.json");
  const body = typeof script === "string" ? readFileSync(join(REPO_ROOT, "tests", "workflow-examples", script), "utf-8") : JSON.stringify(script);
  writeFileSync(path, body);
  return { ...process.env, [TEST_MOCK_SCRIPT]: path, XDG_STATE_HOME: scratch("workflow-state-") };
}

/** Runs one of the example's own scripts in `cwd`, as a reader would after the run. */
function node(cwd: string, ...args: string[]): { status: number | null; output: string } {
  const { status, stdout, stderr } = spawnSync(process.execPath, args, { cwd, encoding: "utf-8" });
  return { status, output: `${stdout}\n${stderr}` };
}

function delivered(cwd: string, args: string[], script: MockScript | string): void {
  const run = runDelivery(args, { cwd, env: scripted(script) });
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(EXIT.ok);
}

/** The file at `path` on `ref`. */
const show = (cwd: string, ref: string, path: string): string => git(cwd, ["show", `${ref}:${path}`]);

describe("the workflow examples", () => {
  it.each(EXAMPLES)("%s is accepted by delivery validate as shipped", (example) => {
    const run = runDelivery(["validate"], { cwd: project(example) });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(EXIT.ok);
    expect(run.stdout).toContain("Ready to run.");
  });

  it("explore-plan-build writes a plan, builds from it, and has a fresh session review it", () => {
    const cwd = project("plan-then-build-example");
    delivered(cwd, ["run", "--task", "let two people swap their on-call weeks, with a test", "--workflow", "explore-plan-build"], "plan-then-build-example.json");
    const branch = git(cwd, ["branch", "--list", "surface/*", "--format=%(refname:short)"]);
    expect(show(cwd, branch, "plans/swap-weeks.md")).toContain("## Review");
  }, RUN_TIMEOUT);

  it("scout leaves notes on what the task involves on a branch of its own", () => {
    const cwd = project("plan-then-build-example");
    delivered(cwd, ["run", "--task", "store the rota in a file and reload it on start", "--workflow", "scout"], "plan-then-build-example.scout.json");
    const branch = git(cwd, ["branch", "--list", "surface/*", "--format=%(refname:short)"]);
    expect(show(cwd, branch, "plans/scout-store-rota.md")).toContain("Scout");
    expect(git(cwd, ["log", "--oneline", "main"]).split("\n")).toHaveLength(1);
  }, RUN_TIMEOUT);

  it("red-green-refactor takes the next test on the list through all three steps onto main", () => {
    const cwd = project("test-first-example");
    delivered(cwd, ["run", "--sources"], "test-first-example.json");
    expect(readFileSync(join(cwd, "plan.md"), "utf-8")).toContain("- [x] a line with a quantity of zero or less is refused");
    expect(readFileSync(join(cwd, "quantity.test.js"), "utf-8")).toContain("RangeError");
  }, RUN_TIMEOUT);

  it("the planning pass turns every requirement not yet done into an item, which the next run builds", () => {
    const cwd = project("spec-to-backlog-example");
    expect(node(cwd, "scripts/spec-coverage.mjs").status).toBe(1);
    delivered(cwd, ["run", "--sources"], "spec-to-backlog-example.json");
    expect(node(cwd, "scripts/spec-coverage.mjs").output).toContain("R4: planned");
  }, RUN_TIMEOUT);

  it("three research questions run at once, each answered by code on its own branch", () => {
    const cwd = project("research-notebook-example");
    delivered(cwd, ["run"], "research-notebook-example.json");
    const branches = git(cwd, ["branch", "--list", "surface/*", "--format=%(refname:short)"]).split("\n");
    expect(branches).toHaveLength(3);
    git(cwd, ["checkout", "-q", branches[0] ?? ""]);
    expect(node(cwd, "scripts/check-research.mjs").status).toBe(0);
  }, RUN_TIMEOUT);

  it("the compound step's lesson lands on main, linked from CLAUDE.md for the next item's agents", () => {
    const cwd = project("compound-engineering-example");
    delivered(cwd, ["run", "--sources"], "compound-engineering-example.json");
    expect(readFileSync(join(cwd, "CLAUDE.md"), "utf-8")).toContain("](docs/solutions/stable-hash.md)");
  }, RUN_TIMEOUT);

  it("the migration moves every listed file off the legacy module, three at a time, onto one branch", () => {
    const cwd = project("migration-campaign-example");
    expect(JSON.parse(node(cwd, "scripts/migration-source.mjs", "list").output)).toHaveLength(4);
    delivered(cwd, ["run", "--sources", "--max", "4"], "migration-campaign-example.json");
    git(cwd, ["checkout", "-q", "delivery/main"]);
    expect(JSON.parse(node(cwd, "scripts/migration-source.mjs", "list").output)).toEqual([]);
    expect(node(cwd, "scripts/lint.mjs").status).toBe(0);
  }, RUN_TIMEOUT);

  it("a flaky test is fixed so it passes thirty runs in a row, and the same mistake elsewhere becomes a follow-up", () => {
    const cwd = project("flaky-test-example");
    delivered(cwd, ["run", "--sources"], "flaky-test-example.json");
    git(cwd, ["checkout", "-q", "delivery/main"]);
    expect(node(cwd, "scripts/repeat.mjs", "30").status).toBe(0);
    expect(readFileSync(join(cwd, "docs/flaky-patterns.md"), "utf-8")).toContain("## Results collected in the order they finish");
    expect(readFileSync(join(cwd, ".delivery/backlog/20261020T100000Z-flaky-prices.md"), "utf-8")).toContain("prices.js");
  }, RUN_TIMEOUT);

  it("the recurring docs item brings docs/API.md back in line with the code", () => {
    const cwd = project("docs-drift-example");
    expect(node(cwd, "scripts/check-docs.mjs").output).toContain("documents reverse, which src/ does not export");
    delivered(cwd, ["run", "--sources"], "docs-drift-example.json");
    expect(node(cwd, "scripts/check-docs.mjs").status).toBe(0);
  }, RUN_TIMEOUT);

  it("refresh-ads picks the four weakest ads and rewrites only those, within the limits", () => {
    const cwd = project("ad-copy-example");
    delivered(cwd, ["run", "--task", "refresh the ads that are not working", "--workflow", "refresh-ads"], "ad-copy-example.json");
    const branch = git(cwd, ["branch", "--list", "surface/*", "--format=%(refname:short)"]);
    expect(JSON.parse(show(cwd, branch, "data/underperformers.json"))).toEqual(["hike-02", "tent-02", "pack-02", "sock-02"]);
  }, RUN_TIMEOUT);

  it("resolve-issue reproduces the problem in a failing test, then fixes it", () => {
    const cwd = project("issue-to-pr-example");
    delivered(cwd, ["run", "--task", "Ounces are rounded to whole numbers", "--workflow", "resolve-issue", "--closer", "commit-to-branch"], "issue-to-pr-example.json");
  }, RUN_TIMEOUT);

  it("the upgrade gate passes only once package-lock.json installs the version the task names", async () => {
    const cwd = project("dependency-upgrade-example");
    const { default: gate } = (await import(join(cwd, "gates", "upgraded.mjs"))) as { default: { check: (ctx: unknown) => Promise<{ assertions: { outcome: string }[] }> } };
    const report = await gate.check({ worktreePath: cwd, taskDef: { intent: "Upgrade ms", package: "ms", to: "2.1.3" } });
    expect(report.assertions.map((a) => a.outcome)).toEqual(["FAIL"]);
    const installed = await gate.check({ worktreePath: cwd, taskDef: { intent: "Upgrade ms", package: "ms", to: "2.0.0" } });
    expect(installed.assertions.map((a) => a.outcome)).toEqual(["PASS"]);
  });
});

describe("the workflow examples refuse the shortcuts their READMEs name", () => {
  const once = (config: Record<string, unknown>): void => {
    config.budgets = { correction: 1 };
  };

  it("a plan step that changes code as well as writing a plan is not accepted", () => {
    const cwd = project("plan-then-build-example", once);
    const run = runDelivery(["run", "--task", "let two people swap their on-call weeks, with a test", "--workflow", "explore-plan-build"], {
      cwd,
      env: scripted({
        expectations: [
          {
            effects: [
              { write: { path: "plans/swap.md", content: "# Swap\n" } },
              { edit: { path: "rota.js", old: "const WEEK", new: "export const swap = () => {};\nconst WEEK" } },
            ],
            json: { status: "completed", rationale: "planned, and started early" },
          },
        ],
      }),
    });
    expect(run.status, run.stdout).toBe(EXIT.escalated);
  }, RUN_TIMEOUT);

  it("a green step that edits an existing test to pass is not accepted", () => {
    const cwd = project("test-first-example", once);
    const script = JSON.parse(readFileSync(join(REPO_ROOT, "tests", "workflow-examples", "test-first-example.json"), "utf-8")) as MockScript;
    const green = script.expectations.find((e) => e.when?.promptContains === '"green":');
    if (green === undefined) throw new Error("the test-first rehearsal has no green step");
    // The red step's test, loosened so the suite passes with no code written: only tests-unchanged can refuse it.
    green.effects = [{ edit: { path: "quantity.test.js", old: "assert.throws(() => total([{ price: 100, quantity: 0 }]), RangeError);", new: "assert.ok(true);" } }];
    const run = runDelivery(["run", "--sources"], { cwd, env: scripted(script) });
    expect(run.status, run.stdout).toBe(EXIT.escalated);
    expect(readFileSync(join(cwd, "plan.md"), "utf-8")).toContain("- [ ] a line with a quantity");
  }, RUN_TIMEOUT);

  it("a flaky-test fix that only loosens the test is not accepted", () => {
    const cwd = project("flaky-test-example", once);
    const run = runDelivery(["run", "--sources"], {
      cwd,
      env: scripted({
        expectations: [
          {
            when: { promptContains: '"fix":' },
            effects: [{ edit: { path: "load-all.test.js", old: "assert.deepEqual(await loadAll([1, 2, 3], slowly), [", new: "assert.deepEqual((await loadAll([1, 2, 3], slowly)).sort(), [" } }],
            json: { status: "completed", rationale: "the order does not matter" },
          },
        ],
      }),
    });
    expect(run.status, run.stdout).toBe(EXIT.escalated);
  }, RUN_TIMEOUT);
});
