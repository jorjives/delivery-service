// Slice 5: Tune a Role's Instructions and Tools From the Configuration File
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-22 against commit 3db4bb7
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js) against a throwaway git repository. The
// UAT and the "runs use the overridden roles" acceptance criterion also drive a
// real `delivery run`, routed to the vendored scripted agent through the
// contributor-only test seam (TEST_MOCK_SCRIPT), so the whole file needs no
// network, no API key and no real Claude Code sign-in.
//
// The tool-refusal acceptance criterion is intentionally not driven here:
// claude-mock models no tool permissions and makes no tool calls
// (docs/testing-your-pipeline.md, "What the scripted agent cannot prove"), so a
// live run can never observe a refusal. It is proven at the guard itself in
// src/tool-authority.test.ts, which this file's skip idiom points to.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../../src/role-config.js";
import { EXIT } from "../../src/cli/failures.js";
import { git, runDelivery } from "../helpers.js";

// Distinct in their first five words: a run id is derived from that many
// leading words plus a second-granularity timestamp, and two tasks starting
// in the same second must not collide on one run directory (see slice 2's
// UAT, tests/project-configuration/2-*.test.ts).
const COMPLETE = {
  domain: "A small tool that greets people by name.",
  tasks: ["add a function that says hello", "add a function that waves at a name"],
  gate: { type: "command", command: "npm test", parseMode: "exitcode" },
  closer: { type: "commit-to-branch" },
};

const OPS_RULE = "Never modify anything under the ops folder.";
const NARROW_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"];

/** A throwaway git repository, seeded the way a UAT walkthrough would set one up. */
function freshRepo(config: unknown, prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample-project", version: "1.0.0" }));
  if (config !== undefined) writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config, null, 2));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function writeConfig(repo: string, config: unknown): void {
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config, null, 2));
}

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-5-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function completesWith(intent: string, path: string, content: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } };
}

const RUN_TIMEOUT = 60_000;

describe("UAT: sharpen what an agent is told, or narrow what it may touch, by editing one file", () => {
  it("validates and previews a narrowed worker, then refuses once the instruction is emptied", () => {
    const repo = freshRepo(COMPLETE, "uat-slice-5-");

    // Step 1: give the worker an instruction and a tools list without Bash.
    writeConfig(repo, { ...COMPLETE, roles: { worker: { systemPromptFragment: OPS_RULE, allowedTools: NARROW_TOOLS } } });

    // Step 2: `delivery validate`, then `delivery preview`.
    const validate = runDelivery(["validate"], { cwd: repo });
    expect(validate.status).toBe(EXIT.ok);
    expect(validate.stdout).toContain("✓ worker: your own instructions and tool list");

    const preview = runDelivery(["preview"], { cwd: repo });
    expect(preview.status).toBe(EXIT.ok);
    const framed = preview.stdout.split("\n").slice(4).join("\n");
    expect(framed.startsWith(OPS_RULE)).toBe(true);
    expect(preview.stdout).toContain("Tools it can use: read files, look through the project, edit files.");
    expect(preview.stdout).not.toContain("run commands");

    // Step 3: empty the instruction's quotes and validate again.
    writeConfig(repo, { ...COMPLETE, roles: { worker: { systemPromptFragment: "", allowedTools: NARROW_TOOLS } } });
    const emptied = runDelivery(["validate"], { cwd: repo });
    expect(emptied.stderr.trimEnd()).toContain(
      "`roles.worker.systemPromptFragment`, the instructions for the worker, is empty. " +
        "Write a sentence, or remove it to keep the built-in one.",
    );
    expect(emptied.status).toBe(EXIT.configuration);
  });
});

