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
import { noSuchTask, RULE, SINGLE_TASK, TASK_NUMBER, toolsLine } from "./preview-command.js";
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

describe("the everyday phrase for each tool", () => {
  it("says what the worker's tools let it do, once each, in order", () => {
    expect(toolsLine(workerRoleConfig.allowedTools)).toBe("Tools it can use: read files, look through the project, edit files, run commands.");
  });

  it("prints a tool with no everyday phrase as written", () => {
    expect(toolsLine(["Read", "WebFetch"])).toBe("Tools it can use: read files, WebFetch.");
  });
});

describe("delivery preview", () => {
  it("names the next task, then frames the worker's instructions with the description and the task in the owner's words", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, stderr, exitCode } = await delivery(["preview"], { cwd: repo });

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 4)).toEqual([`Next up is Task 1 of 3: ${FIRST}`, "", "What the worker will be told (before any run starts):", RULE]);
    expect(lines[4]).toBe(workerRoleConfig.systemPromptFragment.split("\n")[0]);
    expect(stdout).toContain(`${workerRoleConfig.systemPromptFragment}\n\n${DOMAIN}\n\n## Task`);
    expect(stdout).toContain(`"intent": "${FIRST}"`);
    expect(stdout.endsWith(`${RULE}\n${toolsLine(workerRoleConfig.allowedTools)}\n`)).toBe(true);
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

  it("shows what the agent that repairs the check is told, and what it may do, when asked for that role", async () => {
    const repo = repoWith(PROJECT);
    const { stdout, exitCode } = await delivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("What the agent that repairs your check will be told (before any run starts):");
    expect(stdout).toContain(`${gateMaintenanceRoleConfig.systemPromptFragment}\n\n${DOMAIN}`);
    expect(stdout.endsWith(`${toolsLine(gateMaintenanceRoleConfig.allowedTools)}\n`)).toBe(true);
    expect(toolsLine(gateMaintenanceRoleConfig.allowedTools)).toBe("Tools it can use: read files, look through the project, edit files.");
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
});

describe("delivery preview on a configuration with a problem", () => {
  it.each<[string, unknown, Record<string, string>]>([
    ["no config file", undefined, {}],
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
