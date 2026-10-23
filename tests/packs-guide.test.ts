// docs/packs.md is the page a reader meets first: it says what a pack is for, which
// built-ins ship, how a pack's loop runs and what a find cannot promise. Its names and
// output are checked against the code, not retyped, so the page cannot drift from it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packLines } from "../src/cli/packs-command.js";
import { builtInPackClash } from "../src/cli/pack-workflows.js";
import { MAY_BE_MORE } from "../src/cli/review-command.js";
import { builtInPacks, IDEA_CAP } from "../src/packs/manifest.js";
import { firstParagraph, flatten, REPO_ROOT } from "./helpers.js";

const builtIns = await builtInPacks();
const page = readFileSync(join(REPO_ROOT, "docs/packs.md"), "utf-8");
const index = readFileSync(join(REPO_ROOT, "docs/index.md"), "utf-8");

describe.each([
  ["docs/packs.md", page],
  ["docs/index.md", index],
])("the opening paragraph of %s", (_, text) => {
  it("says a pack is a find-then-act job, a review is one kind, and names every built-in", () => {
    const opening = firstParagraph(text);
    expect(opening).toContain("find-then-act");
    expect(opening).toMatch(/reviews? (is|are) one kind/i);
    for (const { manifest } of builtIns) expect(opening).toContain(`\`${manifest.name}\``);
  });
});

describe("the packs page", () => {
  it("shows what each built-in does and how to start it, as delivery packs prints it", () => {
    expect(page).toContain(packLines(builtIns).join("\n"));
  });

  it("gives the loop as a numbered list, find then approve then act then sign-off", () => {
    // indexes of the first numbered line naming each, strictly increasing
    const steps = page.split("\n").filter((line) => /^\d+\. /.test(line));
    const at = (cmd: string) => steps.findIndex((line) => line.includes(cmd));
    const order = ["delivery review <pack>", "delivery approve", "delivery run --sources", "delivery sign-off"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("says delivery review starts any pack's find", () => expect(flatten(page)).toContain("`delivery review <pack>` starts any pack's find"));

  it("states the limits of a find and the cap", () => {
    expect(flatten(page)).toContain("not a guarantee");
    expect(page).toContain(String(IDEA_CAP));
    expect(page).toContain(MAY_BE_MORE);
  });

  it("says which names the built-ins keep and quotes the sentence a clash draws", () => {
    const deprecations = builtIns.find((p) => p.manifest.name === "deprecations");
    expect(deprecations).toBeDefined();
    for (const name of Object.keys(deprecations?.workflows ?? {})) expect(page).toContain(`\`${name}\``);
    expect(flatten(page)).toContain(builtInPackClash("deprecations", "my-deprecations/pack.json"));
  });

  it("uses no em-dashes", () => {
    expect(page).not.toContain("—");
  });
});
