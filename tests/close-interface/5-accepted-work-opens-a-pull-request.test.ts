// Slice 5: Accepted Work Opens a Pull Request
// Source: docs/superpowers/specs/2026-09-11-close-interface-slices.md
// Recorded: 2026-09-13 against commit 0533b1b31a16336b50beb1e2580e92cb045ffb19

//
// Drives the slice's own UAT demo script (npx tsx demos/close-interface-slice-5-open-pr.ts)
// and asserts on its printed output, covering the slice's UAT and the acceptance criteria the
// demo can show.
//
// Needs only `git` and `node`: a stand-in executable named gh is put first on PATH and origin
// is a bare repository on this machine, so there is no network and no GitHub account involved.
//
// Three ACs are not observable from this demo and are covered by unit tests instead: the
// GitHub tool missing or not signed in, and a pull request refused for a content reason, by
// src/open-pr-closer.test.ts ("names the missing GitHub tool and how to install it", "names
// missing permission and how to fix it", "reports a pull request refused for a content reason
// as a FAIL carrying the reason"); pull request titles and bodies derived from task content
// cannot be interpreted as commands, by src/open-pr-closer.test.ts ("passes task content to gh
// as data that cannot be read as commands or flags"); and escalated/aborted surfaces tearing
// down exactly as with the other built-ins, by src/closer-support.test.ts ("teardownWorktree"),
// the shared code every built-in closer (including this one) uses unchanged for non-accept
// outcomes.
//

import { describe, it, expect } from "vitest";
import { runTsx, sectionOf } from "../helpers.js";

describe("UAT: accepted work opens a pull request", () => {
  const { stdout, status } = runTsx(["demos/close-interface-slice-5-open-pr.ts"]);
  const section = (from: string, to?: string): string => sectionOf(stdout, from, to);

  it("demo script runs to completion", () => {
    expect(status).toBe(0);
  });

  it("AC: a project names the open-pull-request closer as data", () => {
    expect(stdout).toContain('closerRef = {"type":"open-pr"}');
  });

  it("UAT: the demo needs no network and no GitHub account, using a gh stand-in", () => {
    expect(stdout).toContain("This demo uses no network and no GitHub account.");
    expect(stdout).toMatch(/A stand-in executable named gh is put\s*\nfirst on PATH/);
  });

  it("AC: an accepted surface ends closed with its branch pushed and a pull request opened against the base branch", () => {
    const s1 = section("--- 1.", "--- 2.");
    expect(s1).toContain("The surface ran to: CLOSED");

    const s2 = section("--- 2.", "--- 3.");
    expect(s2).toContain("surface/surface-81 on origin holds: the feature the task asked for");
    expect(s2).toContain('Pull request https://github.com/example/project/pull/1: surface/surface-81 into main');
  });

  it("AC: the closing report is the pull request's address", () => {
    const s1 = section("--- 1.", "--- 2.");
    expect(s1).toContain("Closing report: https://github.com/example/project/pull/1");
  });

  it("UAT: the worktree is left in place after the pull request opens", () => {
    const s2 = section("--- 2.", "--- 3.");
    expect(s2).toContain("Worktree still on disk, for follow-up commits: true");
  });

  it("AC: a repeat close for a branch that already has an open pull request reports that pull request and does not open a second", () => {
    const s3 = section("--- 3.", "--- 4.");
    expect(s3).toContain("Repeat close: DONE: https://github.com/example/project/pull/1");
    expect(s3).toContain("this pull request from surface/surface-81 was already open, so no new pull request was opened");
    expect(s3).toContain("Pull requests the stand-in now holds: 1");
  });

  it("AC: expired GitHub access produces an error report naming the specific problem and how to fix it", () => {
    const s4 = section("--- 4.");
    expect(s4).toContain(
      "Close attempt 1: ERROR: GitHub sign-in is needed: gh is not signed in, or its sign-in has expired, so no pull request could be opened. Run gh auth login as the person or account the harness runs as, then close again.",
    );
  });

  it("UAT: the expired-access case retries then escalates, reporting that GitHub sign-in is needed", () => {
    const s4 = section("--- 4.");
    expect(s4).toContain("Triage: retry_close");
    expect(s4).toContain("The surface ran to: ESCALATED");
    expect(s4).toContain("Escalation evidence: GitHub sign-in is needed");
    expect(s4).toContain("Pull requests the stand-in holds: 1 (none opened for surface-82)");
  });
});
