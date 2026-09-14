// Slice 3: Triage Judges the Last Attempt and Rechecks Broken Gates for Free
// Source: docs/superpowers/specs/2026-09-10-triage-and-router-slices.md
// Recorded: 2026-09-11 against commit 04e1d257bfc3823fe1ef112d7fb3b52c7132c184

//
// Drives the slice's own UAT demo script (npx tsx demos/triage-slice-3-last-attempt.ts)
// and asserts on its printed output, covering the slice's UAT and most of its acceptance
// criteria. A second invocation drives the configuring-a-role guide's own "Your first
// triage invocation" example verbatim, covering the guide-following AC.
//
// Requires `claude-mock` (a sibling project, not vendored here) on PATH. When it is absent
// the demo prints an explanatory message and exits non-zero rather than crashing; this test
// asserts on that message in that case instead of failing opaquely.
//
// Three ACs are not observable from this demo's four scenarios (none of which exercise a
// close failure, a spent correction/close budget, or a surface with no triage agent wired
// in) and are covered elsewhere instead: a close failure with one close slot left, and both
// recheck and gate-maintenance budgets spent, by src/surface.test.ts's triage tests; a spent
// population budget escalating with no triage call, by src/surface.test.ts's budget-cap
// tests ("escalates a gate failure once the correction budget is at cap"); and a gate that
// keeps erroring reaching gate maintenance with no triage agent wired in, "as it did before
// this item", by src/surface.test.ts's "rechecks a gate that keeps erroring until rechecks
// are spent, then repairs it" test, which uses the deterministic router alone.
//

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTsx, sectionOf, REPO_ROOT } from "../helpers.js";
import { isOnPath } from "../../src/on-path.js";

