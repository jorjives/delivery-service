// The Operational note of inspect-a-pack slice 1: every built-in pack inspects, and what the account
// shows matches what a run uses. Kept in the normal vitest run, so a change to the loader or a
// built-in that makes the account disagree with a run fails the build.

import { describe, expect, it } from "vitest";
import { withPackWorkflows } from "../src/cli/pack-workflows.js";
import { delivery, PACKAGE } from "../src/cli/command-fixtures.js";
import { INSPECT_RULE, INSPECT_WIDTH } from "../src/cli/packs-inspect-render.js";
import { inspectionOf, NO_PROJECT } from "../src/packs/inspection.js";
import { builtInPacks, promptOf } from "../src/packs/manifest.js";
import { readPackFolder } from "../src/packs/pack-folder.js";
import { activeGuards } from "../src/task-guards.js";
import { initTempRepo } from "../src/temp-repo.js";
import { runDelivery } from "./helpers.js";

/** Every line outside the instructions: the lines between each pair of rules are the pack's words and the harness's, and are left out. */
function linesOutsideInstructions(lines: string[]): string[] {
  const kept: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line === INSPECT_RULE) {
      inside = !inside;
      continue;
    }
    if (!inside) kept.push(line);
  }
  return kept;
}

const packs = await builtInPacks();

describe.each(packs.map((p) => [p.manifest.name, p] as const))("the built-in pack %s", (name, pack) => {
  it("is shown as a run uses it: each workflow's instructions, guards and hold", async () => {
    const run = (await withPackWorkflows({}, process.cwd())).workflows ?? {};
    const inspection = inspectionOf(pack, NO_PROJECT, []);
    expect(inspection.workflows.map((w) => w.name).sort()).toEqual(Object.keys(pack.workflows).sort());
    for (const workflow of inspection.workflows) {
      const ran = run[workflow.name];
      if (!ran) throw new Error(`${workflow.name} did not run`);
      expect(workflow.hold).toEqual(ran.hold ?? null);
      workflow.steps.forEach((step, i) => {
        expect(promptOf(step.instructions)).toBe(ran.steps[i]?.prompt);
        const on = [...inspection.defaultGuards.filter((g) => !step.guards.off.includes(g)), ...step.guards.added];
        expect(new Set(on)).toEqual(new Set(activeGuards({}, ran.steps[i]?.guards).on));
      });
    }
  });

  it("shows its find exactly as delivery review --preview gives it to the agent", async () => {
    const find = inspectionOf(pack, NO_PROJECT, []).workflows.find((w) => w.kind === "find");
    if (!find?.steps[0]) throw new Error("no find workflow");
    const project = initTempRepo("inspect-preview-", { "package.json": PACKAGE, "a.js": "x\n" });
    const { exitCode, stdout } = await delivery(["review", name, "--preview"], { cwd: project });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(promptOf(find.steps[0].instructions));
  });

  it("is read by the folder check, and is shown by its path exactly as by its name", async () => {
    expect((await readPackFolder(pack.dir)).ok).toBe(true);
    const cwd = initTempRepo("inspect-path-", { "package.json": PACKAGE, "a.js": "x\n" });
    const byName = await delivery(["packs", "inspect", name], { cwd });
    const byPath = await delivery(["packs", "inspect", pack.dir], { cwd });
    expect(byPath.exitCode).toBe(0);
    expect(byPath.stdout).toBe(byName.stdout);
  });

  it("reads at 60 columns from the command line, the short account first and the instructions last", () => {
    // A short temp project: the project path is its own line and cannot wrap, so a long checkout path must not decide the result.
    const cwd = initTempRepo("inspect-width-", { "package.json": PACKAGE, "a.js": "x\n" });
    const { status, stdout } = runDelivery(["packs", "inspect", name], { cwd });
    expect(status).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`Pack: ${pack.manifest.title}`);
    expect(lines.at(-1)).toBe(INSPECT_RULE);
    const ours = linesOutsideInstructions(lines);
    expect(ours.filter((l) => l.length > INSPECT_WIDTH)).toEqual([]);
  });
});
