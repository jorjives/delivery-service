import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, runsRoot, writeRunRecord } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { agentOptionsLine, CONTINUES, noSuchStep, noSuchTask, previewIntro, RULE, SINGLE_TASK, stepHeading, stepInMany, TASK_NUMBER } from "./preview-command.js";
import { OWN_SETUP } from "./own-setup.js";
import { EVERY_TASK_DONE } from "./queue.js";
import { NO_TASK } from "./settings.js";

// preview must work on a machine with no Claude Code runtime and no sign-in.
// The one way into the agent runtime fails loudly in every test here.
vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: () => {
    throw new Error("preview must never start an agent");
  },
}));

const DOMAIN = "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.";
const FIRST = "add a page that shows who's on call today";
const SECOND = "let someone swap their on-call day with a teammate";
const THIRD = "send a reminder the morning before someone's day";
const PROJECT = { domain: DOMAIN, tasks: [FIRST, SECOND, THIRD], gate: { type: "command", command: "npm test", parseMode: "exitcode" } };
const CLOSED = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;

/** A committed repository with a test script and, unless `config` is undefined, a delivery.config.json holding it. */
function repoWith(config: unknown, files: Record<string, string> = {}): string {
  return initTempRepo("preview-", {
    "package.json": PACKAGE,
    ...(config === undefined ? {} : { "delivery.config.json": JSON.stringify(config) }),
    ...files,
  });
}

