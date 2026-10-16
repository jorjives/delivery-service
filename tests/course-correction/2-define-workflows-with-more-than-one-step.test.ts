// Slice 2: Define Workflows With More Than One Step
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-16 against commit 152e013
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project with a two-step
// plan-then-build workflow, the agent routed to the vendored scripted agent
// through the contributor-only test seam: no network, no API key.
// Acceptance criteria that need the agent runtime's session handling (resuming
// the previous step's session) or the per-step guards are recorded as skipped
// below, each with its reason.

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const TASK = "add a rota page";
const PLAN_PROMPT = "Write a short plan to PLAN.md.";
const BUILD_PROMPT = "Carry out PLAN.md.";

const WORKFLOWS = {
  "plan-then-build": {
    steps: [
      { name: "plan", prompt: PLAN_PROMPT, gate: { type: "file-exists", path: "PLAN.md" } },
      { name: "build", prompt: BUILD_PROMPT, continue: true },
    ],
  },
};

const planWritten: MockScript["expectations"][number] = {
  when: { promptContains: PLAN_PROMPT },
  effects: [{ write: { path: "PLAN.md", content: "1. add rota.html\n" } }],
  json: { status: "completed", rationale: "wrote the plan" },
};
const built: MockScript["expectations"][number] = {
  when: { promptContains: BUILD_PROMPT },
  effects: [{ write: { path: "rota.html", content: "rota\n" } }],
  json: { status: "completed", rationale: "built the rota page" },
};

async function project(script: MockScript, config: object = { workflows: WORKFLOWS }) {
  const repo = initTempRepo("uat-workflow-", {
    "package.json": PACKAGE,
    ".gitignore": ".delivery/\n",
    "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" }, ...config }, null, 2),
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-workflow-state-")),
  };
  return { repo, env };
}

