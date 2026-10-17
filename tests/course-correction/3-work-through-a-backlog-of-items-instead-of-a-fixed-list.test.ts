// Slice 3: Work Through a Backlog of Items Instead of a Fixed List
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-17 against commit f3b68ad
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project holding a backlog,
// the agent routed to the vendored scripted agent through the contributor-only
// test seam: no network, no API key.
// Acceptance criteria that need a crashed or usage-limited runtime, a clock,
// or an agent session editing the backlog mid-run are recorded as skipped
// below, each with its reason.

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const FIRST = "20261016T090000Z-say-hello.md";
const SECOND = "20261016T090100Z-say-goodbye.md";
const item = (priority: number, brief: string) => `---\nstatus: open\npriority: ${priority}\n---\n${brief}\n`;
const backlogPath = (file: string) => `.delivery/backlog/${file}`;

const completes = (path: string): MockScript["expectations"][number] => ({
  effects: [{ write: { path, content: "export const done = true;\n" } }],
  json: { status: "completed", rationale: "done" },
});

// Every session writes one file named for the brief it was given, so which item ran is visible in the delivered work.
const byBrief = (...pairs: [brief: string, path: string][]): MockScript => ({
  expectations: pairs.map(([brief, path]) => ({ ...completes(path), when: { promptContains: brief } })),
});

