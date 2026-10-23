// docs/move-off-deprecated-code.md is the how-to for the built-in deprecations pack. Its
// commands are checked against `delivery --help`, and what it quotes against what the
// commands print, so the page cannot drift from the harness it describes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packLines } from "../src/cli/packs-command.js";
import { packAdded, packStarting, nothingFound } from "../src/cli/review-command.js";
import { BUILT_IN_PACKS, builtInPacks, loadPack } from "../src/packs/manifest.js";
import { flatten, helpOf, REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/move-off-deprecated-code.md"), "utf-8");
const pack = await loadPack(join(BUILT_IN_PACKS, "deprecations"));
const commandLines = [...guide.matchAll(/```bash\n([^]*?)```/g)].flatMap(([, body]) => (body ?? "").split("\n")).filter((line) => line.startsWith("delivery "));

it("names every command an owner uses, from finding to the report", () => {
  for (const command of ["delivery packs", "delivery review deprecations", "delivery review deprecations --preview", "delivery backlog", "delivery approve", "delivery approve --all", "delivery decline", "delivery run --sources", "delivery sign-off", "delivery reject", "delivery report"]) expect(commandLines.some((line) => line.startsWith(command))).toBe(true);
});
it("uses only commands and options the command line has", () => {
  const top = helpOf([]).commands;
  for (const line of commandLines) {
    const [, name] = line.split(/\s+/);
    expect(top).toContain(name);
    for (const flag of line.match(/--[a-z-]+/g) ?? []) expect(helpOf([name!]).options).toContain(flag);
  }
});
it("quotes what the commands print", async () => {
  expect(guide).toContain(packLines(await builtInPacks()).join("\n"));
  for (const line of [...packStarting(pack, undefined), ...packAdded(pack, 3), nothingFound(pack)]) expect(flatten(guide)).toContain(flatten(line));
});
it("teaches how to mark a deprecation the way the pack's own fixture does", () => {
  const marked = readFileSync(join(BUILT_IN_PACKS, "deprecations/fixtures/project/lib/legacy-dates.js"), "utf-8").split("\n").find((l) => l.includes("@deprecated"));
  expect(guide).toContain(marked);
});
it("links the limits on the packs page and uses no em-dashes or engine words", () => {
  expect(guide).toContain("](packs.md");
  expect(guide).not.toContain("—");
  for (const word of ["pattern-absent", "guard", "deprecation sweep", "check kind"]) expect(guide.toLowerCase()).not.toContain(word);
});
