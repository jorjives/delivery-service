import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import { cadenceMs, commitItemFields, isDue, itemsCalled, itemTask, orderItems, parseItem, readBacklog, setFields, type BacklogItem } from "./backlog.js";

const FILE = "20261016T090000Z-greet-people.md";
const TEXT = "---\nstatus: open\nworkflow: build\npriority: 10\nspec: docs/spec.md\n---\nGreet people by name.\n\nUse a friendly tone.\n";

const item = (over: Partial<BacklogItem>): BacklogItem => ({ file: FILE, status: "open", fields: {}, body: "x", ...over });

describe("parseItem", () => {
  it("reads the front matter and the body, keeping every other field for the task", () => {
    expect(parseItem(FILE, TEXT)).toEqual({
      ok: true,
      item: { file: FILE, status: "open", workflow: "build", priority: 10, fields: { spec: "docs/spec.md" }, body: "Greet people by name.\n\nUse a friendly tone.\n" },
    });
  });

  it("reads a cadence as a recurring interval", () => {
    const parsed = parseItem(FILE, "---\nstatus: open\ncadence: 7d\n---\nTidy the changelog.\n");
    expect(parsed.ok && parsed.item.cadenceMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ["no front matter", "Greet people.\n", "it does not start with front matter between --- lines"],
    ["an unknown status", "---\nstatus: done\n---\nx\n", "`status` must be one of open, idea, resolved or declined"],
    ["a cadence it cannot read", "---\nstatus: open\ncadence: weekly\n---\nx\n", "`cadence` must be a number and a unit, such as 30m, 12h, 7d or 2w"],
    ["front matter that is not YAML", "---\nstatus: [open\n---\nx\n", "its front matter is not valid YAML"],
    ["no brief", "---\nstatus: open\n---\n\n", "it has no brief below its front matter"],
  ])("refuses an item with %s, saying why", (_what, text, reason) => {
    const parsed = parseItem(FILE, text);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.reason).toContain(reason);
  });

  it("refuses a file not named <timestamp>-<slug>.md", () => {
    expect(parseItem("greet.md", TEXT)).toEqual({ ok: false, file: "greet.md", reason: "it is not named <timestamp>-<slug>.md, such as 20261016T090000Z-greet-people.md" });
  });

  it("reads a sequence name, keeping it on the task as well", () => {
    const parsed = parseItem("20261016T090000Z-a.md", "---\nstatus: open\nsequence: greeting-spec\n---\nSay hello.\n");
    expect(parsed).toMatchObject({ ok: true, item: { sequence: "greeting-spec", fields: { sequence: "greeting-spec" } } });
  });

  it("refuses a sequence that is not a name", () => {
    expect(parseItem("20261016T090000Z-a.md", "---\nstatus: open\nsequence: 3\n---\nSay hello.\n")).toEqual({ ok: false, file: "20261016T090000Z-a.md", reason: "`sequence` must name a sequence" });
  });

  it("refuses an item that both recurs and sits in a sequence", () => {
    expect(parseItem("20261016T090000Z-a.md", "---\nstatus: open\ncadence: 7d\nsequence: s\n---\nSay hello.\n")).toEqual({
      ok: false, file: "20261016T090000Z-a.md", reason: "it has a `cadence`, so it recurs, and a recurring item cannot be in a `sequence`: drop one of them",
    });
  });
});

describe("cadenceMs", () => {
  it.each([["30m", 1_800_000], ["12h", 43_200_000], ["2w", 1_209_600_000]])("reads %s", (text, ms) => expect(cadenceMs(text)).toBe(ms));
  it("reads nothing else", () => expect(cadenceMs("7 days")).toBeUndefined());
});

describe("orderItems", () => {
  it("puts lower priority first, ties and unprioritised items after by file name", () => {
    const ordered = orderItems([item({ file: "b.md" }), item({ file: "c.md", priority: 5 }), item({ file: "a.md" }), item({ file: "d.md", priority: 1 })]);
    expect(ordered.map((i) => i.file)).toEqual(["d.md", "c.md", "a.md", "b.md"]);
  });
});

describe("isDue", () => {
  const weekly = item({ cadenceMs: 7 * 86_400_000 });
  it("is due when it never closed", () => expect(isDue(weekly, null, new Date("2026-10-16T00:00:00Z"))).toBe(true));
  it("is not due before its interval has passed", () => expect(isDue(weekly, "2026-10-10T00:00:00Z", new Date("2026-10-16T00:00:00Z"))).toBe(false));
  it("is due once its interval has passed", () => expect(isDue(weekly, "2026-10-09T00:00:00Z", new Date("2026-10-16T00:00:00Z"))).toBe(true));
});

describe("itemTask", () => {
  it("is the brief as body, its first line as intent, and every other field", () => {
    const parsed = parseItem(FILE, TEXT);
    if (!parsed.ok) throw new Error("fixture");
    expect(itemTask(parsed.item)).toEqual({ intent: "Greet people by name.", body: "Greet people by name.\n\nUse a friendly tone.\n", spec: "docs/spec.md" });
  });
});

describe("setFields", () => {
  it("sets status to resolved and keeps everything else, comments included", () => {
    expect(setFields("---\nstatus: open # todo\nworkflow: build\n---\nBody.\n", { status: "resolved" })).toBe("---\nstatus: resolved # todo\nworkflow: build\n---\nBody.\n");
  });
});

const IDEA = (extra = "") => `---\nstatus: idea\nworkflow: code:fix\nseverity: high\ncheck:\n  kind: anchor-gone\n  path: total.js\n  anchor: "return price - discount;"\n${extra}---\n# The total can go below zero\n`;

