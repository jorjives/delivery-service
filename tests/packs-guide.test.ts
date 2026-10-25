// docs/packs.md is the page a reader meets first: it says what a pack is for, which
// built-ins ship, how a pack's loop runs and what a find cannot promise. Its names and
// output are checked against the code, not retyped, so the page cannot drift from it.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PACKAGE } from "../src/cli/command-fixtures.js";
import { refusedLines } from "../src/cli/installed-render.js";
import { EXIT } from "../src/cli/failures.js";
import type { Ask } from "../src/cli/init.js";
import { context, scriptedAsk } from "../src/cli/init-fixtures.js";
import { packLines, packsCommand } from "../src/cli/packs-command.js";
import { packsAddCommand } from "../src/cli/packs-add-command.js";
import { packsUpdateCommand } from "../src/cli/packs-update-command.js";
import { renderInspection, renderRefusal } from "../src/cli/packs-inspect-render.js";
import { builtInPackClash } from "../src/cli/pack-clash.js";
import { MAY_BE_MORE } from "../src/cli/review-command.js";
import { checkInstalledPack } from "../src/packs/install/installed.js";
import { fakePackSource } from "../src/packs/install/fake-source.js";
import { packPackage, SCAN_TEXT } from "../src/packs/install/install-fixtures.js";
import { readLock } from "../src/packs/install/lock.js";
import { inspectionOf, NO_PROJECT } from "../src/packs/inspection.js";
import { builtInPacks, IDEA_CAP } from "../src/packs/manifest.js";
import { HOUSEKEEPING, NOT_IN_A_PACK, readPackFolder } from "../src/packs/pack-folder.js";
import { FORBIDDEN, REASSURING } from "../src/report/report-fixtures.js";
import { initTempRepo } from "../src/temp-repo.js";
import { firstParagraph, flatten, REPO_ROOT } from "./helpers.js";

const builtIns = await builtInPacks();
const page = readFileSync(join(REPO_ROOT, "docs/packs.md"), "utf-8");
const index = readFileSync(join(REPO_ROOT, "docs/index.md"), "utf-8");
const deprecations = builtIns.find((p) => p.manifest.name === "deprecations");
const read = deprecations && (await readPackFolder(deprecations.dir));
if (!deprecations || !read?.ok) throw new Error("the deprecations pack is not read by the folder check");
const account = renderInspection(inspectionOf(deprecations, NO_PROJECT, read.files));
const opening = account.slice(0, account.findIndex((l) => l.startsWith("Instructions for ")) - 1);
const inspecting = page.slice(page.indexOf("## Inspect a pack before you use it"), page.indexOf("## Add a pack from elsewhere"));

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

const NAME = "@acme/delivery-pack-docs";
const SCAN = { kind: "find", prompt: "scan.md", ideasFor: ["code"] };
/** The 1.2.0 the section adds: its `code` workflow waits for sign-off on ideas rated high or critical. */
const V1 = packPackage({ manifest: { workflows: { scan: SCAN, code: { kind: "act", prompt: "code.md", hold: { atOrAbove: "high" } } } } });
/** 1.3.0: the same pack with the `code` workflow's sign-off removed. */
const V2 = packPackage({ version: "1.3.0", manifest: { workflows: { scan: SCAN, code: { kind: "act", prompt: "code.md" } } } });

/** The lines of each fenced block in `markdown` whose opening fence is `lang`. */
function fencedBlocks(markdown: string, lang: string): string[][] {
  const blocks: string[][] = [];
  let open: string[] | undefined;
  for (const line of markdown.split("\n")) {
    if (open === undefined) {
      if (line === "```" + lang) open = [];
    } else if (line === "```") {
      blocks.push(open);
      open = undefined;
    } else open.push(line);
  }
  return blocks;
}

/** Whether `block` appears as consecutive lines of `lines`. */
function containsRun(lines: readonly string[], block: readonly string[]): boolean {
  for (let start = 0; start + block.length <= lines.length; start++) {
    if (block.every((line, offset) => lines[start + offset] === line)) return true;
  }
  return false;
}

/** The one item of a list, which must be the only one. */
function only<T>(items: T[]): T {
  if (items.length !== 1) throw new Error(`expected exactly one block, found ${items.length}`);
  return items[0] as T;
}

/** An ask whose yes-or-no questions are also written to `lines`, where a terminal would show them as they are asked. */
function askedOn(lines: string[], ask: Ask): Ask {
  return {
    ...ask,
    confirm: (question) => {
      lines.push(question.message);
      return ask.confirm(question);
    },
  };
}

