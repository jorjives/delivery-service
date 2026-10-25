// Slice 1: Read a built-in pack in plain words
// Source: docs/superpowers/specs/2026-10-23-inspect-a-pack-slices.md
// Recorded: 2026-10-23 against commit a9972ec
//
// Drives the compiled `delivery packs inspect` command as a real subprocess (tests/helpers.ts's
// runDelivery), in a throwaway git repository so any write to the project would show up. Asserts on
// stable phrases and structure, not full-output equality.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INSPECT_RULE } from "../../src/cli/packs-inspect-render.js";
import { INSPECT_WIDTH } from "../../src/cli/text-wrap.js";
import { inspectionOf, NO_PROJECT } from "../../src/packs/inspection.js";
import { builtInPacks, promptOf } from "../../src/packs/manifest.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, REPO_ROOT, runDelivery } from "../helpers.js";

const project = initTempRepo("uat-inspect-1-", { "package.json": '{"name":"p"}\n', "a.js": "x\n" });
const before = git(project, ["status", "--porcelain"]);
const { status, stdout, stderr } = runDelivery(["packs", "inspect", "deprecations"], { cwd: project });
const lines = stdout.trimEnd().split("\n");
const outsideInstructions = (() => {
  const kept: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line === INSPECT_RULE) inside = !inside;
    else if (!inside) kept.push(line);
  }
  return kept;
})();
const account = outsideInstructions.join("\n").replace(/\s+/g, " ");

describe("UAT: inspect the built-in deprecations pack", () => {
  it("succeeds and prints plain sentences first, the full instructions last", () => {
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(lines[0]).toBe("Pack: Move off deprecated code");
    expect(lines.at(-1)).toBe(INSPECT_RULE);
    expect(stdout.indexOf("In short")).toBeLessThan(stdout.indexOf("Instructions for scan"));
  });

  it("says what the pack is for and that it has 3 workflows", () => {
    expect(account).toContain("Finds places that still use code your team has marked as replaced");
    expect(account).toContain("It has 3 workflows");
  });

  it("says how far the tests workflow goes before it asks", () => {
    const tests = outsideInstructions.join("\n").split("  tests:\n")[1] ?? "";
    expect(tests).toContain("Lands without asking you again, once you have approved");
  });

  it("shows the full instructions for a workflow, unaltered", async () => {
    const pack = (await builtInPacks()).find((p) => p.manifest.name === "deprecations");
    if (!pack) throw new Error("no deprecations pack");
    const step = inspectionOf(pack, NO_PROJECT, [], null).workflows.find((w) => w.kind === "find")?.steps[0];
    if (!step) throw new Error("no find workflow");
    for (const instructionLine of promptOf(step.instructions).split("\n").filter(Boolean)) {
      expect(stdout).toContain(instructionLine);
    }
  });

  it("changes nothing in the project", () => {
    expect(git(project, ["status", "--porcelain"])).toBe(before);
  });
});

describe("AC: the account", () => {
  it("shows title, version and a fingerprint", () => {
    expect(stdout).toMatch(/version 1\.0\.0/);
    expect(account).toMatch(/Fingerprint, which changes if any instruction changes: [0-9a-f]{32} [0-9a-f]{32}/);
  });

  it("names which workflows an idea may go to", () => {
    expect(account).toContain('An idea from "scan" may go to "code" or "tests"');
  });

  it("states each workflow's guards and sign-off", () => {
    expect(account).toContain("Every workflow is refused if it");
    expect(account).toContain("Ideas rated high or critical wait for your sign-off");
  });

  it("states the pack chooses no checks and no way of landing", () => {
    expect(account).toContain("chooses no checks and no way of landing");
    expect(account).toContain("uses your project's own");
  });

  it("states the instructions run with everything the agent setup can do, and follow-on steps run", () => {
    expect(account).toContain("cannot give the agent extra powers");
    expect(account).toContain("everything your own agent setup can already do");
    expect(account).toContain("your project's own follow-on steps run");
  });

  it("separates the pack author's words from the words delivery-service adds to every find", () => {
    expect(stdout).toContain("Instructions for scan: the pack's own words");
    expect(stdout).toContain("Added by delivery-service to every find");
  });

  it("reads at 60 columns with no colour or box drawing", () => {
    expect(outsideInstructions.filter((l) => l.length > INSPECT_WIDTH)).toEqual([]);
    expect(stdout).not.toContain("\u001b[");
    expect(stdout).not.toMatch(/[─-╿]/);
  });

  it("never says safe, clean or verified", () => {
    expect(account.toLowerCase()).not.toMatch(/\b(safe|clean|verified)\b/);
  });

  it("reads and writes nothing in the harness itself", () => {
    // Source-level guard: the command module neither spawns a process nor writes a file.
    const source = readFileSync(join(REPO_ROOT, "src", "cli", "packs-inspect-command.ts"), "utf-8");
    expect(source).not.toMatch(/child_process|writeFile|appendFile|spawn\(/);
  });
});