describe("UAT: triage judges the last attempt and rechecks broken gates for free", () => {
  const { stdout, status } = runTsx(["demos/triage-slice-3-last-attempt.ts"]);

  const mockMissing = stdout.includes("claude-mock is not on PATH");
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion, or explains plainly that claude-mock is required", () => {
    if (mockMissing) {
      expect(status).not.toBe(0);
      expect(stdout).toContain("claude-mock is not on PATH");
      return;
    }
    expect(status).toBe(0);
  });

  it.skipIf(mockMissing)(
    "AC: a gate failure with exactly one correction slot left engages the triage agent, which may retry or escalate",
    () => {
      const retry = section("1. The last correction slot: the triage agent chooses one more retry", "2. The last correction slot: the triage agent chooses to escalate");
      expect(retry).toContain("Round 1: after a gate failure -> reroute (the lookup table decided, no agent call)");
      expect(retry).toContain("Round 2: after a gate failure -> reroute (the triage agent decided)");
      expect(retry).toContain("Surface finished: CLOSED");

      const escalate = section("2. The last correction slot: the triage agent chooses to escalate", "3. A gate that errors once, then passes on its free recheck");
      expect(escalate).toContain("Round 1: after a gate failure -> reroute (the lookup table decided, no agent call)");
      expect(escalate).toContain("Round 2: after a gate failure -> escalate (the triage agent decided)");
      expect(escalate).toContain("Surface finished: ESCALATED");
    },
  );

  it.skipIf(mockMissing)(
    "AC (guide): a gate that errors is re-run against the same baseline while its recheck budget lasts, with no agent call and no gate-maintenance session",
    () => {
      const s = section("3. A gate that errors once, then passes on its free recheck", "4. A gate that keeps erroring");
      expect(s).toContain("Round 1: after a gate error -> recheck_gate (the lookup table decided, no agent call)");
      expect(s).toContain("Gate runs: ERROR, PASS");
      expect(s).toContain("Worker sessions: 1; repair sessions: 0; triage agent calls: 0");
      expect(s).toContain("Surface finished: CLOSED");
    },
  );

  it.skipIf(mockMissing)(
    "AC: once rechecks are spent and gate-maintenance budget remains, triage decides whether to repair the gate; a repair session receives triage's brief",
    () => {
      const s = section("4. A gate that keeps erroring", "5. What this shows");
      expect(s).toContain("Round 1: after a gate error -> recheck_gate (the lookup table decided, no agent call)");
      expect(s).toContain("Round 2: after a gate error -> fix_the_gate (the triage agent decided)");
      expect(s).toContain("Gate runs: ERROR, ERROR, PASS");
      expect(s).toContain("Worker sessions: 1; repair sessions: 1; triage agent calls: 1");
      expect(s).toContain(
        "Problem: The gate cannot run: report.tap is empty, so there is no test output to read.",
      );
      expect(s).toContain("Scope: Regenerate report.tap. Never edit the checks themselves.");
      expect(s).not.toContain("THE REPAIR SESSION RECEIVED NO BRIEF");
      expect(s).toContain("Surface finished: CLOSED");
    },
  );

  it(
    "AC: following only the guide's Triage chapter, an extender can configure triage and get a typed verdict back without reading the harness source",
    () => {
      if (!isOnPath("claude-mock")) {
        expect(stdout).toContain("claude-mock is not on PATH"); // consistent with the demo's own gate
        return;
      }
      // Mirrors docs/configuring-a-role.md's "Your first triage invocation" example
      // verbatim: the guide's own runnable script, run from the repo root exactly as
      // the guide instructs, asserting on the exact line the guide says it prints.
      const scratch = mkdtempSync(join(tmpdir(), "guide-triage-"));
      const dir = join(scratch, "case");
      const worktreePath = join(scratch, "tree");
      mkdirSync(dir, { recursive: true });
      mkdirSync(worktreePath, { recursive: true });

      // A package.json declaring ESM is required alongside the script: tsx/esbuild
      // resolves module format from the nearest package.json to the script file, not
      // from cwd, and this scratch dir sits outside the repo's own "type": "module".
      writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));

      const mockScript = join(scratch, "mock.json");
      writeFileSync(
        mockScript,
        JSON.stringify([
          {
            json: {
              status: "reroute",
              rationale: "Worth one more attempt with a sharper brief.",
              payload: {
                problem: "The greeting still says hi.",
                dead_ends: "Attempt 1 edited the template; the text comes from translations.json.",
                scope: "Touch translations.json only.",
                references: ["worker-1-0"],
                diagnosis: "The template reads its greeting from translations.json.",
              },
            },
          },
        ]),
      );

      const script = join(scratch, "first-triage.ts");
      writeFileSync(
        script,
        [
          `import { create, invoke, triageRoleConfig } from ${JSON.stringify(join(REPO_ROOT, "src/index.js"))};`,
          "",
          `const dir = ${JSON.stringify(dir)};`,
          `const worktreePath = ${JSON.stringify(worktreePath)};`,
          "",
          "await create(",
          "  dir,",
          "  {",
          '    surfaceId: "my-first-triage",',
          '    taskDef: { intent: "make the greeting say hello" },',
          '    gateRef: { type: "command", command: "npm test", parseMode: "tap" },',
          "  },",
          "  {",
          "    correction: { used: 0, max: 3 },",
          "    gateError: { used: 0, max: 3 },",
          "    gateMaintenance: { used: 0, max: 2 },",
          "    terminus: { used: 0, max: 5 },",
          "    close: { used: 0, max: 3 },",
          "  },",
          ");",
          "",
          "const verdict = await invoke(",
          "  triageRoleConfig,",
          '  { worktreePath, dir, sessionKey: "triage-0" },',
          "  {",
          '    pathToClaudeCodeExecutable: "claude-mock",',
          `    env: { ...process.env, CLAUDE_MOCK_SCRIPT: ${JSON.stringify(mockScript)} },`,
          "  },",
          ");",
          "",
          'if (verdict.status === "reroute") {',
          '  console.log("Retry, and tell the next worker:", verdict.payload.dead_ends);',
          "} else {",
          "  console.log(verdict.status, verdict.rationale);",
          "}",
        ].join("\n"),
      );

      try {
        const out = execFileSync("npx", ["tsx", script], { cwd: REPO_ROOT, encoding: "utf-8" });
        expect(out.trim()).toBe(
          "Retry, and tell the next worker: Attempt 1 edited the template; the text comes from translations.json.",
        );
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  );

});
