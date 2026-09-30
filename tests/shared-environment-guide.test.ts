// Multi-surface supervisor, slice 5: an owner sees a broken shared environment
// repaired once for the whole run by following docs/shared-environment.md in
// examples/shared-environment-example. This runs the guide's own commands, in
// order, against the compiled command and a copy of the example, with the agent
// routed to the vendored scripted agent, and checks what the guide says you will
// see is what the command prints. The fixture's own shape is checked here too:
// one fixture, one guide, one test.

import { cpSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
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
} as const;

const scratch = useScratch();

describe("docs/shared-environment.md", () => {
  let repo: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    repo = scratch("shared-environment-guide-");
    cpSync(EXAMPLE, repo, { recursive: true });
    git(repo, ["init", "-b", "main"]);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "start"]);
    // Every session answers "done" and writes a small file: a repair that says it fixed things but cannot reach the helper.
    const script: MockScript = { expectations: [{ effects: [{ write: { path: "note.txt", content: "done\n" } }], json: { status: "completed", rationale: "done" } }] };
    const scriptPath = join(scratch("shared-environment-script-"), "mock.json");
    await writeMockScript(scriptPath, script);
    env = { [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("shared-environment-state-") };
  });

  const expectShown = (stdout: string, section: string) => {
    for (const line of outputBlock(sectionOf(guide, section)).filter((shown) => shown !== "…")) {
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
