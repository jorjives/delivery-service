import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInPacks } from "../src/packs/manifest.js";
import { flatten, REPO_ROOT, runDelivery } from "./helpers.js";

const REVIEW_ONLY = ["review folder", "reviews available", "available reviews", "which review", "write a review of your own", "A review: instructions", "also called a review", "usually from a review", "a review's scan and fix", "Ideas come from a [review]", "ideas from a review", "a review pack ("];
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
const glossaryPack = /## Pack\n([^]*?)\n## /.exec(read("docs/glossary.md"))?.[1] ?? "";

describe("pack wording", () => {
  it.each([["review"], ["packs"], ["packs", "check"], ["packs", "inspect"]])("delivery %s --help speaks of packs, not only reviews", (...args) => {
    const help = runDelivery([...args, "--help"]).stdout;
    for (const phrase of REVIEW_ONLY) expect(help).not.toContain(phrase);
    expect(help).toMatch(/pack/);
  });

  it("says delivery review starts a pack's find, and delivery packs lists the packs you can use", () => {
    expect(runDelivery(["review", "--help"]).stdout).toContain("start a pack's find");
    expect(runDelivery(["packs", "--help"]).stdout).toContain("list the packs you can use");
  });

  it("defines a pack in the glossary as a find-then-act job of which a review is one kind", async () => {
    const entry = flatten(glossaryPack);
    expect(entry).toContain("find-then-act");
    expect(entry).toMatch(/review is one kind/i);
    for (const { manifest } of await builtInPacks()) expect(entry).toContain(`\`${manifest.name}\``);
  });

  it.each(["README.md", "docs/index.md", "docs/glossary.md", "docs/cli-reference.md", "docs/configuration-reference.md", "docs/use-workflows.md", "docs/work-a-backlog.md"])("%s does not call every pack a review", (path) => {
    for (const phrase of REVIEW_ONLY) expect(read(path)).not.toContain(phrase);
  });

  it("the README says what packs are and links the packs page and the how-to", () => {
    const readme = read("README.md");
    expect(readme).toContain("find-then-act");
    expect(readme).toContain("(docs/packs.md)");
    expect(readme).toContain("(docs/move-off-deprecated-code.md)");
  });

  it("the command reference says delivery review starts a pack's find", () => {
    const row = read("docs/cli-reference.md").split("\n").find((line) => line.startsWith("| `delivery review <pack> [repo]`"));
    expect(row).toContain("pack's find");
  });
});
