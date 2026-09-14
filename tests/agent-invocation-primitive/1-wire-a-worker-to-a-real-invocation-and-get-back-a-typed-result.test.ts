// Slice 1: Wire a Worker to a Real Invocation and Get Back a Typed Result
// Source: docs/superpowers/specs/2026-09-09-agent-invocation-primitive-slices.md
// Recorded: 2026-09-09 against commit 916c8ad

//
// Drives the slice's own UAT demo script (npx tsx demos/agent-invocation-slice-1-worker-invocation.ts)
// and asserts on its printed result for each of the three scripted scenarios, covering the
// slice's UAT and its acceptance criteria.
//
// Runs against claude-mock, vendored in vendor/claude-mock and installed by `npm install`, so it
// never skips.
//
// AC "a crash, a cut-off session, or a mismatched reply all return the same did-not-complete
// result" has three sub-cases: the demo only scripts the mismatched-reply sub-case. The crash
// and cut-off-session sub-cases are unit-tested directly in
// src/agent-invoke.test.ts ("treats a session that ended in an error as did-not-complete",
// "treats a session that emitted no envelope as did-not-complete") since claude-mock has no
// scripted way to simulate a session crash or an SDK-level cutoff from this demo's CLI surface.
//
// AC "the did-not-complete result never exposes a raw system error or stack trace" is also
// unit-tested directly in src/agent-invoke.test.ts ("never leaks the underlying error text into
// the rationale"), which scripts an actual thrown error message and asserts it never reaches the
// rationale — this demo's own mismatched-reply scenario never throws, so it cannot exercise that
// path, but it does demonstrate the resulting message is plain English with no stack frame.
//
// AC "running the same scenario twice produces the exact same request sent to the agent" is
// unit-tested directly in src/agent-invoke.test.ts ("sends the identical request twice from the
// same starting case file"), which inspects the mock's request journal — not observable from
// this demo's stdout.

import { describe, it, expect } from "vitest";
import { runTsx } from "../helpers.js";

describe("UAT: wire a worker to a real invocation and get back a typed result", () => {
  const { stdout, status } = runTsx(["demos/agent-invocation-slice-1-worker-invocation.ts"]);

  function section(from: string, to?: string): string {
    const start = stdout.indexOf(from);
    return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
  }

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it(
    "UAT: prints the worker role and its permitted tools before running any scenario",
    () => {
      const s = section("Role:", "Scenario: the agent finishes cleanly");
      expect(s).toContain("Role:      worker");
      expect(s).toContain("Tools:");
    },
  );

  it(
    "AC: a scripted session that replies cleanly returns a single completed result carrying the agent's explanation",
    () => {
      const s = section("Scenario: the agent finishes cleanly", "Scenario: the agent escalates");
      expect(s).toContain("Result: completed — added the greeting endpoint and its handler");
    },
  );

  it(
    "AC: a scripted session that reports it cannot proceed returns a single escalate result naming the category",
    () => {
      const s = section(
        "Scenario: the agent escalates",
        "Scenario: the agent replies with the wrong shape",
      );
      expect(s).toContain("Result: escalate (authority)");
      expect(s).toContain("the change needs a deploy credential this role was not given");
    },
  );

  it(
    "AC: a reply that doesn't match the expected shape returns the same did-not-complete result, with a plain-English reason and no raw error or stack trace",
    () => {
      const s = section("Scenario: the agent replies with the wrong shape");
      expect(s).toContain("Result: did not complete");
      expect(s).toContain("not a valid result for this role");
      expect(s).not.toMatch(/at \S+ \(.*:\d+:\d+\)/);
      expect(s.toLowerCase()).not.toContain("typeerror");
      expect(s.toLowerCase()).not.toContain("stack");
    },
  );

  it("demo exercises all three scenarios", () => {
    expect(stdout).toContain("Scenario: the agent finishes cleanly");
    expect(stdout).toContain("Scenario: the agent escalates");
    expect(stdout).toContain("Scenario: the agent replies with the wrong shape");
  });
});
