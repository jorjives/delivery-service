// Multi-surface supervisor, slice 5: an owner sees a broken shared environment
// repaired once for the whole run by following docs/shared-environment.md in
// examples/shared-environment-example. This runs the guide's own commands, in
// order, against the compiled command and a copy of the example, with the agent
// routed to the vendored scripted agent, and checks what the guide says you will
// see is what the command prints. The fixture's own shape is checked here too:
// one fixture, one guide, one test.

import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { writeMockScript } from "../src/testing.js";
import type { MockScript } from "../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { documented, git, outputBlock, REPO_ROOT, runDelivery, sectionOf, useScratch } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/shared-environment.md"), "utf-8");
const EXAMPLE = join(REPO_ROOT, "examples", "shared-environment-example");
const RUN_TIMEOUT = 180_000;
const STEP = {
  get: "## 1. Get the example project",
  break: "## 2. Break the shared helper and run the list",
  status: "## 3. See what stopped it",
  fix: "## 4. Put it back and carry on",
  comesAndGoes: "## 5. A helper that comes and goes",
  lookBack: "## 6. Look back at the repair",
} as const;

const scratch = useScratch();

describe("the shared-environment example", () => {
  it("checks in four tasks, two at a time, and a check kept outside every task's copy", () => {
    const config = JSON.parse(readFileSync(join(EXAMPLE, "delivery.config.json"), "utf-8"));
    expect(config.tasks).toHaveLength(4);
    expect(config.concurrency).toBe(2);
    expect(config.gate).toEqual({ type: "custom", modulePath: "./check.mjs" });
  });

  it("passes its own check as shipped, and cannot run it once the shared helper is gone", async () => {
    const copy = scratch("shared-environment-shape-");
    cpSync(EXAMPLE, copy, { recursive: true });
    const check = (await import(pathToFileURL(join(copy, "check.mjs")).href)).default;
    expect((await check.baseline({ worktreePath: copy })).status).toBe("PASS");
    rmSync(join(copy, "shared", "helper.json"));
    expect(await check.check({ worktreePath: copy })).toMatchObject({ status: "ERROR", detail: expect.stringContaining("shared helper") });
  });

  it("ships only its source, its check, its helper and its configuration", () => {
    expect(readdirSync(EXAMPLE).sort()).toEqual(["README.md", "check.mjs", "delivery.config.json", "package.json", "shared", "text.js", "text.test.js"]);
  });

  it("does not answer the first copies to check their work while an outage is set, then answers again", async () => {
    const copy = scratch("shared-environment-outage-");
    const other = scratch("shared-environment-outage-other-");
    cpSync(EXAMPLE, copy, { recursive: true });
    cpSync(EXAMPLE, other, { recursive: true });
    writeFileSync(join(copy, "shared", "outage.json"), JSON.stringify({ tasks: 1, checks: 2 }));
    const check = (await import(pathToFileURL(join(copy, "check.mjs")).href)).default;

    // The starting point is never affected: only a check of finished work is.
    expect((await check.baseline({ worktreePath: copy })).status).toBe("PASS");
    expect(await check.check({ worktreePath: copy })).toMatchObject({ status: "ERROR", detail: expect.stringContaining("did not answer") });
    expect((await check.check({ worktreePath: copy })).status).toBe("ERROR");
    expect((await check.check({ worktreePath: copy })).status).toBe("PASS");
    // One copy was to be affected, and one has been.
    expect((await check.check({ worktreePath: other })).status).toBe("PASS");
  });
});

/** A fresh copy of the example as step 1 sets it up, and an agent whose every session answers "done" and writes a small file. */
async function freshCopy(prefix: string): Promise<{ repo: string; env: NodeJS.ProcessEnv }> {
  const repo = scratch(prefix);
  cpSync(EXAMPLE, repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "start"]);
  const script: MockScript = { expectations: [{ effects: [{ write: { path: "note.txt", content: "done\n" } }], json: { status: "completed", rationale: "done" } }] };
  const scriptPath = join(scratch("shared-environment-script-"), "mock.json");
  await writeMockScript(scriptPath, script);
  return { repo, env: { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("shared-environment-state-") } };
}

