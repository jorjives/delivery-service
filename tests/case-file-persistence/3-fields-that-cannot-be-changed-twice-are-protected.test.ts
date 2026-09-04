// Slice 3: Fields That Cannot Be Changed Twice Are Protected
// Source: docs/superpowers/specs/2026-09-04-case-file-persistence-slices.md
// Recorded: 2026-09-04 against commit 60569de5ff7c043ed7c077136285a9f6af714e36
//
// Drives the slice's own UAT demo script (npx tsx demos/slice-3-immutability.ts)
// and asserts on its printed output, plus one acceptance criterion the demo
// script's happy path doesn't exercise (header immutability across mutations).

import { describe, it, expect } from "vitest";
import { runTsx, REPO_ROOT } from "./helpers.js";
import { join } from "node:path";

describe("UAT: baseline and outcome can each be set exactly once", () => {
  const { stdout, status } = runTsx(["demos/slice-3-immutability.ts"]);

  it("exits cleanly and prints the final verified summary", () => {
    expect(status).toBe(0);
    expect(stdout).toContain(
      "Immutability verified: both fields set exactly once, both second " +
        "attempts rejected with a named error.",
    );
  });

  it("AC: setting the baseline succeeds exactly once; a second attempt is rejected", () => {
    expect(stdout).toContain(
      "Baseline attempt 1: succeeded — baseline set to {assertion1: pass}",
    );
    expect(stdout).toContain("Baseline attempt 2: rejected — ImmutabilityViolation");
    expect(stdout).toContain("Cannot overwrite baseline in");
  });

  it("AC: setting the outcome succeeds exactly once; a second attempt is rejected", () => {
    expect(stdout).toContain(
      "Outcome attempt 1:  succeeded — outcome set to closed/gate",
    );
    expect(stdout).toContain("Outcome attempt 2:  rejected — ImmutabilityViolation");
    expect(stdout).toContain("Cannot overwrite outcome in");
  });
});

describe("AC: the header is unchanged after cursor updates and history appends", () => {
  it("load() returns the same header before and after mutating the cursor and history", () => {
    const { stdout, status } = runTsx([
      "-e",
      `
      (async () => {
        const { mkdtemp } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const { create, updateCursor, appendEntry, load } = await import(${JSON.stringify(
          join(REPO_ROOT, "src/index.js"),
        )});

        const dir = await mkdtemp(join(tmpdir(), "case-file-header-immut-"));
        const header = {
          surfaceId: "surface-header-immut",
          taskDef: { intent: "test header immutability" },
          gateRef: { gateId: "gate-1", version: 1 },
          domainPrompt: "You are a helper.",
        };
        const budgets = {
          correction: { used: 0, max: 3 },
          gateError: { used: 0, max: 3 },
          gateMaintenance: { used: 0, max: 2 },
          terminus: { used: 0, max: 5 },
          close: { used: 0, max: 3 },
        };

        const created = await create(dir, header, budgets);
        const originalHeader = JSON.stringify(created.header);

        await updateCursor(dir, { state: "AGENT_ACTIVE" });
        await appendEntry(dir, { t: "dispatch", attempt: 1, sessionKey: "sess-1" });
        await appendEntry(dir, {
          t: "terminus",
          attempt: 1,
          sessionKey: "sess-1",
          status: "completed",
          rationale: "Done",
        });
        await updateCursor(dir, { state: "GATING" });

        const after = await load(dir);
        const afterHeader = JSON.stringify(after.header);

        console.log("ORIGINAL:" + originalHeader);
        console.log("AFTER:" + afterHeader);
        process.exit(originalHeader === afterHeader ? 0 : 1);
      })();
      `,
    ]);

    expect(status).toBe(0);
    const original = stdout.match(/ORIGINAL:(.*)/)?.[1];
    const after = stdout.match(/AFTER:(.*)/)?.[1];
    expect(original).toBeDefined();
    expect(after).toEqual(original);
  });
});