const asks: MockScript = {
  expectations: [
    {
      when: { promptContains: "Their answer: Formal, please." },
      effects: [{ write: { path: "hello.js", content: "export const hello = (n) => `Good day, ${n}`;\n" } }],
      json: { status: "completed", rationale: "formal greeting" },
    },
    { json: { status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the item does not say" } },
  ],
};

async function project(files: Record<string, string>, script: MockScript, config?: object) {
  const repo = initTempRepo("uat-backlog-", {
    "package.json": PACKAGE,
    ...(config ? { "delivery.config.json": JSON.stringify(config) } : {}),
    ...files,
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-backlog-state-")),
  };
  return { repo, env };
}

// Delivered work lands on the one delivery branch; a task that did not deliver keeps its own surface branch.
const branches = (repo: string) => git(repo, ["branch", "--list", "surface/*", "--format=%(refname:short)"]).split("\n").filter(Boolean);
const deliveryBranches = (repo: string) => git(repo, ["branch", "--list", "delivery/*", "--format=%(refname:short)"]).split("\n").filter(Boolean);
const delivered = (repo: string, file: string) => [...deliveryBranches(repo), ...branches(repo)].find((b) => git(repo, ["ls-tree", "-r", "--name-only", b]).split("\n").includes(file));

describe("UAT: work through a backlog on its own", () => {
  it("delivers each item in priority order, marks each resolved, and then has nothing left to do", async () => {
    const { repo, env } = await project(
      // The lower number is worked first, regardless of file name order.
      { [backlogPath(FIRST)]: item(2, "Add a hello."), [backlogPath(SECOND)]: item(1, "Add a goodbye.") },
      byBrief(["Add a hello.", "hello.js"], ["Add a goodbye.", "goodbye.js"]),
    );

    const run = runDelivery(["run", "--sources", "--max", "2"], { cwd: repo, env });
    expect(run.status).toBe(0);

    const goodbye = delivered(repo, "goodbye.js");
    const hello = delivered(repo, "hello.js");
    expect(goodbye).toBeDefined();
    expect(hello).toBeDefined();
    expect(goodbye).toBe("delivery/main");
    expect(hello).toBe("delivery/main");
    expect(git(repo, ["show", `${goodbye}:${backlogPath(SECOND)}`])).toContain("status: resolved");
    expect(git(repo, ["show", `${hello}:${backlogPath(FIRST)}`])).toContain("status: resolved");
    // Landed in the order they finished, one built on the other: the priority-1 item's work is the older commit.
    const subjects = git(repo, ["log", "--format=%s", "main..delivery/main"]).split("\n");
    expect(subjects.findIndex((s) => s.includes("goodbye"))).toBeGreaterThan(subjects.findIndex((s) => s.includes("hello")));

    const status = runDelivery(["status"], { cwd: repo, env });
    expect(status.status).toBe(0);

    const again = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(again.status).toBe(0);
    expect(branches(repo)).toHaveLength(0);
    expect(deliveryBranches(repo)).toEqual(["delivery/main"]);
  }, 180_000);

  it("parks an item that needs the operator, shows its question, and carries on once it is answered", async () => {
    const { repo, env } = await project({ [backlogPath(FIRST)]: item(1, "Add a function that says hello.") }, asks);
    const key = `backlog:${FIRST}`;

    const first = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(first.status).not.toBe(0);
    expect(first.stdout).toContain(`Parked ${key}`);
    expect(first.stdout).toContain("Formal or casual greeting?");

    const status = runDelivery(["status"], { cwd: repo, env });
    expect(status.stdout).toContain(key);
    expect(status.stdout).toContain("Formal or casual greeting?");

    // Parked items are skipped, not retried forever.
    const skipped = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).not.toContain("the agent is working");

    expect(runDelivery(["answer", FIRST, "Formal, please."], { cwd: repo, env }).status).toBe(0);
    const resumed = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(resumed.status).toBe(0);

    const branch = delivered(repo, "hello.js");
    expect(branch).toBeDefined();
    expect(git(repo, ["show", `${branch}:hello.js`])).toContain("Good day");
  }, 180_000);
});

describe("AC: items are worked in order: backlog first, a fallback source only when nothing else has work", () => {
  it("leaves a fallback source unread while the backlog has work", async () => {
    const lister = `#!/bin/sh\ncase "$1" in\n list) echo '[{"id":"f1","intent":"Add a fallback thing."}]';;\n complete) echo "$2" > fallback-done;;\nesac\n`;
    const { repo, env } = await project(
      { [backlogPath(FIRST)]: item(1, "Add a hello."), "fallback.sh": lister },
      byBrief(["Add a hello.", "hello.js"], ["Add a fallback thing.", "fallback.js"]),
      { sources: [{ type: "backlog" }, { type: "command", command: "sh fallback.sh", fallback: true }] },
    );

    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    expect(delivered(repo, "hello.js")).toBeDefined();
    expect(delivered(repo, "fallback.js")).toBeUndefined();

    // Nothing left in the backlog, so the next run turns to the fallback.
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    expect(delivered(repo, "fallback.js")).toBeDefined();
  }, 180_000);
});

describe("AC: an item that keeps failing its checks is parked after a configured number of runs", () => {
  it("parks it, shows it in status, and skips it until un-parked", async () => {
    const cheats: MockScript = { expectations: [{ effects: [{ delete: { path: "hello.test.js" } }], json: { status: "completed", rationale: "removed the test" } }] };
    const { repo, env } = await project(
      { [backlogPath(FIRST)]: item(1, "Add a hello."), "hello.test.js": "// a test\n" },
      cheats,
      { parkAfter: 1 },
    );
    const key = `backlog:${FIRST}`;

    const first = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(first.stdout).toContain(`Parked ${key}`);
    expect(runDelivery(["status"], { cwd: repo, env }).stdout).toContain(key);

    const before = branches(repo).length;
    runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(branches(repo)).toHaveLength(before);

    expect(runDelivery(["unpark", key], { cwd: repo, env }).status).toBe(0);
    runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(branches(repo).length).toBeGreaterThan(before);
  }, 180_000);
});

describe("AC: a source of the operator's own script feeds the same mechanism", () => {
  it("lists tasks from the script and marks each done once delivered", async () => {
    const script = `#!/bin/sh\ncase "$1" in\n list) [ -f done ] && echo '[]' || echo '[{"id":"t1","intent":"say hello"}]';;\n complete) echo "$2" > done;;\nesac\n`;
    const { repo, env } = await project({ "tasks.sh": script }, { expectations: [completes("hello.js")] }, {
      sources: [{ type: "command", command: "sh tasks.sh" }],
    });
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    expect(readFileSync(join(repo, "done"), "utf-8")).toBe("t1\n");
  }, 120_000);
});

describe("AC: a source that cannot list its items is skipped with the reason, without stopping the others", () => {
  it("still works the backlog when another source returns something unreadable", async () => {
    const { repo, env } = await project(
      { [backlogPath(FIRST)]: item(1, "Add a hello."), "broken.sh": "#!/bin/sh\necho 'not json'\n" },
      byBrief(["Add a hello.", "hello.js"]),
      { sources: [{ type: "command", command: "sh broken.sh", name: "broken" }, { type: "backlog" }] },
    );
    const run = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).toContain("broken");
    expect(delivered(repo, "hello.js")).toBeDefined();
  }, 120_000);
});

describe("AC: option flags are validated", () => {
  it("refuses --sources together with --task, and --max without --sources", async () => {
    const { repo, env } = await project({}, { expectations: [] });
    expect(runDelivery(["run", "--sources", "--task", "x"], { cwd: repo, env }).status).not.toBe(0);
    expect(runDelivery(["run", "--max", "2"], { cwd: repo, env }).status).not.toBe(0);
  });
});

describe("AC: not recorded here", () => {
  it.skip("an agent adds a follow-up item but cannot edit or delete an existing one (needs a scripted session that edits the tracked backlog; covered by the guard's unit tests in src/backlog.test.ts)", () => {});
  it.skip("an interrupted run is picked up where it left off (needs a crashed or usage-limited runtime; covered in src/cli/sources-run.test.ts)", () => {});
  it.skip("a recurring item returns after its interval (needs a clock the operator cannot move from the CLI)", () => {});
});
