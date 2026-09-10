/**
 * UAT demo for Agent Invocation Primitive Slice 3: Configure a Second Role
 * Using the Same Seam, Nothing Rebuilt.
 *
 * Runs the reference gate-maintenance configuration through the same
 * `invoke()` the worker uses, against a scripted session that repairs a broken
 * environment file; then has the role reach for one of the project's checks,
 * kept outside the worktree, and prints the refusal.
 *
 * READ THIS BEFORE TRUSTING THE OUTPUT: `claude-mock` models no tool
 * permissions, so it cannot be scripted to issue a tool call the harness then
 * refuses. Scenario 2 therefore drives the harness's own decision path — the
 * exact guard the SDK consults and the exact terminus `invoke` returns — as the
 * Slice 2 demo does. The live guarantee rests on the real agent runtime.
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed.
 *
 * Usage: npx tsx demos/agent-invocation-slice-3-gate-maintenance.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create } from "../src/case-file.js";
import { invoke } from "../src/agent-invoke.js";
import { gateMaintenanceRoleConfig } from "../src/role-config.js";
import { authorityRefusal, createToolAuthority } from "../src/tool-authority.js";
import { isOnPath } from "../src/on-path.js";
import type { AgentContext } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

function requireMock(): void {
  if (isOnPath("claude-mock")) return;
  console.error(
    "claude-mock is not on PATH.\n\n" +
      "It is a scripted fake `claude` binary from a sibling project, deliberately not\n" +
      "vendored into this repo. Install it with `npm link` from its own checkout, then\n" +
      "run this demo again. Nothing here calls a live API.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  requireMock();

  const run = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-maint-"));
  const dir = path.join(run, "case");
  const worktreePath = path.join(run, "tree");
  const checksDir = path.join(run, "checks");
  for (const d of [dir, worktreePath, checksDir]) fs.mkdirSync(d, { recursive: true });

  // The environment the gate needs, broken: PORT is empty, so the service cannot start.
  const envFile = path.join(worktreePath, ".env");
  fs.writeFileSync(envFile, "PORT=\n", "utf-8");

  // One of the project's actual checks, pinned outside the worktree.
  const checkFile = path.join(checksDir, "greeting.check.sh");
  fs.writeFileSync(checkFile, "curl -sf localhost:$PORT/greeting | grep -q hello\n", "utf-8");

  const gateRef: GateRef = { type: "command", command: `sh ${checkFile}`, parseMode: "tap" };
  await create(
    dir,
    {
      surfaceId: "gate-maintenance-demo",
      taskDef: { intent: "the gate cannot start the service: repair its environment" },
      gateRef,
      domainPrompt: "This is a small HTTP service configured through .env.",
    },
    budgets,
  );

  console.log("1. The gate-maintenance role's configuration");
  console.log(`   Role:            ${gateMaintenanceRoleConfig.role}`);
  console.log(`   Permitted tools: ${gateMaintenanceRoleConfig.allowedTools.join(", ")}`);
  console.log(`   Worktree:        ${worktreePath}`);
  console.log(`   Project checks:  ${checksDir} (outside the worktree)`);
  console.log("   Invocation code: the same invoke() the worker uses; only this config differs\n");

  console.log("2. Scenario: repair a broken environment file");
  console.log(`   Before: .env = ${JSON.stringify(fs.readFileSync(envFile, "utf-8"))}`);
  const scriptPath = path.join(run, "mock.json");
  fs.writeFileSync(
    scriptPath,
    JSON.stringify([
      {
        effects: [{ edit: { path: ".env", old: "PORT=", new: "PORT=8080" } }],
        json: { status: "completed", rationale: "set the missing PORT in .env so the service can start" },
      },
    ]),
    "utf-8",
  );
  const ctx: AgentContext = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
  const repaired = await invoke(gateMaintenanceRoleConfig, ctx, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  });
  console.log(`   After:  .env = ${JSON.stringify(fs.readFileSync(envFile, "utf-8"))}`);
  console.log(`   Result: ${repaired.status} — ${repaired.rationale}\n`);

  console.log("3. Scenario: try to edit one of the project's checks");
  console.log(`   Attempt: Edit ${checkFile}`);
  console.log("            (Edit IS in this role's permitted tools)");
  const authority = createToolAuthority(gateMaintenanceRoleConfig, worktreePath);
  const decision = await authority.canUseTool(
    "Edit",
    { file_path: checkFile, old_string: "grep -q hello", new_string: "true" },
    { signal: new AbortController().signal, toolUseID: "demo-edit", requestId: "demo-request" },
  );
  console.log(`   Decision: ${decision?.behavior ?? "(none)"}`);
  const refused = authorityRefusal(gateMaintenanceRoleConfig, authority.refusals, []);
  console.log(`   Result:   ${refused?.status ?? "(no refusal recorded)"}`);
  console.log(`   Reason:   ${refused?.rationale ?? "-"}`);
  console.log(`   Check file unchanged: ${fs.readFileSync(checkFile, "utf-8").includes("grep -q hello") ? "yes" : "NO"}\n`);

  console.log("4. What this shows");
  console.log(
    "   A second, narrower role ran through the unchanged invocation seam with nothing\n" +
      "   but a new configuration, and got the same kind of result as a worker's clean\n" +
      "   completion. Its edit tools reach the environment but not the checks: a call aimed\n" +
      "   outside the worktree is refused by the same guard that refuses out-of-role tools.\n" +
      "   Note: claude-mock models no tool permissions, so scenario 3 drives the harness's\n" +
      "   own guard directly; the live guarantee rests on the real agent runtime.\n" +
      "   Guide: docs/configuring-a-role.md",
  );
}

await main();