describe("the packs page on adding a pack from elsewhere", () => {
  const section = page.slice(page.indexOf("## Add a pack from elsewhere"), page.indexOf("## Names the built-ins keep"));
  const PINNING =
    "Pinning keeps your review stable: every machine and every run uses the pack you read, until you choose to update it. It does not make a pack safe: read the account before you accept it, and read the change before you update.";

  // Every line the commands print for the worked example, each run in process in a fresh repository with the fake pack source.
  const printed: string[][] = [];
  let first = "";
  let listingOfTheExampleProject: unknown;

  beforeAll(async () => {
    // The first project: added with a yes, updated with a no, then a word changed in its scan.
    first = initTempRepo("guide-first-", { "package.json": PACKAGE });
    const firstSource = fakePackSource();
    firstSource.publish(NAME, "1.2.0", V1);
    const added = context(first);
    if ((await packsAddCommand(NAME, added.ctx, askedOn(added.lines, scriptedAsk({ confirm: true }).ask), firstSource)) !== EXIT.ok) throw new Error("add with a yes");
    printed.push(added.lines);

    firstSource.publish(NAME, "1.3.0", V2);
    const updated = context(first);
    if ((await packsUpdateCommand("docs-drift", undefined, updated.ctx, askedOn(updated.lines, scriptedAsk({ confirm: false }).ask), firstSource)) !== EXIT.ok) {
      throw new Error("update with a no");
    }
    printed.push(updated.lines);

    writeFileSync(join(first, ".delivery", "packs", "docs-drift", "scan.md"), SCAN_TEXT.replace("find calls", "seek calls"));
    const entry = (await readLock(first)).packs["docs-drift"];
    if (entry === undefined) throw new Error("docs-drift is not in the record");
    const state = await checkInstalledPack(first, "docs-drift", entry);
    if (state.state === "ok") throw new Error("a changed scan.md must not read as approved");
    printed.push(refusedLines(first, state));

    // The second project: added with nobody to ask, then with the fingerprint the refusal printed.
    const second = initTempRepo("guide-second-", { "package.json": PACKAGE });
    const secondSource = fakePackSource();
    secondSource.publish(NAME, "1.2.0", V1);
    const nobody = context(second, { interactive: false });
    if ((await packsAddCommand(NAME, nobody.ctx, scriptedAsk({ confirm: true }).ask, secondSource)) !== EXIT.configuration) throw new Error("add with nobody to ask");
    printed.push(nobody.lines);
    // The account prints the fingerprint in two halves, one to a line, as the add test reads it.
    const hash = nobody.lines
      .filter((line) => /^ {2}[0-9a-f]{32}$/.test(line))
      .map((line) => line.trim())
      .join("");
    const approved = context(second, { interactive: false });
    if ((await packsAddCommand(NAME, approved.ctx, scriptedAsk().ask, secondSource, { approve: hash })) !== EXIT.ok) throw new Error("add with --approve");
    printed.push(approved.lines);

    const listing = context(second, { json: true });
    if ((await packsCommand({}, listing.ctx)) !== EXIT.ok) throw new Error("packs --json");
    listingOfTheExampleProject = JSON.parse(listing.lines.join("\n"));
  }, 60_000);

  it("has the section", () => expect(section.length).toBeGreaterThan(0));

  it("shows in every text example lines the commands print, in the order they print them", () => {
    const blocks = fencedBlocks(section, "text");
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    for (const block of blocks) expect(printed.some((run) => containsRun(run, block))).toBe(true);
  });

  it("shows the pack list as data exactly as delivery packs --json gives it", () => {
    expect(JSON.parse(only(fencedBlocks(section, "json")).join("\n"))).toEqual(listingOfTheExampleProject);
  });

  it("gives the add command as typed with the fingerprint the account shows, and it adds, recording the same request as the interactive add", async () => {
    const block = fencedBlocks(section, "text").find((lines) => lines.some((line) => line.includes("--approve")));
    if (block === undefined) throw new Error("the section has no add command with --approve");
    // A shell reads a backslash at a line's end as joining it to the next line.
    const command = block.join("\n").match(/delivery packs add \S+ \\\n\s+--approve [0-9a-f]{32}\\\n[0-9a-f]{32}/)?.[0];
    if (command === undefined) throw new Error("the add command is not as the section shows it");
    const [, , , spec = "", flag, approve = ""] = command.replace(/\\\n\s*/g, "").split(" ");
    expect(flag).toBe("--approve");
    expect(approve).toHaveLength(64);
    expect(spec).toBe(NAME);

    const fresh = initTempRepo("guide-typed-", { "package.json": PACKAGE });
    const source = fakePackSource();
    source.publish(NAME, "1.2.0", V1);
    expect(await packsAddCommand(spec, context(fresh, { interactive: false }).ctx, scriptedAsk().ask, source, { approve })).toBe(EXIT.ok);
    expect((await readLock(fresh)).packs["docs-drift"]).toEqual((await readLock(first)).packs["docs-drift"]);
  });

  it("says pinning keeps review stable and does not make a pack safe", () => {
    expect(flatten(section)).toContain("Pinning keeps your review stable");
    expect(flatten(section)).toContain("It does not make a pack safe");
  });

  it("names the keyword publishers use, so owners can search npm", () => expect(section).toContain("npm search keywords:delivery-pack"));

  it("quotes the upgrade sentence", () => expect(section).toContain("upgrade delivery-service to read this pack"));

  it("keeps to the owner's vocabulary outside the one pinning sentence, and uses no em-dashes", () => {
    const outside = flatten(section).replace(PINNING, "");
    expect(outside).not.toMatch(FORBIDDEN);
    expect(outside).not.toMatch(REASSURING);
    expect(section).not.toContain("—");
  });
});
