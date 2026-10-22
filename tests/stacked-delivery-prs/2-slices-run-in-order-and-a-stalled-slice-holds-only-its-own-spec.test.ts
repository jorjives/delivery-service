// Slice 2: Slices Run in Order, and a Stalled Slice Holds Only Its Own Spec
// Source: docs/superpowers/specs/2026-10-19-stacked-delivery-prs-slices.md
// Recorded: 2026-10-22 against commit 204d807
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's runDelivery over
// dist/cli/main.js), in a scratch project with a backlog and a command source named "slices" whose
// tasks name their slices file as the sequence. The agent is routed to the vendored scripted agent
// through the contributor-only test seam: no network, no API key. A slice is parked by failing its checks
// until `parkAfter` is spent. The GitHub issue-label way of declaring a
// sequence needs the `gh` stand-in and is covered by unit tests; it is recorded as skipped below.

import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const SPEC_A = "docs/specs/a-slices.md";
const SPEC_B = "docs/specs/b-slices.md";
const brief = (priority: number, text: string): string => `---\nstatus: open\npriority: ${priority}\n---\n${text}\n`;
const slices = ["a", "b"].flatMap((spec) =>
  [1, 2, 3].map((n) => ({ id: `${spec}-${n}`, intent: `Deliver slice ${n} of spec ${spec}`, sequence: `docs/specs/${spec}-slices.md` })),
);

// Each session writes one file named for the item it was given, so which items ran shows in the delivered work.
const done = (text: string, path: string): MockScript["expectations"][number] => ({
  when: { promptContains: text },
  effects: [{ write: { path, content: "export const done = true;\n" } }],
  json: { status: "completed", rationale: "done" },
});
const finishes: MockScript["expectations"] = [
  done("slice 1 of spec b", "b1.js"),
  done("slice 2 of spec a", "a2.js"),
  done("slice 3 of spec a", "a3.js"),
  done("unrelated one", "x.js"),
  done("unrelated two", "y.js"),
];
// Slice 2 of spec a deletes the project's test, so its checks fail and, with parkAfter 1, it is parked.
const stallsOnSecondOfA: MockScript = {
  expectations: [{ when: { promptContains: "slice 2 of spec a" }, effects: [{ delete: { path: "guard.test.js" } }], json: { status: "completed", rationale: "removed the test" } }, ...finishes],
};
const carriesOn: MockScript = { expectations: finishes };

async function project() {
  const stateDir = mkdtempSync(join(tmpdir(), "uat-sequence-state-"));
  const repo = initTempRepo("uat-sequence-", {
    "package.json": PACKAGE,
    "guard.test.js": "// a test\n",
    "delivery.config.json": JSON.stringify({ parkAfter: 1, sources: [{ type: "command", command: "sh slices.sh", name: "slices" }, { type: "backlog" }] }),
    ".delivery/backlog/20261016T090000Z-x.md": brief(1, "Add the unrelated one."),
    ".delivery/backlog/20261016T090100Z-y.md": brief(2, "Add the unrelated two."),
    // Lists the slices not yet completed; the first slice of spec a is already delivered.
    "slices.sh": `#!/bin/sh\ncase "$1" in\n list) ${listCommand(stateDir)};;\n complete) echo "$2" >> "${stateDir}/done";;\nesac\n`,
  });
  writeFileSync(join(stateDir, "done"), "a-1\n");
  chmodSync(join(repo, "slices.sh"), 0o755);
  const env = { ...process.env, XDG_STATE_HOME: stateDir };
  return { repo, env };
}

function listCommand(stateDir: string): string {
  const lines = slices.map((s) => `grep -qx '${s.id}' "${stateDir}/done" || printf '%s\\n' '${JSON.stringify(s)}'`).join("; ");
  return `{ ${lines}; } | sed 's/$/,/' | { printf '['; cat | sed '$ s/,$//'; printf ']'; }`;
}

const delivered = (repo: string): string[] =>
  git(repo, ["ls-tree", "-r", "--name-only", "delivery/main"]).split("\n").filter((f) => /^(a|b|x|y)\d?\.js$/.test(f)).sort();

describe("UAT: park one slice and see that only its own spec waits", () => {
  it("UAT: the stalled spec is held by its parked slice, other work carries on, and after unparking the slice goes before the next", async () => {
    const { repo, env } = await project();
    const stalls = { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(stallsOnSecondOfA) };
    const carries = { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(carriesOn) };

    // Park the second slice of the first spec (the first is already delivered), .
    const first = runDelivery(["run", "--sources", "--max", "1"], { cwd: repo, env: stalls });
    expect(first.stdout).toContain("Parked slices:a-2");

    const second = runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env: stalls });
    expect(second.stdout).not.toContain("slices:a-3");
    // The unrelated item and the second spec's first slice were taken; the first spec's third slice was not.
    expect(delivered(repo)).toEqual(expect.arrayContaining(["b1.js", "x.js", "y.js"]));
    expect(delivered(repo)).not.toContain("a3.js");
    expect(delivered(repo)).not.toContain("b2.js");

    const status = runDelivery(["status"], { cwd: repo, env: stalls }).stdout;
    expect(status).toContain(SPEC_A);
    expect(status).toContain("held by slices:a-2");
    expect(status).toMatch(/slices:a-2.*parked|parked.*slices:a-2/i);
    expect(status).not.toMatch(new RegExp(`${SPEC_B}: held by slices:a`));

    expect(runDelivery(["unpark", "slices:a-2"], { cwd: repo, env: stalls }).status).toBe(0);
    runDelivery(["run", "--sources"], { cwd: repo, env: carries });
    expect(delivered(repo)).toContain("a2.js");
    expect(delivered(repo)).not.toContain("a3.js");
    runDelivery(["run", "--sources"], { cwd: repo, env: carries });
    expect(delivered(repo)).toContain("a3.js");
  }, 300_000);

  it("AC: items without a sequence, and in other sequences, are taken as usual; at most one item of a sequence per run", async () => {
    const { repo, env } = await project();
    const carries = { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(carriesOn) };

    runDelivery(["run", "--sources", "--max", "5"], { cwd: repo, env: carries });

    // x, y, one slice of each spec (a-2, b-1): never a-3 or b-2 in the same run.
    expect(delivered(repo)).toEqual(["a2.js", "b1.js", "x.js", "y.js"]);
  }, 300_000);
});

describe("AC: not recorded here", () => {
  it.skip("AC: a GitHub issue label declares a sequence (needs the gh stand-in's issue listing; covered by src/github-source.test.ts)", () => {});
  it.skip("AC: the report's versioned data carries a `held` list (covered by src/cli/report-command.test.ts and src/report tests)", () => {});
});
