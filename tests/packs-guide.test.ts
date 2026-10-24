// docs/packs.md is the page a reader meets first: it says what a pack is for, which
// built-ins ship, how a pack's loop runs and what a find cannot promise. Its names and
// output are checked against the code, not retyped, so the page cannot drift from it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packLines } from "../src/cli/packs-command.js";
import { renderInspection, renderRefusal } from "../src/cli/packs-inspect-render.js";
import { builtInPackClash } from "../src/cli/pack-clash.js";
import { MAY_BE_MORE } from "../src/cli/review-command.js";
import { inspectionOf, NO_PROJECT } from "../src/packs/inspection.js";
import { builtInPacks, IDEA_CAP } from "../src/packs/manifest.js";
import { HOUSEKEEPING, NOT_IN_A_PACK, readPackFolder } from "../src/packs/pack-folder.js";
import { FORBIDDEN, REASSURING } from "../src/report/report-fixtures.js";
import { firstParagraph, flatten, REPO_ROOT } from "./helpers.js";

const builtIns = await builtInPacks();
const page = readFileSync(join(REPO_ROOT, "docs/packs.md"), "utf-8");
const index = readFileSync(join(REPO_ROOT, "docs/index.md"), "utf-8");
const deprecations = builtIns.find((p) => p.manifest.name === "deprecations");
const read = deprecations && (await readPackFolder(deprecations.dir));
if (!deprecations || !read?.ok) throw new Error("the deprecations pack is not read by the folder check");
const account = renderInspection(inspectionOf(deprecations, NO_PROJECT, read.files));
const opening = account.slice(0, account.findIndex((l) => l.startsWith("Instructions for ")) - 1);
const inspecting = page.slice(page.indexOf("## Inspect a pack before you use it"), page.indexOf("## Names the built-ins keep"));

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

describe("the packs page on inspection", () => {
  it("gives a worked reading of the deprecations pack, as delivery packs inspect prints it", () => {
    expect(page).toContain(["```text", ...opening, "```"].join("\n"));
  });

  it("walks through every part of the account in the order it prints them", () => {
    const after = inspecting.slice(inspecting.indexOf("```", inspecting.indexOf("```text") + 1));
    // The unindented lines after the three identity lines are the account's headings.
    const headings = opening.filter((l) => l !== "" && !l.startsWith(" ")).slice(3);
    const at = headings.map((h) => after.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("says what inspection does not promise, and what the folder rule allows and refuses", () => {
    const text = flatten(inspecting);
    for (const sentence of [
      "Inspection is a reading aid, not a guarantee.",
      "It does not analyse the instructions: they are what the agent follows, so they are the part to read.",
      "Nothing unusual found means nothing unusual in what the command checks, not that the pack is harmless.",
    ]) expect(text).toContain(sentence);
    for (const name of ["pack.json", "fixtures", "README", "licence", "changelog", ".git/", ...HOUSEKEEPING]) expect(inspecting).toContain(name);
    for (const word of ["link", "script", "no workflow names", "UTF-8", "code 2"]) expect(text).toContain(word);
    expect(inspecting).toContain(renderRefusal("/home/you/their-pack", [{ file: "/home/you/their-pack/install.sh", field: null, message: NOT_IN_A_PACK }], "/home/you").join("\n"));
  });

  it("keeps to the owner's vocabulary on the page and in the command reference rows", () => {
    const reference = readFileSync(join(REPO_ROOT, "docs/cli-reference.md"), "utf-8").split("\n").filter((l) => /^\| `(delivery )?packs( inspect)?/.test(l)).join("\n");
    for (const text of [inspecting, reference]) {
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(REASSURING);
    }
  });

  it("links the worked reading from the command reference", () => {
    const row = readFileSync(join(REPO_ROOT, "docs/cli-reference.md"), "utf-8").split("\n").find((l) => l.startsWith("| `delivery packs inspect <pack>`"));
    expect(row).toContain("(packs.md#inspect-a-pack-before-you-use-it)");
  });
});