describe("delivery preview", () => {
  it("names the next task, then frames the worker's instructions with the description and the task in the owner's words", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, stderr, exitCode } = await delivery(["preview"], { cwd: repo });

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 4)).toEqual([`Next up is Task 1 of 3: ${FIRST}`, "", previewIntro("worker"), RULE]);
    expect(lines[4]).toBe(workerRoleConfig.systemPromptFragment.split("\n")[0]);
    expect(stdout).toContain(`${workerRoleConfig.systemPromptFragment}\n\n${DOMAIN}\n\n## Task`);
    expect(stdout).toContain(`"intent": "${FIRST}"`);
    expect(stdout.endsWith(`${[...OWN_SETUP, agentOptionsLine(undefined)].join("\n")}\n`)).toBe(true);
  });

  it("passes over a task whose run was delivered, as delivery run would", async () => {
    const repo = repoWith(PROJECT);
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST, outcome: CLOSED });
    const { stdout } = await delivery(["preview"], { cwd: repo });
    expect(stdout.split("\n")[0]).toBe(`Next up is Task 2 of 3: ${SECOND}`);
    expect(stdout).toContain(`"intent": "${SECOND}"`);
  });

  it("shows the description as the file says it now", async () => {
    const repo = repoWith(PROJECT);
    const reworded = "A small internal tool for the support team's on-call rota.";
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ ...PROJECT, domain: reworded }));
    const { stdout } = await delivery(["preview"], { cwd: repo });
    expect(stdout).toContain(reworded);
    expect(stdout).not.toContain(DOMAIN);
  });

  it("prints the same thing twice for the same project", async () => {
    const repo = repoWith(PROJECT);
    expect((await delivery(["preview"], { cwd: repo })).stdout).toBe((await delivery(["preview"], { cwd: repo })).stdout);
  });

  it("shows what the agent that repairs the check is told, when asked for that role", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, exitCode } = await delivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(previewIntro("gate-maintenance"));
    expect(stdout).toContain(`${gateMaintenanceRoleConfig.systemPromptFragment}\n\n${DOMAIN}`);
    expect(stdout.endsWith(`${[...OWN_SETUP, agentOptionsLine(undefined)].join("\n")}\n`)).toBe(true);
  });

  it("refuses a role it cannot show, naming the two it can", async () => {
    const repo = repoWith(PROJECT);
    const { stderr, exitCode } = await delivery(["preview", "--role", "triage"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("worker, gate-maintenance");
  });

  it.each(["worker", "gate-maintenance"])("uses none of the harness's own words for the %s", async (role) => {
    const repo = repoWith(PROJECT);
    const { stdout } = await delivery(["preview", "--role", role], { cwd: repo });
    expect(stdout).not.toMatch(/worktree|envelope|surface|case file|role config/i);
  });

  it("previews a single `task` when the file has no list", async () => {
    const repo = repoWith({ domain: DOMAIN, task: { intent: FIRST } });
    const { stdout, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe(`Your task: ${FIRST}`);
    expect(stdout).toContain(`"intent": "${FIRST}"`);
  });

  it("says what delivery run says when the file names no task at all", async () => {
    const repo = repoWith({ domain: DOMAIN });
    const { stdout, stderr, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(stderr).toBe(`${NO_TASK}\n`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("says every task is done when each has a delivered run", async () => {
    const repo = repoWith({ tasks: [FIRST, SECOND] });
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST, outcome: CLOSED });
    await writeRunRecord(repo, { runId: "let-someone-20260917T100000Z", task: SECOND, outcome: CLOSED });
    const { stdout, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(stdout).toBe(`${EVERY_TASK_DONE}\n`);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("reads the file --config names, in the repository --repo names", async () => {
    const repo = repoWith(undefined, { "elsewhere.json": JSON.stringify(PROJECT) });
    const elsewhere = mkdtempSync(join(tmpdir(), "preview-elsewhere-"));
    const { stdout, exitCode } = await delivery(["preview", "--repo", repo, "--config", join(repo, "elsewhere.json")], { cwd: elsewhere });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(DOMAIN);
  });

  it("shows the agent's instructions as the file adds to them", async () => {
    const OPS_RULE = "Never modify anything under the ops folder.";
    const repo = repoWith({ ...PROJECT, agent: { append: OPS_RULE } });
    const { stdout, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(`${workerRoleConfig.systemPromptFragment}\n\n${DOMAIN}\n\n${OPS_RULE}\n\n## Task`);
  });

  it("shows gate maintenance's own instructions, unaffected by the file", async () => {
    const repo = repoWith(PROJECT);
    const repair = await delivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(repair.stdout).toContain(`${gateMaintenanceRoleConfig.systemPromptFragment}\n\n${DOMAIN}`);
    const worker = await delivery(["preview"], { cwd: repo });
    expect(worker.stdout).toContain(`${workerRoleConfig.systemPromptFragment}\n\n${DOMAIN}`);
  });
});

describe("delivery preview on a configuration with a problem", () => {
  it.each<[string, unknown, Record<string, string>]>([
    ["an empty description", { ...PROJECT, domain: "  " }, {}],
    ["an empty list", { ...PROJECT, tasks: [] }, {}],
    ["an empty entry", { ...PROJECT, tasks: [FIRST, "", THIRD] }, {}],
    ["two entries that are the same task", { ...PROJECT, tasks: [FIRST, SECOND, FIRST] }, {}],
    ["both a single task and a list", { ...PROJECT, task: { intent: FIRST } }, {}],
    ["a custom check that can't be loaded", { ...PROJECT, gate: { type: "custom", modulePath: "./gates/nope.mjs" } }, {}],
  ])("with %s, says exactly what delivery validate says", async (_, config, files) => {
    const repo = repoWith(config, files);
    const validate = await delivery(["validate"], { cwd: repo });
    const preview = await delivery(["preview"], { cwd: repo });
    expect(validate.exitCode).toBe(EXIT.configuration);
    expect(preview.stderr).toBe(validate.stderr);
    expect(preview.stdout).toBe("");
    expect(preview.exitCode).toBe(EXIT.configuration);
  });

  it("refuses roles still set in the file, in the words validate uses", async () => {
    const repo = repoWith({ ...PROJECT, roles: { worker: { systemPromptFragment: "Be careful." } } });
    const preview = await delivery(["preview"], { cwd: repo });
    const validate = await delivery(["validate"], { cwd: repo });
    expect(preview.exitCode).toBe(EXIT.configuration);
    expect(preview.stderr).toContain("`roles` is no longer used. Put any instructions for the agent in `agent.append` instead.");
    expect(preview.stderr).toBe(validate.stderr);
  });
});

describe("delivery preview changes nothing", () => {
  it("leaves the repository and its run records as they were", async () => {
    const repo = repoWith(PROJECT);
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST });
    const status = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() });
    const before = { status: status(), runs: readdirSync(runsRoot(repo), { recursive: true }) };

    expect((await delivery(["preview"], { cwd: repo })).exitCode).toBe(EXIT.ok);

    expect({ status: status(), runs: readdirSync(runsRoot(repo), { recursive: true }) }).toEqual(before);
  });
});

describe("delivery preview --queue-index", () => {
  it("shows the task with that number, counted as Task N of M counts", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, exitCode } = await delivery(["preview", "--queue-index", "3"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe(`Task 3 of 3: ${THIRD}`);
    expect(stdout).toContain(`"intent": "${THIRD}"`);
    expect(stdout).toContain(DOMAIN);
  });

  it("shows a task that is already done, when asked for it by number", async () => {
    const repo = repoWith(PROJECT);
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: FIRST, outcome: CLOSED });
    const { stdout } = await delivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(stdout.split("\n")[0]).toBe(`Task 1 of 3: ${FIRST}`);
  });

  it("refuses a number past the end of the list, saying how many there are", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, stderr, exitCode } = await delivery(["preview", "--queue-index", "9"], { cwd: repo });
    expect(stderr).toBe(`${noSuchTask(9, 3)}\n`);
    expect(noSuchTask(9, 3)).toBe("There's no task 9; your queue has 3.");
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it.each(["0", "-1", "two", "1.5"])("refuses %s, which is not a task number", async (value) => {
    const repo = repoWith(PROJECT);
    const { stderr, exitCode } = await delivery(["preview", `--queue-index=${value}`], { cwd: repo });
    expect(stderr).toContain(TASK_NUMBER);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("refuses a number for a project with a single `task`, which has no list to count in", async () => {
    const repo = repoWith({ task: { intent: FIRST } });
    const { stderr, exitCode } = await delivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(stderr).toBe(`${SINGLE_TASK}\n`);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("says what delivery run says when there is no task at all, number or not", async () => {
    const repo = repoWith({ domain: DOMAIN });
    const { stderr, exitCode } = await delivery(["preview", "--queue-index", "1"], { cwd: repo });
    expect(stderr).toBe(`${NO_TASK}\n`);
    expect(exitCode).toBe(EXIT.configuration);
  });
});

describe("what a preview says beside the instructions", () => {
  it("says the instructions are added to Claude Code's own", () => {
    expect(previewIntro("worker")).toBe("What the worker will be told (before any run starts), added to Claude Code's own instructions:");
  });

  it("says the operator's own setup also applies, and that every tool it allows is there", () => {
    expect(OWN_SETUP).toEqual([
      "Your own Claude Code settings, CLAUDE.md, skills, plugins, hooks and MCP servers also apply.",
      "It can use every tool your setup allows.",
    ]);
  });

  it("names the agent options the run will pass, without the added text it has already shown", () => {
    expect(agentOptionsLine(undefined)).toBe("Agent options: none.");
    expect(agentOptionsLine({ append: "x" })).toBe("Agent options: none.");
    expect(agentOptionsLine({ model: "opus", effort: "high", maxTurns: 40, append: "x" })).toBe('Agent options: model "opus", effort "high", maxTurns 40.');
  });

  it("prints them after the instructions", async () => {
    const repo = initTempRepo("preview-setup-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ task: { intent: FIRST }, agent: { model: "opus" } }) });
    const { stdout } = await delivery(["preview"], { cwd: repo });
    const lines = stdout.trimEnd().split("\n");
    expect(lines.slice(-3)).toEqual([...OWN_SETUP, 'Agent options: model "opus".']);
  });
});

const WORKFLOWS = {
  "plan-then-build": {
    steps: [
      { name: "plan", prompt: "Write a short plan to PLAN.md.", gate: { type: "file-exists", path: "PLAN.md" } },
      { name: "build", prompt: "Carry out PLAN.md.", continue: true, agent: { model: "opus" } },
    ],
  },
};

describe("delivery preview --step", () => {
  it("prints the step's exact instructions and its effective agent options", async () => {
    const repo = repoWith({ ...PROJECT, agent: { effort: "high" }, workflows: WORKFLOWS });
    const { stdout, exitCode } = await delivery(["preview", "--step", "build"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(stepHeading(2, 2, "plan-then-build", "build"));
    expect(stdout).toContain('## Step\nStep 2 of 2, "build":\nCarry out PLAN.md.');
    expect(stdout).toContain("the command `npm test`"); // build names no gate: the project's
    expect(stdout.endsWith(`${agentOptionsLine({ effort: "high", model: "opus" })}\n`)).toBe(true);
  });

  it("says when a step continues the previous step's session, and only then", async () => {
    const repo = repoWith({ ...PROJECT, workflows: WORKFLOWS });
    expect((await delivery(["preview", "--step", "build"], { cwd: repo })).stdout).toContain(CONTINUES);
    expect((await delivery(["preview", "--step", "plan"], { cwd: repo })).stdout).not.toContain(CONTINUES);
  });

  it("shows a step's own gate in its Acceptance", async () => {
    const repo = repoWith({ ...PROJECT, workflows: WORKFLOWS });
    const { stdout } = await delivery(["preview", "--step", "plan"], { cwd: repo });
    expect(stdout).toContain("test -f 'PLAN.md'");
  });

  it("previews a task typed on the command line", async () => {
    const repo = repoWith({ gate: PROJECT.gate, workflows: WORKFLOWS });
    const { stdout } = await delivery(["preview", "--task", "add a rota page", "--step", "plan"], { cwd: repo });
    expect(stdout).toContain('"intent": "add a rota page"');
  });

  it("refuses a step no workflow has", async () => {
    const repo = repoWith({ ...PROJECT, workflows: WORKFLOWS });
    const { stderr, exitCode } = await delivery(["preview", "--step", "ship"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(noSuchStep("ship"));
  });

  it("asks which workflow when two have the step", async () => {
    const repo = repoWith({ ...PROJECT, workflows: { ...WORKFLOWS, other: { steps: [{ name: "plan", prompt: "x" }] } } });
    const { stderr, exitCode } = await delivery(["preview", "--step", "plan"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(stepInMany("plan", ["plan-then-build", "other"]));
    expect((await delivery(["preview", "--step", "plan", "--workflow", "other"], { cwd: repo })).exitCode).toBe(EXIT.ok);
  });

  it("leaves a preview without --step unchanged", async () => {
    const repo = repoWith({ ...PROJECT, workflows: WORKFLOWS });
    expect((await delivery(["preview"], { cwd: repo })).stdout).not.toContain("## Step");
  });
});

describe("delivery preview with an unmatched {{task.<field>}} placeholder", () => {
  const TYPO = {
    "plan-then-build": { steps: [{ name: "plan", prompt: "Read {{task.sepc}} and plan.", gate: { type: "file-exists", path: "PLAN.md" } }] },
  };

  it("warns, naming the placeholder and the step, no task in the configuration can supply it", async () => {
    const repo = repoWith({ ...PROJECT, workflows: TYPO });
    const { stdout, stderr, exitCode } = await delivery(["preview", "--step", "plan"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(`${stdout}${stderr}`).toMatch(/\{\{task\.sepc\}\}/);
    expect(stderr).toMatch(/warn/i);
    expect(stderr).toContain("plan");
  });

  it("does not warn for a placeholder the task supplies", async () => {
    const repo = repoWith({ gate: PROJECT.gate, task: { intent: FIRST, sepc: "docs/x.md" }, workflows: TYPO });
    const { stderr } = await delivery(["preview", "--step", "plan"], { cwd: repo });
    expect(stderr).not.toMatch(/warn/i);
  });
});
