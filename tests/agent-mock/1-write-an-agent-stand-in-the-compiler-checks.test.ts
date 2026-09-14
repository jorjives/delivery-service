// Slice 1: Write an Agent Stand-in the Compiler Checks
// Source: docs/superpowers/specs/2026-09-13-agent-mock-slices.md
// Recorded: 2026-09-14 against commit f6fba69

//
// Drives the slice's own UAT demo script (npx tsx demos/agent-mock-slice-1-honest-double.ts)
// and asserts on its printed result for each of the three parts, covering the slice's UAT
// and its acceptance criteria.
//
// AC "every existing hand-written stand-in in the harness's tests and demos uses the new
// double" and AC "outside the production agent port and the new double itself, no cast to
// the agent port's invoke signature remains" are not observable from the demo's stdout —
// they are a codebase-wide grep invariant, asserted directly below instead.
//
// AC "(SHOULD) a check in the normal test or lint run fails if a new such cast is added
// elsewhere" is unit-tested directly in tests/invoke-cast-guard.test.ts, which drives the
// ESLint rule against fixture source; not duplicated here.

import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { runTsx, sectionOf, REPO_ROOT } from "../helpers.js";

describe("UAT: write an agent stand-in the compiler checks", () => {
  const { stdout, status } = runTsx(["demos/agent-mock-slice-1-honest-double.ts"]);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("UAT: a stand-in built from a single worker reply, with no cast, drives a real surface to its decision", () => {
    const s = sectionOf(
      stdout,
      "1. A surface driven to its decision by a stand-in worker",
      "2. The same stand-in asked for a role it was given no reply for",
    );
    expect(s).toContain('fakeAgentPort({ worker: (ctx) => { write feature.txt; reply completed } })');
    expect(s).toContain("The surface ran to: CLOSED");
    expect(s).toContain("Outcome:            closed");
  });

  it("AC: invoking a role the stand-in has no reply for fails naming that role and saying the test must supply it", () => {
    const s = sectionOf(
      stdout,
      "2. The same stand-in asked for a role it was given no reply for",
      "3. A stand-in whose worker replies with a triage verdict",
    );
    expect(s).toContain('no reply for the triage role: the test must supply a "triage" handler');
  });

  it("AC: a stand-in whose worker reply has the shape of a triage reply is rejected by the type checker, not a passing run", () => {
    const s = sectionOf(stdout, "3. A stand-in whose worker replies with a triage verdict");
    expect(s).toContain("The compiler reports:");
    expect(s).toContain("error TS2322");
    expect(s).toContain("is not assignable to type 'Terminus'");
    expect(s).toContain('Type \'"reroute"\' is not assignable to type \'"incomplete"\'');
    expect(s).toContain("It is a compile error, not a passing run: the stand-in never gets to run.");
  });

  it("AC: outside the production agent port and the new double itself, no cast to the agent port's invoke signature remains", () => {
    const output = execFileSync(
      "grep",
      [
        "-rnF",
        "--exclude=invoke-cast-guard.test.ts",
        "--exclude=1-write-an-agent-stand-in-the-compiler-checks.test.ts",
        'as AgentPort["invoke"]',
        "src",
        "demos",
        "tests",
      ],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
    const lines = output.trim().split("\n").sort();
    expect(lines).toEqual([
      expect.stringContaining("src/agent-invoke.ts"),
      expect.stringContaining("src/agent-port-double.ts"),
    ]);
  });
});