describe("acceptance criteria", () => {
  it("overrides worker and gate maintenance separately; a field left out keeps its shipped value", () => {
    const repo = freshRepo({ ...COMPLETE, roles: { worker: { systemPromptFragment: OPS_RULE } } }, "uat-slice-5-partial-");

    // The worker's instructions changed, but its tools stayed the shipped list (Bash included).
    const worker = runDelivery(["preview"], { cwd: repo });
    expect(worker.stdout).toContain(OPS_RULE);
    expect(worker.stdout).toContain("run commands");

    // Gate maintenance, never mentioned in the file, is exactly the shipped role.
    const gate = runDelivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(gate.stdout).toContain(gateMaintenanceRoleConfig.systemPromptFragment);
  });

  it(
    "uses the overridden worker for a run from a queue and for a single ad-hoc task; triage cannot be changed from the file",
    async () => {
      const repo = freshRepo(
        { ...COMPLETE, roles: { worker: { systemPromptFragment: OPS_RULE, allowedTools: NARROW_TOOLS } } },
        "uat-slice-5-queue-",
      );
      const script = await scriptFile({
        expectations: [
          completesWith(COMPLETE.tasks[0] as string, "hello.js", "export const hello = () => 'hello';\n"),
          completesWith(COMPLETE.tasks[1] as string, "wave.js", "export const wave = () => 'wave';\n"),
        ],
      });
      const queued = runDelivery(["run"], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: script, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-slice-5-state-")) },
      });
      expect(queued.status).toBe(EXIT.ok);
      expect(queued.stdout).toContain("Task 1 of 2");
      expect(queued.stdout).toContain("Task 2 of 2");

      const adHocIntent = "add a function that counts to three, with a test";
      const adHocScript = await scriptFile({
        expectations: [completesWith(adHocIntent, "count.js", "export const count = () => 3;\n")],
      });
      const adHoc = runDelivery(["run", "--task", adHocIntent], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: adHocScript, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-slice-5-state-")) },
      });
      expect(adHoc.status).toBe(EXIT.ok);

      // Triage is not a name `roles` accepts: it stays the harness's own, whatever the file says.
      writeConfig(repo, { ...COMPLETE, roles: { triage: { allowedTools: ["Read"] } } });
      const triage = runDelivery(["validate"], { cwd: repo });
      expect(triage.stderr.trimEnd()).toContain(
        "`roles` has no role called `triage`. Only `worker` and `gateMaintenance` can be changed here, so remove it to keep the built-in one.",
      );
      expect(triage.status).toBe(EXIT.configuration);
    },
    RUN_TIMEOUT * 2,
  );

  it("shows the overridden instructions and tools list for the role chosen with --role", () => {
    const repo = freshRepo(
      { ...COMPLETE, roles: { gateMaintenance: { systemPromptFragment: "Only ever touch files under src/.", allowedTools: ["Read", "Edit"] } } },
      "uat-slice-5-role-",
    );
    const { stdout, status } = runDelivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain("Only ever touch files under src/.");
    expect(stdout).toContain("Tools it can use: read files, edit files.");
  });

  it.each([
    [
      "an unknown role",
      { roles: { triage: { allowedTools: ["Read"] } } },
      "`roles` has no role called `triage`. Only `worker` and `gateMaintenance` can be changed here, so remove it to keep the built-in one.",
    ],
    [
      "an unknown field",
      { roles: { worker: { tools: ["Read"] } } },
      "`roles.worker` has no setting called `tools`. It takes `systemPromptFragment` and `allowedTools`, so remove it to keep the built-in one.",
    ],
    [
      "empty instructions",
      { roles: { worker: { systemPromptFragment: "" } } },
      "`roles.worker.systemPromptFragment`, the instructions for the worker, is empty. Write a sentence, or remove it to keep the built-in one.",
    ],
    [
      "an empty tools list",
      { roles: { worker: { allowedTools: [] } } },
      "`roles.worker.allowedTools`, the tools the worker may use, is empty. Name at least one, or remove it to keep the built-in one.",
    ],
  ])("refuses %s with a plain-language message naming the field and the way back to the built-in one", (_label, roles, fragment) => {
    const repo = freshRepo({ ...COMPLETE, ...roles }, "uat-slice-5-refuse-");
    const { stderr, status } = runDelivery(["validate"], { cwd: repo });
    expect(stderr).toContain(fragment);
    expect(status).toBe(EXIT.configuration);
  });

  // SKIPPED AC: "A tool the file does not permit is refused to the agent during a
  // run exactly as the shipped tool enforcement already refuses tools." claude-mock
  // makes no tool calls and enforces no permissions (docs/testing-your-pipeline.md),
  // so no live run here can observe a refusal happening or not happening. Proven at
  // the guard itself in src/tool-authority.test.ts ("denies a tool outside the
  // role's list" and its neighbours), which exercises createToolAuthority directly
  // with a merged role from rolesFor.
  it.skip("refuses a tool the file does not permit, exactly as the shipped enforcement refuses tools (proven in src/tool-authority.test.ts)", () => {});

  it("behaves exactly as before this slice when the file has no `roles` section", () => {
    const repo = freshRepo(COMPLETE, "uat-slice-5-none-");
    const { stdout } = runDelivery(["preview"], { cwd: repo });
    expect(stdout).toContain(workerRoleConfig.systemPromptFragment);
    expect(stdout).toContain("run commands");
  });

  it("documents the override keys and says a misspelled tool name surfaces at run time, not in validate", async () => {
    const { readFile } = await import("node:fs/promises");
    const guide = await readFile(join(import.meta.dirname, "..", "..", "docs", "configuring-a-role.md"), "utf-8");
    expect(guide).toContain("`roles.worker.systemPromptFragment`");
    expect(guide).toContain("`roles.worker.allowedTools`");
    expect(guide).toContain("`roles.gateMaintenance.systemPromptFragment`");
    expect(guide).toContain("`roles.gateMaintenance.allowedTools`");
    expect(guide).toContain("A misspelled tool name is not caught by `delivery validate`.");
    expect(guide).toContain("A misspelling shows up during a run instead");
  });
});
