import { expect, it } from "vitest";
import { builtInPacks } from "../packs/manifest.js";
import { inspectionOf, NO_PROJECT, type ProjectBaseline } from "../packs/inspection.js";
import { settingsPackOf } from "../packs/settings-fixtures.js";
import { annotated, settingsBlock } from "./packs-inspect-settings.js";
import { snippetLines } from "./pack-settings-render.js";
import { INSPECT_WIDTH, wrap } from "./text-wrap.js";

const TWO = { "docs-folder": { type: "path", summary: "The folder." }, topic: { type: "text", summary: "The topic.", default: "the API" } };
const TWO_FILES = { "look.md": "Read {{settings.docs-folder}}.", "fix.md": "Fix the page about {{settings.topic}}." };

const packs = await builtInPacks();
const deprecations = packs.find((pack) => pack.manifest.name === "deprecations");
if (!deprecations) throw new Error("the deprecations pack is not built in");

const read: ProjectBaseline = { found: true, path: ".", config: "read", gate: null, closer: null };

it("prints each setting with its type, default, value, source and what it changes", async () => {
  const i = inspectionOf(await settingsPackOf(TWO, TWO_FILES), NO_PROJECT, [], { "docs-folder": "handbook" });
  expect(settingsBlock(i, "delivery.config.json")).toEqual([
    "Settings (2)",
    "  docs-folder   path, required",
    "    The folder.",
    "    Your value: handbook (your configuration)",
    "    Changes: what the agent is told.",
    "  topic         text, default the API",
    "    The topic.",
    "    Your value: the API (default)",
    "    Changes: what the agent is told.",
    "  These change what the agent is told and when it waits.",
    "  They do not change your project's own check.",
  ]);
});

it("prints not set and the lines to add for an unset required setting", async () => {
  const i = inspectionOf(await settingsPackOf(TWO, TWO_FILES), NO_PROJECT, [], {});
  const lines = settingsBlock(i, "delivery.config.json");
  const notSet = wrap("Your value: not set. Required: this pack will not run until you give one.", "    ");
  const add = ["  Add this to delivery.config.json, replacing the dots:", ...snippetLines([{ pack: "docs", setting: "docs-folder" }])];
  const closing = ["  These change what the agent is told and when it waits.", "  They do not change your project's own check."];
  expect(lines.join("\n")).toContain(notSet.join("\n"));
  expect(lines.slice(-(add.length + closing.length))).toEqual([...add, ...closing]);
});

it.each<[ProjectBaseline, string]>([
  [NO_PROJECT, "No project found. Values shown are defaults."],
  [{ ...read, config: "code" }, "Your configuration is code, so its values were not read."],
  [{ ...read, config: "unreadable" }, "Your configuration could not be read. Values shown are defaults."],
  [read, "Values shown are the pack's defaults. This project does not use the pack."],
])("says why values are not read when the project is %#", async (project, sentence) => {
  const i = inspectionOf(await settingsPackOf(TWO, TWO_FILES), project, [], null);
  const lines = settingsBlock(i, "delivery.config.json");
  const reason = wrap(sentence, "  ");
  expect(lines.slice(1, 1 + reason.length)).toEqual(reason);
  expect(lines.some((line) => line.includes("Your value:"))).toBe(false);
});

it("says a pack with no settings has none, once", () => {
  const i = inspectionOf(deprecations, NO_PROJECT, [], null);
  expect(settingsBlock(i, "delivery.config.json")).toEqual(["Settings", "  This pack has no settings."]);
});

it("keeps within 60 columns with a long summary and a long default", async () => {
  const summary = Array.from({ length: 30 }, () => "word").join(" ");
  const fallback = Array.from({ length: 50 }, () => "ab").join(" ");
  const pack = await settingsPackOf({ topic: { type: "text", summary, default: fallback } }, { "look.md": "Read {{settings.topic}}.", "fix.md": "Fix." });
  const lines = settingsBlock(inspectionOf(pack, NO_PROJECT, [], null), "delivery.config.json");
  expect(lines.filter((line) => line.length > INSPECT_WIDTH)).toEqual([]);
});

it("fills each used value in front of its placeholder, and says not set when there is none", () => {
  const uses = [{ placeholder: "{{settings.a}}", setting: "a", value: "docs" }];
  expect(annotated("Read {{settings.a}} and {{settings.a}}.", uses)).toBe("Read docs [{{settings.a}}] and docs [{{settings.a}}].");
  expect(annotated("Read {{settings.a}} and {{settings.a}}.", [{ placeholder: "{{settings.a}}", setting: "a", value: null }])).toBe("Read [{{settings.a}}, not set] and [{{settings.a}}, not set].");
});
