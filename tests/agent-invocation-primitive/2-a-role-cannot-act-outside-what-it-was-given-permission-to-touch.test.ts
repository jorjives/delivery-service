// Slice 2: A Role Cannot Act Outside What It Was Given Permission to Touch
// Source: docs/superpowers/specs/2026-09-09-agent-invocation-primitive-slices.md
// Recorded: 2026-09-10 against commit 677aadd

//
// Drives the slice's own UAT demo script (npx tsx demos/agent-invocation-slice-2-tool-authority.ts)
// and asserts on its printed output, covering the slice's UAT and its acceptance criteria.
//
// Requires `claude-mock` (a sibling project, not vendored here) on PATH — needed only for the
// demo's section 4 (a real invocation through the guard). When it is absent the demo prints an
// explanatory message and exits non-zero rather than crashing; this test asserts on that message
// in that case instead of failing opaquely.
//
// Per the slice's own documented operational gap, `claude-mock` models no tool permissions, so it
// cannot be scripted to issue an out-of-role call — the demo's sections 2 and 3 drive the
// harness's decision path (createToolAuthority, authorityRefusal) directly rather than through a
// scripted mock session. That is the slice's stated, known limit, not a hole this test papers
// over: this is why the AC assertions below read the demo's sections 2-3 rather than a mock-driven
// end-to-end run. Full end-to-end enforcement rests on the real agent runtime.
//
// AC "a role's role_cfg names the specific set of tools it is permitted to use" is also
// unit-tested directly in src/tool-authority.test.ts.

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: a role cannot act outside what it was given permission to touch", () => {
  const { stdout, status } = runTsx(["demos/agent-invocation-slice-2-tool-authority.ts"]);

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
    "AC: a role's configuration names the specific set of tools it is permitted to use",
    () => {
      const s = section("1. The role's configuration", "2. What the session is told");
      expect(s).toContain("Role:            worker");
      expect(s).toContain("Permitted tools: Read, Glob, Grep");
      expect(s).toContain("Attempted tool:  Bash (outside the permitted list)");
    },
  );

  it.skipIf(mockMissing)(
    "AC: an attempt to use a tool outside the permitted set is refused before it can take effect",
    () => {
      const s = section("2. What the session is told", "3. What the harness reports back");
      expect(s).toContain("Decision: deny");
    },
  );

  it.skipIf(mockMissing)(
    "AC: the refusal is reflected back as the same did-not-complete outcome shape, with a plain-English message naming the role, the tool, and that this is a deliberate permission boundary",
    () => {
      const s = section("3. What the harness reports back", "4. A real invocation");
      expect(s).toContain("Result: incomplete");
      expect(s).toContain("the worker role is not permitted to use Bash");
      expect(s).toContain("This role may use only: Read, Glob, Grep");
      expect(s).toContain("harness's permission boundary working as intended, not a fault in the run");
    },
  );

  it.skipIf(mockMissing)(
    "AC: the refusal message never reads as an unexplained failure — no raw error or stack trace",
    () => {
      const s = section("3. What the harness reports back", "4. A real invocation");
      expect(s).not.toMatch(/at \S+ \(.*:\d+:\d+\)/);
      expect(s.toLowerCase()).not.toContain("typeerror");
      expect(s.toLowerCase()).not.toContain("stack");
    },
  );

  it.skipIf(mockMissing)(
    "demo also shows the guard installed on a real invocation through claude-mock",
    () => {
      const s = section("4. A real invocation");
      expect(s).toContain("Result: completed");
      expect(s).toContain("claude-mock models no tool permissions");
    },
  );
});
