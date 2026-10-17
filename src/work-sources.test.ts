import { describe, expect, it } from "vitest";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { foldLedger } from "./item-ledger.js";
import { addLocalOrigin } from "./temp-repo.js";
import { taskId } from "./task-list.js";
import { chooseWork, listSource } from "./work-sources.js";

const item = (status: string, extra = "") => `---\nstatus: ${status}\nworkflow: build\n${extra}---\nDo the thing.\n`;
const at = "2026-10-16T09:00:00.000Z";
const NOW = new Date("2026-10-16T12:00:00Z");
const base = { config: {}, env: {}, ledger: new Map(), records: [], now: NOW, max: 5, taken: new Set<string>() };

function repoWith(files: Record<string, string>): string {
  return initTempRepo("sources-", { "package.json": "{}", ...files });
}

describe("the backlog source", () => {
  it("lists open items only, in priority order, as tasks naming their workflow", async () => {
    const repo = repoWith({
      ".delivery/backlog/20261016T090000Z-b.md": item("open"),
      ".delivery/backlog/20261016T090100Z-a.md": item("open", "priority: 1\n"),
      ".delivery/backlog/20261016T090200Z-idea.md": "---\nstatus: idea\n---\nMaybe.\n",
      ".delivery/backlog/20261016T090300Z-done.md": item("resolved"),
    });
    const { items } = await listSource({ type: "backlog" }, { repoPath: repo, config: {}, env: {} });
    expect(items.map((i) => [i.key, i.workflow, i.resolve])).toEqual([
      ["backlog:20261016T090100Z-a.md", "build", ".delivery/backlog/20261016T090100Z-a.md"],
      ["backlog:20261016T090000Z-b.md", "build", ".delivery/backlog/20261016T090000Z-b.md"],
    ]);
  });
});

describe("the list source", () => {
  const keysOf = async (tasks: string[]) => (await listSource({ type: "list" }, { repoPath: ".", config: { tasks }, env: {} })).items.map((i) => i.key);

  it("keys a task by what it says, so inserting or reordering the list moves nothing onto another task", async () => {
    const [a, b] = await keysOf(["first task", "second task"]);
    expect(await keysOf(["new task", "second task", "first task"])).toEqual([expect.any(String), b, a]);
  });

  it("lists a task written twice once", async () => {
    expect(await keysOf(["same", "same", "other"])).toHaveLength(2);
  });

  it("carries a parked flag and an answer with the task through a reorder", async () => {
    const [first, second] = await keysOf(["first task", "second task"]);
    const ledger = foldLedger([{ t: "parked", key: first!, reason: "escalated", at }]);
    const repo = repoWith({});
    const chosen = await chooseWork([{ type: "list" }], { ...base, repoPath: repo, config: { tasks: ["second task", "first task"] }, ledger });
    expect(chosen.items.map((i) => i.key)).toEqual([second]);
  });
});

describe("the command source", () => {
  it("lists what the script prints, keyed by the source and the task's id", async () => {
    const repo = repoWith({});
    writeFileSync(join(repo, "tasks.sh"), `#!/bin/sh\n[ "$1" = list ] && echo '[{"id":"s-4","intent":"Deliver slice 4","workflow":"build","spec":"docs/s.md"}]'\n`);
    chmodSync(join(repo, "tasks.sh"), 0o755);
    const { items } = await listSource({ type: "command", command: "./tasks.sh", name: "slices" }, { repoPath: repo, config: {}, env: process.env });
    expect(items).toEqual([{ key: "slices:s-4", source: "slices", kind: "command", id: "s-4", taskDef: { intent: "Deliver slice 4", workflow: "build", spec: "docs/s.md" }, workflow: "build", fallback: false }]);
  });

  it.each([
    ["exits non-zero", "#!/bin/sh\necho broken >&2\nexit 2\n", "`./tasks.sh list` exited with code 2: broken"],
    ["prints something that is not JSON", "#!/bin/sh\necho hello\n", "`./tasks.sh list` did not print JSON"],
    ["prints JSON of the wrong shape", "#!/bin/sh\necho '[{\"intent\":\"no id\"}]'\n", "`./tasks.sh list` printed tasks I can't read: each needs a string `id`"],
  ])("is skipped for the run, with the reason, when it %s", async (_what, script, reason) => {
    const repo = repoWith({});
    writeFileSync(join(repo, "tasks.sh"), script);
    chmodSync(join(repo, "tasks.sh"), 0o755);
    const listed = await listSource({ type: "command", command: "./tasks.sh" }, { repoPath: repo, config: {}, env: process.env });
    expect(listed.items).toEqual([]);
    expect(listed.notes).toEqual([`Skipped the command source for this run: ${reason}`]);
  });
});

