// Slice 3: Configure a Second Role Using the Same Seam, Nothing Rebuilt
// Source: docs/superpowers/specs/2026-09-09-agent-invocation-primitive-slices.md
// Recorded: 2026-09-10 against commit fd66a9795e1e98ebec9506c5801e7d64478d5742

//
// Drives the slice's own UAT demo script (npx tsx demos/agent-invocation-slice-3-gate-maintenance.ts)
// and asserts on its printed output, covering the slice's UAT and its acceptance criteria.
//
// Requires `claude-mock` (a sibling project, not vendored here) on PATH for the demo's clean-
// completion scenario. When it is absent the demo prints an explanatory message and exits non-zero
// rather than crashing; this test asserts on that message in that case instead of failing opaquely.
//
// Per the slice's own documented limit, `claude-mock` models no tool permissions, so the "tries to
// edit a project check" scenario drives the harness's own decision path (createToolAuthority,
// authorityRefusal) directly rather than through a scripted mock session — the demo's section 3.
// Full end-to-end enforcement rests on the real agent runtime (same gap as Slice 2).

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { runTsx, REPO_ROOT } from "../helpers.js";
import { join } from "node:path";

describe("UAT: configure a second role using the same seam, nothing rebuilt", () => {
  const { stdout, status } = runTsx(["demos/agent-invocation-slice-3-gate-maintenance.ts"]);

  const mockMissing = stdout.includes("claude-mock is not on PATH");

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion, or explains plainly that claude-mock is required", () => {
    if (mockMissing) {
      expect(status).not.toBe(0);
      expect(stdout).toContain("claude-mock is not on PATH");
      return;
    }
    expect(status).toBe(0);
  });

  it.skipIf(mockMissing)(
    "AC: the gate-maintenance role is invoked through the identical seam used for the worker — a new configuration, not new code",
    () => {
      const s = section("1. The gate-maintenance role's configuration", "2. Scenario: repair");
      expect(s).toContain("Role:            gate-maintenance");
      expect(s).toContain("Permitted tools: Read, Glob, Grep, Edit, Write");
      expect(s).toContain("Invocation code: the same invoke() the worker uses; only this config differs");
    },
  );

  it.skipIf(mockMissing)(
    "AC: a gate-maintenance session that repairs the environment cleanly returns a completed result, exactly as the worker's clean-completion case does",
    () => {
      const s = section("2. Scenario: repair", "3. Scenario: try to edit");
      expect(s).toContain('Before: .env = "PORT=\\n"');
      expect(s).toContain('After:  .env = "PORT=8080\\n"');
      expect(s).toContain("Result: completed");
    },
  );

  it.skipIf(mockMissing)(
    "AC: gate-maintenance's config grants it Edit, but it cannot reach the project's actual checks — only the surrounding environment — even though Edit is within its permitted tools",
    () => {
      const s = section("3. Scenario: try to edit", "4. What this shows");
      expect(s).toContain("(Edit IS in this role's permitted tools)");
      expect(s).toContain("Decision: deny");
      expect(s).toContain("Result:   incomplete");
      expect(s).toContain("which is outside the worktree, so the harness refused the call before it ran");
      expect(s).toContain("Check file unchanged: yes");
    },
  );

  it("AC: a reference configuration and a short written guide exist for both roles, and following it alone gets a first successful invocation for either role, no source required", () => {
    const guide = readFileSync(join(REPO_ROOT, "docs/configuring-a-role.md"), "utf-8");

    // Both roles named with their own reference config, importable from the single entry point.
    expect(guide).toContain('role: "worker"');
    expect(guide).toContain('role: "gate-maintenance"');
    expect(guide).toContain("workerRoleConfig");
    expect(guide).toContain("gateMaintenanceRoleConfig");
    expect(guide).toContain('import { WorkerEnvelope, type RoleConfig } from "./src/index.js"');

    // A runnable first invocation, not just a description.
    expect(guide).toContain("await invoke(");
    expect(guide).toContain("npm run demo:agent-slice-1");
    expect(guide).toContain("npm run demo:agent-slice-3");
  });
});