describe("docs/shared-environment.md", () => {
  let repo: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    ({ repo, env } = await freshCopy("shared-environment-guide-"));
  });

  // Two tasks run at once and either may reach its check first, so "It was
  // first noticed by …" names whichever task won that race, not always the
  // one the guide happens to show.
  const noticedByEither = /^It was first noticed by \[\d+\/4\] add a function that (?:turns a title into a URL slug|shortens long text to a given length), with a test: the shared helper \S+ is missing, so the check cannot run\.$/m;

  // The held tasks are listed in the order they reached their check, so either order is right.
  const heldEither = /^Held: \[\d+\/4\] add a function that (?:turns a title into a URL slug|shortens long text to a given length), with a test, \[\d+\/4\] add a function that (?:turns a title into a URL slug|shortens long text to a given length), with a test\.$/m;

  const expectShown = (stdout: string, section: string) => {
    for (const line of outputBlock(sectionOf(guide, section)).filter((shown) => shown !== "…")) {
      if (line.startsWith("It was first noticed by ")) {
        expect(stdout, `the guide shows "${line}"`).toMatch(noticedByEither);
        continue;
      }
      if (line.startsWith("Held: ")) {
        expect(stdout, `the guide shows "${line}"`).toMatch(heldEither);
        expect(stdout).not.toMatch(/^Held: .*slug.*slug|^Held: .*shortens.*shortens/m);
        continue;
      }
      expect(stdout, `the guide shows "${line}"`).toMatch(documented(line));
    }
  };

  it("stops the run naming the shared environment when its helper is gone", () => {
    rmSync(join(repo, "shared", "helper.json"));
    const { stdout, status } = runDelivery(["run"], { cwd: repo, env });
    expect(status).toBe(EXIT.escalated);
    expectShown(stdout, STEP.break);
  }, RUN_TIMEOUT);

  it("says what stopped it, first", () => {
    const { stdout } = runDelivery(["status"], { cwd: repo, env });
    expectShown(stdout, STEP.status);
  });

  it("carries the held tasks on once the helper is back", () => {
    git(repo, ["checkout", "--", "shared/helper.json"]);
    const { stdout, status } = runDelivery(["run"], { cwd: repo, env });
    expect(status).toBe(EXIT.ok);
    expectShown(stdout, STEP.fix);
  }, RUN_TIMEOUT);
});

describe("docs/shared-environment.md, when the helper comes and goes", () => {
  let repo: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    ({ repo, env } = await freshCopy("shared-environment-outage-guide-"));
  });

  const shown = (section: string) => outputBlock(sectionOf(guide, section)).filter((line) => line !== "…");

  it("treats the second task to hit it as a shared problem, repairs once and finishes the list", () => {
    // The guide's own command: echo '{ "tasks": 2, "checks": 4 }' > shared/outage.json
    expect(sectionOf(guide, STEP.comesAndGoes)).toContain(`echo '{ "tasks": 2, "checks": 4 }' > shared/outage.json`);
    writeFileSync(join(repo, "shared", "outage.json"), '{ "tasks": 2, "checks": 4 }\n');

    const { stdout, status } = runDelivery(["run"], { cwd: repo, env });

    expect(status).toBe(EXIT.ok);
    for (const line of shown(STEP.comesAndGoes)) expect(stdout, `the guide shows "${line}"`).toMatch(documented(line));
    expect(stdout.split("\n").filter((line) => line.startsWith("  - repairing"))).toHaveLength(1);
  }, RUN_TIMEOUT);

  it("shows the repair when looking back", () => {
    const { stdout } = runDelivery(["status"], { cwd: repo, env });
    for (const line of shown(STEP.lookBack)) expect(stdout, `the guide shows "${line}"`).toMatch(documented(line));
  });
});
