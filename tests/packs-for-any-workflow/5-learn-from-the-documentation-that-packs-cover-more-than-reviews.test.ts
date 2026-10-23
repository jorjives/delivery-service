// Slice 5: Learn from the documentation that packs cover more than reviews
// Source: docs/superpowers/specs/2026-10-23-packs-for-any-workflow-slices.md
// Recorded: 2026-10-23 against commit 575a73a
//
// Reads the published pages as a person would (docs/*.md, README.md, .changeset/*.md) and
// runs the compiled `delivery` command (tests/helpers.ts's runDelivery) to check that what
// the pages say matches what the command says and prints. Assertions are on stable phrases
// and on commands existing, never on whole pages.
//
// SKIPPED AC: "The first paragraph ... names the three built-ins" and the packs page's
//   loop, cap and name-reservation text are asserted in more depth against the harness's
//   own constants in tests/packs-guide.test.ts; here they are checked as a reader meets them.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstParagraph, flatten, helpOf, REPO_ROOT, runDelivery } from "../helpers.js";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
const BUILT_INS = ["code", "security", "deprecations"];
const REVIEW_ONLY = ["review folder", "reviews available", "available reviews", "which review", "write a review of your own", "A review: instructions"];
const commandsIn = (page: string) =>
  [...page.matchAll(/```bash\n([^]*?)```/g)].flatMap(([, body]) => (body ?? "").split("\n")).filter((line) => line.startsWith("delivery "));

describe("UAT: understand what packs are for and write one of your own from a worked example", () => {
  it("the index and the packs page open by saying packs cover more than reviews", () => {
    for (const page of ["docs/index.md", "docs/packs.md"]) {
      const opening = firstParagraph(read(page));
      expect(opening, page).toContain("find-then-act");
      expect(opening, page).toMatch(/reviews? (is|are) one kind/i);
      for (const name of BUILT_INS) expect(opening, page).toContain(`\`${name}\``);
    }
  });

  it("the how-to uses only commands and options the command line has, and the pages link up", () => {
    const howTo = read("docs/move-off-deprecated-code.md");
    const top = helpOf([]).commands;
    const lines = commandsIn(howTo);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const name = line.split(/\s+/)[1] ?? "";
      expect(top, line).toContain(name);
      for (const flag of line.match(/--[a-z-]+/g) ?? []) expect(helpOf([name]).options, line).toContain(flag);
    }
    expect(read("docs/packs.md")).toContain("](move-off-deprecated-code.md)");
    expect(read("docs/index.md")).toContain("](packs.md)");
  });

  it("the how-to shows how to mark a deprecation exactly as the built-in's sample project does", () => {
    const marked = read("packs/deprecations/fixtures/project/lib/legacy-dates.js").split("\n").find((l) => l.includes("@deprecated"));
    expect(marked).toBeDefined();
    expect(read("docs/move-off-deprecated-code.md")).toContain(marked as string);
  });

  it("the pack-writing guide's example is the built-in's own manifest, and the old format still works", () => {
    const guide = read("docs/writing-a-pack.md");
    const blocks = [...guide.matchAll(/```json\n([^]*?)```/g)].map(([, body]) => JSON.parse(body ?? ""));
    expect(blocks).toContainEqual(JSON.parse(read("packs/deprecations/pack.json")));
    expect(flatten(guide)).toMatch(/delivery\.pack\/2 packs? (still|keep)/);
    expect(guide).toContain("## What a scripted check cannot prove");
  });
});

describe("acceptance criteria", () => {
  it("the packs page gives the find, approve, act, sign-off loop in text, with the limits, the cap and the reserved names", () => {
    const page = read("docs/packs.md");
    const steps = page.split("\n").filter((line) => /^\d+\. /.test(line));
    const at = (cmd: string) => steps.findIndex((line) => line.includes(cmd));
    const order = ["delivery review <pack>", "delivery approve", "delivery run --sources", "delivery sign-off"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(flatten(page)).toContain("not a guarantee");
    expect(page).toContain("40 ideas");
    expect(page).toContain("There may be more");
    for (const name of ["deprecations:scan", "deprecations:code", "deprecations:tests"]) expect(page).toContain(`\`${name}\``);
  });

  it("the command help, glossary, README and reference no longer call every pack a review", () => {
    for (const args of [["review"], ["packs"]]) {
      const help = runDelivery([...args, "--help"]).stdout;
      expect(help).toMatch(/pack/);
      for (const phrase of REVIEW_ONLY) expect(help).not.toContain(phrase);
    }
    expect(runDelivery(["review", "--help"]).stdout).toContain("start a pack's find");
    expect(flatten(/## Pack\n([^]*?)\n## /.exec(read("docs/glossary.md"))?.[1] ?? "")).toMatch(/review is one kind/i);
    for (const path of ["README.md", "docs/index.md", "docs/glossary.md", "docs/cli-reference.md"]) for (const phrase of REVIEW_ONLY) expect(read(path), path).not.toContain(phrase);
  });

  it("the docs navigation lists the packs page and the how-to", () => {
    const nav = read("mkdocs.yml");
    expect(nav).toContain("packs.md");
    expect(nav).toContain("move-off-deprecated-code.md");
  });

  it("the release notes say delivery review starts any pack's find and that the built-in names are reserved", () => {
    const notes = readdirSync(join(REPO_ROOT, ".changeset")).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => flatten(read(`.changeset/${f}`)));
    expect(notes.some((n) => /`delivery review` starts the find of any pack/.test(n))).toBe(true);
    expect(notes.some((n) => /reserved/.test(n) && n.includes("`deprecations`"))).toBe(true);
  });
});