describe("UAT: build a task out of more than one checked step", () => {
  it("runs the task through the named workflow in order, each step checked, and delivers both pieces of work", async () => {
    const { repo, env } = await project({ expectations: [planWritten, built] });

    const run = runDelivery(["run", "--task", TASK, "--workflow", "plan-then-build"], { cwd: repo, env });
    expect(run.status).toBe(0);

    // Both steps' work landed in the project.
    expect(readFileSync(join(repo, "PLAN.md"), "utf-8")).toContain("rota.html");
    expect(existsSync(join(repo, "rota.html"))).toBe(true);

    // The plan was accepted and saved before the build was.
    const files = git(repo, ["log", "--name-only", "--format=", "--reverse"]).trim().split("\n").filter(Boolean);
    expect(files.indexOf("PLAN.md")).toBeLessThan(files.indexOf("rota.html"));

    // The run went round the machine twice: two checked steps, one delivery.
    expect(run.stdout.match(/the agent is working/g)).toHaveLength(2);
    expect(run.stdout.match(/checking the agent's work/g)).toHaveLength(2);
    expect(run.stdout).toContain("1 of 1 task completed and merged");
  }, 120_000);
});

describe("AC: a step that fails is corrected on its own; later steps wait for it", () => {
  it("does not start the build until the plan step's file exists", async () => {
    // The first plan session writes nothing, so the step's check fails; the correction (whose prompt carries the
    // failed check) writes PLAN.md; only then does the build start. The fixing expectation is listed first so it wins
    // in a correction session.
    const fixes: MockScript["expectations"][number] = { ...planWritten, when: { promptContains: "exit:test -f 'PLAN.md'" } };
    const lazy: MockScript["expectations"][number] = {
      when: { promptContains: PLAN_PROMPT },
      effects: [],
      json: { status: "completed", rationale: "thought about it" },
    };
    const { repo, env } = await project({ expectations: [fixes, lazy, built] });

    const run = runDelivery(["run", "--task", TASK, "--workflow", "plan-then-build"], { cwd: repo, env });
    expect(run.status).toBe(0);

    const files = git(repo, ["log", "--name-only", "--format=", "--reverse"]).trim().split("\n").filter(Boolean);
    expect(files.indexOf("PLAN.md")).toBeLessThan(files.indexOf("rota.html"));
    expect(run.stdout).toContain("deciding what to do about a setback");
    expect(run.stdout.match(/the agent is working/g)).toHaveLength(3);
  }, 120_000);
});

describe("AC: a task given no workflow runs exactly as before", () => {
  it("runs one step, the task as the instruction, the project's own gate", async () => {
    const { repo, env } = await project({
      expectations: [{ effects: [{ write: { path: "rota.html", content: "rota\n" } }], json: { status: "completed", rationale: "done" } }],
    });
    const run = runDelivery(["run", "--task", TASK], { cwd: repo, env });
    expect(run.status).toBe(0);
    expect(existsSync(join(repo, "rota.html"))).toBe(true);
    expect(existsSync(join(repo, "PLAN.md"))).toBe(false);
  }, 120_000);
});

describe("AC: an unknown workflow is refused before anything starts", () => {
  it("exits non-zero, names the workflows that exist, and leaves no run behind", async () => {
    const { repo, env } = await project({ expectations: [] });
    const run = runDelivery(["run", "--task", TASK, "--workflow", "nope"], { cwd: repo, env });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("plan-then-build");
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });
});

describe("AC: delivery preview --step shows what a named step will receive", () => {
  it("prints the step's text and says it continues the previous session", async () => {
    const { repo, env } = await project({ expectations: [] });
    const build = runDelivery(["preview", "--task", TASK, "--step", "build"], { cwd: repo, env });
    expect(build.status).toBe(0);
    expect(build.stdout).toContain("Step 2 of 2 of the workflow `plan-then-build`: build");
    expect(build.stdout).toContain(BUILD_PROMPT);
    expect(build.stdout).toContain("continues the previous step's agent session");

    const plan = runDelivery(["preview", "--task", TASK, "--step", "plan"], { cwd: repo, env });
    expect(plan.status).toBe(0);
    expect(plan.stdout).toContain("Step 1 of 2 of the workflow `plan-then-build`: plan");
    expect(plan.stdout).toContain(PLAN_PROMPT);
  });
});

describe("AC: a command gate's setup runs before the check, teardown after, and a failed setup is a gate problem", () => {
  const stepWith = (setup: string) => {
    const trail = join(mkdtempSync(join(tmpdir(), "uat-workflow-trail-")), "trail.log");
    const gate = { type: "command", parseMode: "exitcode", command: `test -f A.md && echo check >> ${trail}`, setup: `echo setup >> ${trail}${setup}`, teardown: `echo teardown >> ${trail}` };
    return { trail, config: { workflows: { one: { steps: [{ name: "only", prompt: "Write A.md.", gate }] } } } };
  };
  const writesA: MockScript["expectations"][number] = { when: { promptContains: "Write A.md" }, effects: [{ write: { path: "A.md", content: "a\n" } }], json: { status: "completed", rationale: "ok" } };

  it("runs setup, then the check, then teardown, around the step's check", async () => {
    const { trail, config } = stepWith("");
    const { repo, env } = await project({ expectations: [writesA] }, config);
    const run = runDelivery(["run", "--task", TASK, "--workflow", "one"], { cwd: repo, env });
    expect(run.status).toBe(0);
    expect(readFileSync(trail, "utf-8").endsWith("setup\ncheck\nteardown\n")).toBe(true);
  }, 120_000);

  it("reports a failing setup as a gate problem, still tears down, and does not say the work failed its checks", async () => {
    const { trail, config } = stepWith("; exit 1");
    const { repo, env } = await project({ expectations: [writesA] }, config);
    const run = runDelivery(["run", "--task", TASK, "--workflow", "one"], { cwd: repo, env });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("setup `");
    expect(run.stdout).toContain("failed (exit 1)");
    expect(run.stdout).toContain("Nothing was changed on main");
    expect(readFileSync(trail, "utf-8")).not.toContain("check");
    expect(readFileSync(trail, "utf-8").trim().split("\n").at(-1)).toBe("teardown");
  }, 120_000);
});

// SKIPPED AC: a step can resume the previous step's session. Needs the real agent runtime's session ids; covered at unit level (src/surface-workflow.test.ts, src/agent-resume-fallback.test.ts).
// SKIPPED AC: a step can turn off a default guard or turn on the existing-test guard for exactly that step. Needs a scripted agent that edits an existing test; covered at unit level (src/task-guards.test.ts).
