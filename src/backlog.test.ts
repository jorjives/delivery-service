import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import { cadenceMs, isDue, itemTask, orderItems, parseItem, readBacklog, resolvedText, type BacklogItem } from "./backlog.js";

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

describe("resolvedText", () => {
  it("sets status to resolved and keeps everything else, comments included", () => {
    expect(resolvedText("---\nstatus: open # todo\nworkflow: build\n---\nBody.\n")).toBe("---\nstatus: resolved # todo\nworkflow: build\n---\nBody.\n");
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
