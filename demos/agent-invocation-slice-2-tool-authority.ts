/**
 * UAT demo for Agent Invocation Primitive Slice 2: A Role Cannot Act Outside
 * What It Was Given Permission to Touch.
 *
 * Configures a role with a deliberately narrow permitted-tools list, has it
 * reach for a tool outside that list, and prints both halves of the refusal:
 * what the session is told, and what the harness reports back.
 *
 * READ THIS BEFORE TRUSTING THE OUTPUT: `claude-mock` models no tool
 * permissions, so it cannot be scripted to issue an out-of-role call. Sections
 * 2 and 3 therefore drive the harness's own decision path — the exact functions
 * the SDK calls and the exact terminus `invoke` returns — rather than routing
 * through the mock. Section 4 runs one real `invoke()` through the mock to show
 * the guard is genuinely installed on the live call path. Full end-to-end
 * enforcement rests on the real agent runtime. This is a known, documented gap.
 *
 * Requires `claude-mock` on PATH for section 4. It is a sibling project, not
 * vendored in this repo: install it with `npm link` from its own checkout. No
 * live API call is made, and no API key is needed.
 *
 * Usage: npx tsx demos/agent-invocation-slice-2-tool-authority.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create } from "../src/case-file.js";
import { invoke } from "../src/agent-invoke.js";
import { WorkerEnvelope } from "../src/role-config.js";
import { authorityRefusal, createToolAuthority } from "../src/tool-authority.js";
import { isOnPath } from "../src/on-path.js";
import type { RoleConfig } from "../src/role-config.js";
import type { AgentContext } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

/** A worker allowed to look, never to touch. The narrow list is the whole point. */
const readOnlyWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: "You are a read-only worker: report what you find, change nothing.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep"],
};

const OUT_OF_ROLE_TOOL = "Bash";

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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-authority-case-"));
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "agent-authority-tree-"));
  const scriptPath = path.join(dir, "mock.json");

  await create(
    dir,
    {
      surfaceId: "authority-demo",
      taskDef: { intent: "report on the greeting endpoint" },
      gateRef,
      domainPrompt: "This is a small HTTP service.",
    },
    budgets,
  );

  console.log("1. The role's configuration");
  console.log(`   Role:            ${readOnlyWorker.role}`);
  console.log(`   Permitted tools: ${readOnlyWorker.allowedTools.join(", ")}`);
  console.log(`   Attempted tool:  ${OUT_OF_ROLE_TOOL} (outside the permitted list)\n`);

  // The guard the SDK consults before every tool call, driven directly.
  const authority = createToolAuthority(readOnlyWorker);
  const decision = await authority.canUseTool(
    OUT_OF_ROLE_TOOL,
    { command: "rm -rf build" },
    { signal: new AbortController().signal },
  );

  console.log("2. What the session is told when it reaches outside that list");
  console.log(`   Decision: ${decision.behavior}`);
  if (decision.behavior === "deny") console.log(`   Message:  ${decision.message}\n`);

  const terminus = authorityRefusal(readOnlyWorker, authority.attempted, []);
  console.log("3. What the harness reports back");
  console.log(`   Result: ${terminus?.status ?? "(no refusal recorded)"}`);
  console.log(`   Reason: ${terminus?.rationale ?? "-"}\n`);

  // One real invocation, to show the guard is installed on the live call path.
  fs.writeFileSync(
    scriptPath,
    JSON.stringify([{ json: { status: "completed", rationale: "read the handler, changed nothing" } }]),
    "utf-8",
  );
  const ctx: AgentContext = { worktreePath, dir, sessionKey: "worker-1-0" };
  const clean = await invoke(readOnlyWorker, ctx, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  });

  console.log("4. A real invocation with the guard installed (via claude-mock)");
  console.log(`   Result: ${clean.status} — ${clean.rationale}`);
  console.log(
    "   Note:   claude-mock models no tool permissions, so it cannot be scripted to\n" +
      "           attempt an out-of-role call. Sections 2 and 3 drive the harness's own\n" +
      "           decision path directly; the end-to-end guarantee rests on the real\n" +
      "           agent runtime. Known gap, stated rather than papered over.\n" +
      "           One residual: the guard sees only calls the runtime would prompt\n" +
      "           about, so an out-of-role read-only call is auto-approved and never\n" +
      "           refused. Mutating tools — where the blast radius is — all pass here.",
  );
}

await main();
