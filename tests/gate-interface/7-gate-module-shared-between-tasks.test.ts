// A custom gate module is imported once per process, so every task a run works at once
// calls the same module. The guide must say so, and show where per-task state belongs:
// keyed by ctx.worktreePath, or not kept at all.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";
import { loadCustomGate, type GateContext } from "../../src/index.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-gate.md"), "utf-8");

function statefulGate(): string {
  const match = /```js\n(\/\/ stateful-gate\.mjs\n[\s\S]*?)```/.exec(guide);
  if (!match?.[1]) throw new Error("guide has no ```js block starting with // stateful-gate.mjs");
  return match[1];
}

describe("the 'writing a gate' guide on a module shared between tasks", () => {
  let tmp: string | undefined;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("says one module serves every task, possibly at the same time, and to key state by ctx.worktreePath", () => {
    expect(guide).toMatch(/one module serves every task/i);
    expect(guide).toMatch(/at the same time/i);
    expect(guide).toMatch(/keyed by `?ctx\.worktreePath`?/);
  });

  it("its stateful worked example judges each task against its own baseline when two run at once", async () => {
    tmp = mkdtempSync(join(tmpdir(), "gate-shared-"));
    const modulePath = join(tmp, "stateful-gate.mjs");
    writeFileSync(modulePath, statefulGate());
    const gate = await loadCustomGate(tmp, modulePath);

    const tree = (name: string, files: string[]): GateContext => {
      const worktreePath = join(tmp as string, name);
      mkdirSync(worktreePath);
      for (const file of files) writeFileSync(join(worktreePath, file), "{}");
      return { worktreePath, taskDef: {}, gateRef: { type: "custom", modulePath } };
    };
    const a = tree("a", ["one.json"]);
    const b = tree("b", ["one.json", "two.json", "three.json"]);

    await Promise.all([gate.baseline(a), gate.baseline(b)]);
    const [checkA, checkB] = await Promise.all([gate.check(a), gate.check(b)]);

    // Neither tree changed since its own baseline, so neither check may report a difference.
    expect(checkA.assertions.map((x) => x.outcome)).not.toContain("FAIL");
    expect(checkB.assertions.map((x) => x.outcome)).not.toContain("FAIL");
  });
});
