// Roadmap Item 2 DX note: the gate interface ships with a "writing a gate" guide
// (the contract, a minimal example, what baseline/check must guarantee), so an
// extender never has to reverse-engineer the contract from source.
//
// Runs the guide's own minimal custom gate, so the example cannot drift from the
// contract the harness enforces.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";
import { computeDelta, loadCustomGate, type GateContext } from "../../src/index.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-gate.md"), "utf-8");

function exampleGate(): string {
  const match = /```js\n(\/\/ json-gate\.mjs\n[\s\S]*?)```/.exec(guide);
  if (!match?.[1]) throw new Error("guide has no ```js block starting with // json-gate.mjs");
  return match[1];
}

describe("the 'writing a gate' guide", () => {
  let tmp: string | undefined;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("covers the contract, the built-in command gate, the guarantees and the ABSENT rule", () => {
    expect(guide).toContain("baseline(ctx)");
    expect(guide).toContain("check(ctx)");
    expect(guide).toContain('type: "command"');
    expect(guide).toContain('type: "custom"');
    for (const mode of ["tap", "junit", "exitcode"]) expect(guide).toContain(`"${mode}"`);
    expect(guide).toContain("failOnNewAssertions");
    expect(guide).toContain("ABSENT");
    expect(guide).toContain("npm run demo:gate-slice-3");
  });

  it("its minimal custom gate loads, runs, and has a deleted file caught by the ABSENT rule", async () => {
    tmp = mkdtempSync(join(tmpdir(), "gate-guide-"));
    const modulePath = join(tmp, "json-gate.mjs");
    writeFileSync(modulePath, exampleGate());
    const worktreePath = join(tmp, "tree");
    mkdirSync(worktreePath);
    writeFileSync(join(worktreePath, "good.json"), "{}");
    writeFileSync(join(worktreePath, "broken.json"), "{");

    const gate = await loadCustomGate(modulePath);
    const ctx: GateContext = { worktreePath, taskDef: {}, gateRef: { type: "custom", modulePath } };

    const baseline = await gate.baseline(ctx);
    expect(baseline.status).toBe("PASS");
    expect(baseline.assertions.map((a) => [a.id, a.outcome])).toEqual([
      ["json:broken.json", "FAIL"],
      ["json:good.json", "PASS"],
    ]);

    rmSync(join(worktreePath, "good.json"));
    const delta = computeDelta(baseline, await gate.check(ctx));
    expect(delta.pass).toBe(false);
    expect(delta.newFailures).toEqual([
      expect.objectContaining({ id: "json:good.json", baselineOutcome: "PASS", checkOutcome: "ABSENT" }),
    ]);
  });
});