describe("chooseWork", () => {
  it("takes due recurring items first, then sources in order, up to max", async () => {
    const repo = repoWith({
      ".delivery/backlog/20261016T090000Z-feature.md": item("open", "priority: 1\n"),
      ".delivery/backlog/20261016T090100Z-weekly.md": item("open", "cadence: 7d\npriority: 9\n"),
    });
    const chosen = await chooseWork([{ type: "list" }, { type: "backlog" }], { ...base, repoPath: repo, config: { tasks: ["listed task"] }, max: 2 });
    expect(chosen.items.map((i) => i.key)).toEqual(["backlog:20261016T090100Z-weekly.md", `list:${taskId({ intent: "listed task" })}`]);
  });

  it("leaves out a recurring item that is not due yet", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090100Z-weekly.md": item("open", "cadence: 7d\n") });
    const ledger = foldLedger([
      { t: "dispatched", key: "backlog:20261016T090100Z-weekly.md", runId: "r1", intent: "x", at },
      { t: "ended", key: "backlog:20261016T090100Z-weekly.md", runId: "r1", class: "delivered", at: "2026-10-15T00:00:00.000Z" },
    ]);
    expect((await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, ledger })).items).toEqual([]);
  });

  it("skips parked items, and an item landed on a branch that is not merged yet", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a.md": item("open"), ".delivery/backlog/20261016T090100Z-b.md": item("open") });
    git(repo, ["branch", "surface/b-run"]);
    const ledger = foldLedger([
      { t: "parked", key: "backlog:20261016T090000Z-a.md", reason: "escalated", at },
      { t: "ended", key: "backlog:20261016T090100Z-b.md", runId: "b-run", class: "delivered", branch: "surface/b-run", at },
    ]);
    expect((await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, ledger })).items).toEqual([]);
  });

  it("skips an item whose work was merged back locally, though the backlog read from origin still shows it open", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a.md": item("open") });
    addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    // merge-back: the work lands on local main, nothing is pushed, the branch is deleted.
    git(repo, ["commit", "-q", "--allow-empty", "-m", "the delivered work"]);
    const delivered = git(repo, ["rev-parse", "HEAD"]);
    const ledger = foldLedger([{ t: "ended", key: "backlog:20261016T090000Z-a.md", runId: "a-run", class: "delivered", branch: "surface/a-run", commit: delivered, at }]);
    expect((await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, ledger })).items).toEqual([]);
  });

  it("takes an item again when its branch was deleted without the work reaching the base", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a.md": item("open") });
    git(repo, ["checkout", "-q", "-b", "surface/a-run"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "unmerged work"]);
    const stray = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["branch", "-D", "surface/a-run"]);
    const ledger = foldLedger([{ t: "ended", key: "backlog:20261016T090000Z-a.md", runId: "a-run", class: "delivered", branch: "surface/a-run", commit: stray, at }]);
    expect((await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, ledger })).items.map((i) => i.key)).toEqual(["backlog:20261016T090000Z-a.md"]);
  });

  it("reads a fallback source only when nothing else has work", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a.md": item("open") });
    const sources = [{ type: "backlog" as const }, { type: "list" as const, fallback: true }];
    const config = { tasks: ["derive new work"] };
    expect((await chooseWork(sources, { ...base, repoPath: repo, config })).items.map((i) => i.key)).toEqual(["backlog:20261016T090000Z-a.md"]);
    const empty = repoWith({});
    expect((await chooseWork(sources, { ...base, repoPath: empty, config })).items.map((i) => i.key)).toEqual([`list:${taskId({ intent: "derive new work" })}`]);
  });

  it("carries on with the other sources when one fails, naming it", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a.md": item("open") });
    const chosen = await chooseWork([{ type: "command", command: "exit 1" }, { type: "backlog" }], { ...base, repoPath: repo, env: process.env });
    expect(chosen.items.map((i) => i.key)).toEqual(["backlog:20261016T090000Z-a.md"]);
    expect(chosen.notes[0]).toMatch(/^Skipped the command source for this run: /);
  });
});