describe("an item's severity and check", () => {
  it("reads both, and passes them on to the task", () => {
    const parsed = parseItem("20261019T120000Z-total.md", IDEA());
    expect(parsed.ok && parsed.item.severity).toBe("high");
    expect(parsed.ok && parsed.item.check).toEqual({ kind: "anchor-gone", path: "total.js", anchor: "return price - discount;" });
    expect(parsed.ok && itemTask(parsed.item)).toMatchObject({ severity: "high", check: { kind: "anchor-gone" } });
  });

  it("refuses a severity or a check outside the closed sets, in words", () => {
    expect(parseItem("20261019T120000Z-a.md", "---\nstatus: idea\nseverity: urgent\n---\n# a\n")).toEqual({ ok: false, file: "20261019T120000Z-a.md", reason: "`severity` must be one of critical, high, medium or low" });
    expect(parseItem("20261019T120000Z-a.md", "---\nstatus: idea\ncheck:\n  kind: tests-pass\n---\n# a\n")).toMatchObject({ ok: false, reason: expect.stringContaining("`check` must be") });
  });
});

describe("changing an item's fields", () => {
  it("sets the named fields and keeps everything else, comments included", () => {
    const text = "---\n# chosen by the review\nstatus: idea\nseverity: high\n---\n# a\n";
    expect(setFields(text, { status: "open", workflow: "code:fix" })).toBe("---\n# chosen by the review\nstatus: open\nseverity: high\nworkflow: code:fix\n---\n# a\n");
  });
});

describe("naming an item", () => {
  const items = [{ file: "20261019T120000Z-total.md" }, { file: "20261019T120100Z-settings.md" }, { file: "20261019T120200Z-total.md" }] as BacklogItem[];
  it("finds it by file name with or without .md, or by a slug only one item has", () => {
    expect(itemsCalled("20261019T120000Z-total", items).map((i) => i.file)).toEqual(["20261019T120000Z-total.md"]);
    expect(itemsCalled("settings", items).map((i) => i.file)).toEqual(["20261019T120100Z-settings.md"]);
    expect(itemsCalled("total", items)).toHaveLength(2);
  });
});

describe("committing an item's new fields", () => {
  it("commits only the named items on the current branch", async () => {
    const repo = initTempRepo("backlog-commit-", { ".delivery/backlog/20261019T120000Z-total.md": IDEA(), "other.txt": "x\n" });
    writeFileSync(join(repo, "other.txt"), "changed\n");
    const result = await commitItemFields(repo, ["20261019T120000Z-total.md"], { status: "open" }, "Approve 1 idea");
    expect(result).toHaveProperty("commit");
    expect(git(repo, ["show", "--name-only", "--format=%s", "HEAD"]).split("\n").filter(Boolean)).toEqual(["Approve 1 idea", ".delivery/backlog/20261019T120000Z-total.md"]);
    expect(git(repo, ["show", "HEAD:.delivery/backlog/20261019T120000Z-total.md"])).toContain("status: open");
    expect(readFileSync(join(repo, "other.txt"), "utf-8")).toBe("changed\n");
  });

  it("refuses, changing nothing, when a named item has uncommitted changes", async () => {
    const repo = initTempRepo("backlog-dirty-", { ".delivery/backlog/20261019T120000Z-total.md": IDEA() });
    writeFileSync(join(repo, ".delivery/backlog/20261019T120000Z-total.md"), IDEA("priority: 1\n"));
    expect(await commitItemFields(repo, ["20261019T120000Z-total.md"], { status: "open" }, "x")).toEqual({ dirty: [".delivery/backlog/20261019T120000Z-total.md"] });
    expect(git(repo, ["log", "--format=%s"]).split("\n")).toHaveLength(1);
  });

  it("reads the backlog at the current commit when asked", async () => {
    const repo = initTempRepo("backlog-at-", { ".delivery/backlog/20261019T120000Z-total.md": IDEA() });
    expect((await readBacklog(repo, { at: "HEAD" })).items.map((i) => i.status)).toEqual(["idea"]);
  });
});

describe("readBacklog", () => {
  it("reads committed items from the base commit, and names invalid and uncommitted ones", async () => {
    const repo = initTempRepo("backlog-", { [`.delivery/backlog/${FILE}`]: TEXT, ".delivery/backlog/20261016T090100Z-broken.md": "no front matter\n" });
    mkdirSync(join(repo, ".delivery", "backlog"), { recursive: true });
    writeFileSync(join(repo, ".delivery", "backlog", "20261016T090200Z-later.md"), TEXT);

    const backlog = await readBacklog(repo);

    expect(backlog.items.map((i) => i.file)).toEqual([FILE]);
    expect(backlog.invalid).toEqual([{ file: "20261016T090100Z-broken.md", reason: "it does not start with front matter between --- lines" }]);
    expect(backlog.uncommitted).toEqual(["20261016T090200Z-later.md"]);
    expect(git(repo, ["status", "--porcelain"])).toContain("later.md");
  });

  it("names an item committed locally but not pushed, when the base is origin's", async () => {
    const repo = initTempRepo("backlog-origin-", { "package.json": "{}" });
    addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    mkdirSync(join(repo, ".delivery", "backlog"), { recursive: true });
    writeFileSync(join(repo, ".delivery", "backlog", FILE), TEXT);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "item"]);

    const backlog = await readBacklog(repo);

    expect(backlog.items).toEqual([]);
    expect(backlog.uncommitted).toEqual([FILE]);
  });
});
