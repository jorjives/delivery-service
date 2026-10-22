import { describe, expect, it } from "vitest";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { foldLedger } from "./item-ledger.js";
import { addLocalOrigin } from "./temp-repo.js";
import { taskId } from "./task-list.js";
import { chooseWork, listSource, raiseThrough } from "./work-sources.js";
import type { SourceConfig } from "./cli/config.js";
import type { RunRecord } from "./run-records.js";

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

  it("puts an item's sequence on the work item", async () => {
    const repo = repoWith({
      ".delivery/backlog/20261016T090000Z-a.md": item("open", "sequence: greeting-spec\n"),
      ".delivery/backlog/20261016T090100Z-b.md": item("open"),
    });
    const { items } = await listSource({ type: "backlog" }, { repoPath: repo, config: {}, env: {} });
    expect(items.map((i) => [i.id, i.sequence])).toEqual([["20261016T090000Z-a.md", "greeting-spec"], ["20261016T090100Z-b.md", undefined]]);
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
    const ledger = foldLedger([{ t: "parked", key: first ?? "", reason: "escalated", at }]);
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

  it("puts a task's sequence on the work item, so a slices source can make each slices file its own sequence", async () => {
    const repo = repoWith({});
    const tasks = [
      { id: "a-1", intent: "Spec A slice 1", sequence: "docs/specs/a-slices.md" },
      { id: "b-1", intent: "Spec B slice 1", sequence: "docs/specs/b-slices.md" },
      { id: "chore", intent: "Unrelated" },
    ];
    writeFileSync(join(repo, "tasks.sh"), `#!/bin/sh\n[ "$1" = list ] && echo '${JSON.stringify(tasks)}'\n`);
    chmodSync(join(repo, "tasks.sh"), 0o755);
    const { items } = await listSource({ type: "command", command: "./tasks.sh", name: "slices" }, { repoPath: repo, config: {}, env: process.env });
    expect(items.map((i) => [i.id, i.sequence])).toEqual([["a-1", "docs/specs/a-slices.md"], ["b-1", "docs/specs/b-slices.md"], ["chore", undefined]]);
  });

  it.each([
    ["exits non-zero", "#!/bin/sh\necho broken >&2\nexit 2\n", "`./tasks.sh list` exited with code 2: broken"],
    ["prints something that is not JSON", "#!/bin/sh\necho hello\n", "`./tasks.sh list` did not print JSON"],
    ["prints JSON of the wrong shape", "#!/bin/sh\necho '[{\"intent\":\"no id\"}]'\n", "`./tasks.sh list` printed tasks I can't read: each needs a string `id`, and a `sequence`, where there is one, must be a name"],
    ["prints a sequence that is not a name", "#!/bin/sh\necho '[{\"id\":\"a\",\"sequence\":3}]'\n", "`./tasks.sh list` printed tasks I can't read: each needs a string `id`, and a `sequence`, where there is one, must be a name"],
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

describe("the command source's tracker opt-in", () => {
  it("marks an item to raise follow-ups only when its command source says it is a tracker", async () => {
    const repo = repoWith({ "t.sh": `#!/bin/sh\n[ "$1" = list ] && echo '[{"id":"a"}]'\n` });
    const listed = (source: SourceConfig) => listSource(source, { repoPath: repo, config: {}, env: process.env }).then((l) => l.items[0]);
    expect(await listed({ type: "command", command: "sh t.sh", tracker: true })).toMatchObject({ raise: true });
    expect(await listed({ type: "command", command: "sh t.sh" })).not.toHaveProperty("raise");
  });
});

describe("raising a follow-up through a command source", () => {
  const NOT_A_TRACKER = (name: string): string => `the ${name} source is not a command source with "tracker": true, so it cannot raise items; drop the waiting step with \`delivery drop-after\` or set "tracker": true on it`;
  const ITEM = { file: "20261018T090000Z-tidy.md", text: "---\nstatus: open\npriority: 2\n---\nTidy the README.\n" };

  it("runs `<command> raise` with the item as JSON on its standard input and takes the id it prints", async () => {
    const repo = initTempRepo("raise-", { "t.sh": '#!/bin/sh\n[ "$1" = raise ] && cat > raised.json && echo "#42"\n' });
    const raised = await raiseThrough({ type: "command", command: "sh t.sh", tracker: true }, ITEM, { repoPath: repo, env: process.env });
    expect(raised).toEqual({ id: "#42" });
    expect(JSON.parse(readFileSync(join(repo, "raised.json"), "utf-8"))).toEqual({ file: ITEM.file, status: "open", priority: 2, body: "Tidy the README.\n" });
  });

  it("says why when the command fails, prints no id, or the source cannot raise", async () => {
    const repo = initTempRepo("raise-fail-", { "fails.sh": "echo down >&2; exit 3\n", "silent.sh": "exit 0\n" });
    expect(await raiseThrough({ type: "command", command: "sh fails.sh", tracker: true }, ITEM, { repoPath: repo, env: process.env })).toEqual({ error: "`sh fails.sh raise` exited with code 3: down" });
    expect(await raiseThrough({ type: "command", command: "sh silent.sh", tracker: true }, ITEM, { repoPath: repo, env: process.env })).toEqual({ error: "`sh silent.sh raise` printed no id" });
    expect(await raiseThrough({ type: "backlog" }, ITEM, { repoPath: repo, env: process.env })).toEqual({ error: NOT_A_TRACKER("backlog") });
    expect(await raiseThrough({ type: "command", command: "sh silent.sh" }, ITEM, { repoPath: repo, env: process.env })).toEqual({ error: NOT_A_TRACKER("command") });
  });
});

describe("the github source", () => {
  it("is dispatched like any other source, and a failing one does not stop the others", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a.md": item("open") });
    const chosen = await chooseWork([{ type: "github" }, { type: "backlog" }], { ...base, repoPath: repo, env: { ...process.env, PATH: "/nonexistent" } });
    expect(chosen.items.map((i) => i.key)).toEqual(["backlog:20261016T090000Z-a.md"]);
    expect(chosen.notes[0]).toMatch(/^Skipped the github source for this run: the GitHub command-line tool \(gh\) is not installed/);
  });
});

describe("chooseWork with sequences", () => {
  // Spec A has three slices and spec B two, by priority; one unrelated item comes last.
  const A1 = "backlog:20261016T090000Z-a1.md";
  const A2 = "backlog:20261016T090100Z-a2.md";
  const A3 = "backlog:20261016T090200Z-a3.md";
  const B1 = "backlog:20261016T090300Z-b1.md";
  const X = "backlog:20261016T090500Z-x.md";
  const specs = () => repoWith({
    ".delivery/backlog/20261016T090000Z-a1.md": item("open", "priority: 1\nsequence: spec-a\n"),
    ".delivery/backlog/20261016T090100Z-a2.md": item("open", "priority: 2\nsequence: spec-a\n"),
    ".delivery/backlog/20261016T090200Z-a3.md": item("open", "priority: 3\nsequence: spec-a\n"),
    ".delivery/backlog/20261016T090300Z-b1.md": item("open", "priority: 4\nsequence: spec-b\n"),
    ".delivery/backlog/20261016T090400Z-b2.md": item("open", "priority: 5\nsequence: spec-b\n"),
    ".delivery/backlog/20261016T090500Z-x.md": item("open", "priority: 6\n"),
  });
  const keys = (chosen: { items: { key: string }[] }) => chosen.items.map((i) => i.key);

  it("takes only the earliest item of each sequence, and items without one as usual", async () => {
    const chosen = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs() });
    expect(keys(chosen)).toEqual([A1, B1, X]);
    expect(chosen.held).toEqual([{ sequence: "spec-a", item: A1, source: "backlog", reason: "in_flight" }, { sequence: "spec-b", item: B1, source: "backlog", reason: "in_flight" }]);
  });

  it("holds a sequence behind a parked earliest item, and nothing else", async () => {
    const ledger = foldLedger([{ t: "parked", key: A1, reason: "escalated", at }]);
    const chosen = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs(), ledger });
    expect(keys(chosen)).toEqual([B1, X]);
    expect(chosen.held).toEqual([{ sequence: "spec-a", item: A1, source: "backlog", reason: "parked" }, { sequence: "spec-b", item: B1, source: "backlog", reason: "in_flight" }]);
  });

  it("says a sequence waits for an answer when its earliest item asked a question", async () => {
    const ledger = foldLedger([{ t: "parked", key: A1, reason: "decision", at }]);
    const chosen = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs(), ledger });
    expect(chosen.held[0]).toEqual({ sequence: "spec-a", item: A1, source: "backlog", reason: "decision" });
  });

  it("holds a sequence behind an item still being worked, whether carried on in this run or by a run without an outcome", async () => {
    const carried = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs(), taken: new Set([A1]) });
    expect(keys(carried)).toEqual([B1, X]);
    expect(carried.held[0]).toEqual({ sequence: "spec-a", item: A1, source: "backlog", reason: "in_flight" });

    const ledger = foldLedger([{ t: "dispatched", key: A1, runId: "a1-run", intent: "x", at }]);
    // Only the fields dispatch reads: which run, and that it has no outcome yet.
    const records = [{ runId: "a1-run", caseFile: { outcome: undefined } }] as unknown as RunRecord[];
    const running = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs(), ledger, records });
    expect(keys(running)).toEqual([B1, X]);
    expect(running.held[0]).toEqual({ sequence: "spec-a", item: A1, source: "backlog", reason: "in_flight" });
  });

  it("counts a landed item whose pull request is not merged as delivered, and takes the next", async () => {
    const repo = specs();
    git(repo, ["branch", "delivery/main"]);
    const ledger = foldLedger([{ t: "ended", key: A1, runId: "a1-run", class: "delivered", branch: "delivery/main", commit: git(repo, ["rev-parse", "HEAD"]), at }]);
    expect(keys(await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, ledger }))).toEqual([A2, B1, X]);
  });

  it("takes at most one item of a sequence however many a run may take", async () => {
    const repo = repoWith({
      ".delivery/backlog/20261016T090000Z-a1.md": item("open", "priority: 1\nsequence: spec-a\n"),
      ".delivery/backlog/20261016T090100Z-a2.md": item("open", "priority: 2\nsequence: spec-a\n"),
      ".delivery/backlog/20261016T090200Z-a3.md": item("open", "priority: 3\nsequence: spec-a\n"),
    });
    expect(keys(await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, max: 3 }))).toEqual([A1]);
  });

  // `only` is how `delivery sign-off` runs one named item: it must not jump its sequence either.
  it("does not take a later item named alone while an earlier one is undelivered", async () => {
    const chosen = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs(), only: A3 });
    expect(keys(chosen)).toEqual([]);
  });

  it("holds nothing up when the earliest undelivered item is the last of its sequence", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a1.md": item("open", "sequence: spec-a\n") });
    const ledger = foldLedger([{ t: "parked", key: A1, reason: "escalated", at }]);
    expect((await chooseWork([{ type: "backlog" }], { ...base, repoPath: repo, ledger })).held).toEqual([]);
  });

  it("joins items of the same name from different sources into one sequence, in source order", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090000Z-a1.md": item("open", "sequence: spec-a\n") });
    writeFileSync(join(repo, "tasks.sh"), `#!/bin/sh\n[ "$1" = list ] && echo '[{"id":"a2","intent":"A2","sequence":"spec-a"}]'\n`);
    chmodSync(join(repo, "tasks.sh"), 0o755);
    const chosen = await chooseWork([{ type: "backlog" }, { type: "command", command: "./tasks.sh", name: "slices" }], { ...base, repoPath: repo, env: process.env });
    expect(keys(chosen)).toEqual([A1]);
  });

  it("gives each slices file its own sequence, so a parked slice holds only its own spec", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090500Z-x.md": item("open") });
    const tasks = ["a", "b"].flatMap((spec) => [1, 2, 3].map((n) => ({ id: `${spec}-${n}`, intent: `Spec ${spec} slice ${n}`, sequence: `docs/specs/${spec}-slices.md` })));
    writeFileSync(join(repo, "next-slice.sh"), `#!/bin/sh\n[ "$1" = list ] && echo '${JSON.stringify(tasks)}'\n`);
    chmodSync(join(repo, "next-slice.sh"), 0o755);
    const repoHead = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["branch", "delivery/main"]);
    const ledger = foldLedger([
      { t: "ended", key: "slices:a-1", runId: "a1-run", class: "delivered", branch: "delivery/main", commit: repoHead, at },
      { t: "parked", key: "slices:a-2", reason: "escalated", at },
    ]);
    const chosen = await chooseWork([{ type: "backlog" }, { type: "command", command: "./next-slice.sh", name: "slices" }], { ...base, repoPath: repo, env: process.env, ledger, max: 3 });
    expect(keys(chosen)).toEqual([X, "slices:b-1"]);
    expect(chosen.held).toEqual([
      { sequence: "docs/specs/a-slices.md", item: "slices:a-2", source: "slices", reason: "parked" },
      { sequence: "docs/specs/b-slices.md", item: "slices:b-1", source: "slices", reason: "in_flight" },
    ]);
    expect(chosen.read).toEqual(["backlog", "slices"]);
  });

  // The default --max 1: the backlog item fills the run, so the slices source is never listed.
  it("reads no further source once max are chosen, and says which it read, so a later source's holds are not claimed", async () => {
    const repo = repoWith({ ".delivery/backlog/20261016T090500Z-x.md": item("open") });
    writeFileSync(join(repo, "next-slice.sh"), `#!/bin/sh\n[ "$1" = list ] && echo '[{"id":"a-1","intent":"A1","sequence":"spec-a"},{"id":"a-2","intent":"A2","sequence":"spec-a"}]'\n`);
    chmodSync(join(repo, "next-slice.sh"), 0o755);
    const ledger = foldLedger([{ t: "parked", key: "slices:a-1", reason: "escalated", at }]);
    const chosen = await chooseWork([{ type: "backlog" }, { type: "command", command: "./next-slice.sh", name: "slices" }], { ...base, repoPath: repo, env: process.env, ledger, max: 1 });
    expect(keys(chosen)).toEqual([X]);
    expect(chosen.read).toEqual(["backlog"]);
    expect(chosen.held).toEqual([]);
  });

  it("scans a source it reads to its end, even after max is chosen within it, so holds behind the chosen item are seen", async () => {
    const chosen = await chooseWork([{ type: "backlog" }], { ...base, repoPath: specs(), max: 1, ledger: foldLedger([{ t: "parked", key: B1, reason: "escalated", at }]) });
    expect(keys(chosen)).toEqual([A1]);
    expect(chosen.read).toEqual(["backlog"]);
    expect(chosen.held).toEqual([{ sequence: "spec-a", item: A1, source: "backlog", reason: "in_flight" }, { sequence: "spec-b", item: B1, source: "backlog", reason: "parked" }]);
  });

  it("ignores a sequence on a fallback source's items, which are never delivered", async () => {
    const repo = repoWith({});
    writeFileSync(join(repo, "tasks.sh"), `#!/bin/sh\n[ "$1" = list ] && echo '[{"id":"f1","intent":"F1","sequence":"s"},{"id":"f2","intent":"F2","sequence":"s"}]'\n`);
    chmodSync(join(repo, "tasks.sh"), 0o755);
    const chosen = await chooseWork([{ type: "command", command: "./tasks.sh", name: "chores", fallback: true }], { ...base, repoPath: repo, env: process.env, max: 3 });
    expect(keys(chosen)).toEqual(["chores:f1", "chores:f2"]);
    expect(chosen.held).toEqual([]);
  });

  it("reads only the sources up to the named item when one item is run alone", async () => {
    const chosen = await chooseWork([{ type: "backlog" }, { type: "command", command: "./never-run.sh", name: "slices" }], { ...base, repoPath: specs(), env: process.env, only: X, max: 1 });
    expect(keys(chosen)).toEqual([X]);
    expect(chosen.read).toEqual(["backlog"]);
  });
});
