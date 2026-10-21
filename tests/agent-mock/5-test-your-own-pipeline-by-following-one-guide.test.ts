// Slice 5: Test Your Own Pipeline by Following One Guide
// Source: docs/superpowers/specs/2026-09-13-agent-mock-slices.md
// Recorded: 2026-09-14 against commit 5f96415

//
// This slice's deliverable is docs/testing-your-pipeline.md itself, not a demo script.
// Its UAT is "open the guide, copy each worked snippet, run it as the guide says, read
// the limits section" — so this test does exactly that: extracts the guide's two worked
// tests the way a reader would, runs each with `npx tsx --test` at the repository root
// (as the guide instructs), and checks the decision-table, journal-assertion and limits
// content the UAT's read-only steps cover.
//
// tests/testing-your-pipeline-guide.test.ts already keeps the guide honest at far finer
// grain (type-checking every snippet, quoting every authoring-mistake message exactly).
// This file is the slice's own recorded regression, following the tests/agent-mock/
// convention of slices 1-4: it drives the guide as its "live deliverable" and is not a
// substitute for that finer-grained test.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { flatten, REPO_ROOT, runGuideTest, sectionOf, snippetFrom } from "../helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/testing-your-pipeline.md"), "utf-8");
const snippet = (name: string) => snippetFrom(guide, name);

// The guide tells a reader to save each snippet at the repository root; a uniquely named
// file avoids colliding with anything a reader (or another test run) has in place.
const staged: string[] = [];
afterAll(() => { for (const path of staged) rmSync(path, { force: true }); });

function stage(name: string): string {
  const path = join(REPO_ROOT, `.uat-slice-5-${name}`);
  writeFileSync(path, snippet(name));
  staged.push(path);
  return path;
}

describe("UAT: test your own pipeline by following one guide", () => {
  it("explains when to use the in-process stand-in and when to use the scripted agent, with a decision table", () => {
    const choosing = sectionOf(guide, "## Choosing a stand-in", "## Worked example: the happy path");
    for (const row of ["| What it runs |", "| Cost |", "| Proves your role configuration |", "| Right for |"]) {
      expect(choosing).toContain(row);
    }
  });

  it("runs the happy-path snippet as the guide says, and it passes", () => {
    const { stdout, status } = runGuideTest(stage("happy-path.test.ts"));
    expect(status).toBe(0);
    expect(stdout).toContain("✔ a scripted worker's change is judged by the real gate and landed by the real closer");
    expect(stdout).toContain("ℹ pass 1");
    expect(stdout).toContain("ℹ fail 0");
  }, 60_000);

  it("runs the misbehaviour snippet as the guide says, and both its tests pass", () => {
    const { stdout, status } = runGuideTest(stage("misbehaviour.test.ts"));
    expect(status).toBe(0);
    expect(stdout).toContain("✔ a worker that escalates for authority stops the surface at once");
    expect(stdout).toContain("✔ a change the gate rejects goes back to the worker, and only the passing attempt lands");
    expect(stdout).toContain("ℹ pass 2");
    expect(stdout).toContain("ℹ fail 0");
  }, 60_000);

  it("shows how to assert what the harness sent and that the script was fully used", () => {
    expect(guide).toContain("promptsSent(journal)");
    expect(guide).toContain("assertFullyConsumed(journal, script)");
  });

  it("lists the ways a reply ends as incomplete and how each looks", () => {
    const incomplete = sectionOf(guide, "## When a reply ends as incomplete", "## What the scripted agent cannot prove");
    expect(incomplete).toContain("the session ended in an error before it reported a result");
    expect(incomplete).toContain("the session ended without reporting a result");
    expect(incomplete).toContain("the session replied with something that is not a valid result for this role");
  });

  it("states plainly that the scripted agent cannot prove what your own settings allow, and where that guarantee is tested instead", () => {
    const limits = flatten(sectionOf(guide, "## What the scripted agent cannot prove", "## When the test itself is wrong"));
    expect(limits).toContain("The scripted agent cannot prove what your own Claude Code settings allow or refuse.");
    expect(limits).toContain("`permissions.deny`");
    // An installed copy has no source to point at, so the guide names where the guarantee lives in words.
    expect(limits).toContain("The harness's own tests, in its repository, check that a real session loads your settings.");
  });

  it("needs no network, no API key and no global setup", () => {
    const needs = sectionOf(guide, "## What you need", "## Choosing a stand-in");
    expect(needs).toMatch(/no\s+network/);
    expect(needs).toMatch(/no API key/);
    expect(needs).toMatch(/no global setup/);
  });

  it("AC: the role-configuration guide's offline section points to the new guide", () => {
    const roleGuide = readFileSync(join(REPO_ROOT, "docs/configuring-a-role.md"), "utf-8");
    expect(roleGuide).toContain("testing-your-pipeline.md");
  });
});
