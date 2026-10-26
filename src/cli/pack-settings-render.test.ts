import { expect, it } from "vitest";
import {
  DEFAULT_CONFIG_NAME,
  ownerWords,
  settingsRefusal,
  shownValue,
  snippetLines,
} from "./pack-settings-render.js";
import {
  EMPTY,
  FORWARD_SLASHES,
  NOT_ABSOLUTE,
  NOT_PATH,
  NOT_PATHS,
  NOT_SEVERITY,
  NOT_TEXT,
  NO_BRACES,
  NO_GIT,
  NO_PARENT,
  ONE_LINE,
  PATHS_MAX,
  PATHS_MIN,
  PATHS_UNIQUE,
  TEXT_MAX,
  writtenAs,
} from "../packs/setting-types.js";

it("words one unset setting exactly as the spec shows", () => {
  expect(settingsRefusal([{ kind: "missing", pack: "docs-drift", setting: "docs-folder", summary: "The folder that holds your documentation." }], DEFAULT_CONFIG_NAME)).toBe([
    "Nothing can run yet: the pack docs-drift needs a setting you",
    "have not given.",
    "This stops every run in this project, not only docs-drift,",
    "so that a half-set-up project never starts.",
    "  docs-folder: the folder that holds your documentation.",
    "Add this to delivery.config.json, replacing the dots:",
    '  "packSettings": { "docs-drift": { "docs-folder": "..." } }',
    "Nothing was run.",
  ].join("\n"));
});

it("lists several unset settings of two packs together, one block per pack, with one snippet", () => {
  expect(settingsRefusal([
    { kind: "missing", pack: "docs-drift", setting: "docs-folder", summary: "The folder that holds your documentation." },
    { kind: "missing", pack: "docs-drift", setting: "hold-from", summary: "How many days a finding may wait." },
    { kind: "missing", pack: "deprecations", setting: "window", summary: "The window that counts as current." },
  ], DEFAULT_CONFIG_NAME)).toBe([
    "Nothing can run yet: 2 packs need settings you have not",
    "given.",
    "This stops every run in this project, not only those packs,",
    "so that a half-set-up project never starts.",
    "The pack docs-drift needs:",
    "  docs-folder: the folder that holds your documentation.",
    "  hold-from: how many days a finding may wait.",
    "The pack deprecations needs:",
    "  window: the window that counts as current.",
    "Add this to delivery.config.json, replacing the dots:",
    '  "packSettings": {',
    '    "docs-drift": {',
    '      "docs-folder": "...",',
    '      "hold-from": "..."',
    "    },",
    '    "deprecations": {',
    '      "window": "..."',
    "    }",
    "  }",
    "Nothing was run.",
  ].join("\n"));
});

it("words each packSettings fault with the value when it can be shown", () => {
  expect(settingsRefusal([
    { kind: "undeclared", pack: "docs-drift", setting: "docs-foler", declared: ["docs-folder", "hold-from"] },
    { kind: "invalid", pack: "docs-drift", setting: "hold-from", rule: NOT_SEVERITY, value: "urgent" },
    { kind: "invalid", pack: "docs-drift", setting: "docs-folder", rule: NOT_ABSOLUTE, value: "/etc" },
    { kind: "unknown-pack", pack: "linter", inUse: ["docs-drift", "deprecations"] },
  ], DEFAULT_CONFIG_NAME)).toBe([
    "delivery.config.json: packSettings",
    '  docs-drift: "docs-foler" is not a setting of this pack.',
    "    Its settings are: docs-folder, hold-from.",
    '  docs-drift.hold-from: "urgent" is not a severity.',
    "    Use one of: low, medium, high, critical.",
    '  docs-drift.docs-folder: "/etc" is not inside this project.',
    '    Give a folder inside the project, such as "docs".',
    "  linter: no pack called linter is used by this project.",
    "    Packs in use: docs-drift, deprecations.",
    "Nothing was run.",
  ].join("\n"));
});

it("puts the packSettings faults (the cause) before the unset settings", () => {
  expect(settingsRefusal([
    { kind: "undeclared", pack: "docs-drift", setting: "docs-foler", declared: ["docs-folder"] },
    { kind: "missing", pack: "docs-drift", setting: "docs-folder", summary: "The folder that holds your documentation." },
  ], DEFAULT_CONFIG_NAME)).toBe([
    "delivery.config.json: packSettings",
    '  docs-drift: "docs-foler" is not a setting of this pack.',
    "    Its settings are: docs-folder.",
    "Nothing can run yet: the pack docs-drift needs a setting you",
    "have not given.",
    "This stops every run in this project, not only docs-drift,",
    "so that a half-set-up project never starts.",
    "  docs-folder: the folder that holds your documentation.",
    "Add this to delivery.config.json, replacing the dots:",
    '  "packSettings": { "docs-drift": { "docs-folder": "..." } }',
    "Nothing was run.",
  ].join("\n"));
});

it("never prints a value with a hidden character, a line break or braces", () => {
  for (const value of ["a‮b", "a\nb", "{{task.x}}"]) {
    expect(settingsRefusal([{ kind: "invalid", pack: "p", setting: "s", rule: ONE_LINE, value }], DEFAULT_CONFIG_NAME)).not.toContain(value);
  }
});

it("says a pack with no settings has none", () => {
  expect(settingsRefusal([{ kind: "undeclared", pack: "linter", setting: "level", declared: [] }], DEFAULT_CONFIG_NAME)).toBe([
    "delivery.config.json: packSettings",
    '  linter: "level" is not a setting of this pack.',
    "    This pack has no settings.",
    "Nothing was run.",
  ].join("\n"));
});

it("has its own words for every value rule", () => {
  for (const rule of [NOT_SEVERITY, NOT_ABSOLUTE, NO_PARENT, NO_GIT, FORWARD_SLASHES, writtenAs("docs"), NOT_TEXT, NOT_PATH, NOT_PATHS, EMPTY, TEXT_MAX, ONE_LINE, NO_BRACES, PATHS_MIN, PATHS_MAX, PATHS_UNIQUE]) {
    expect(ownerWords(rule, "x").statement).not.toContain(rule);
  }
});

it("keeps every line within 60 columns and free of safe, valid and verified", () => {
  const outputs = [
    settingsRefusal([{ kind: "missing", pack: "docs-drift", setting: "docs-folder", summary: "The folder that holds your documentation." }], DEFAULT_CONFIG_NAME),
    settingsRefusal([
      { kind: "missing", pack: "docs-drift", setting: "docs-folder", summary: "The folder that holds your documentation." },
      { kind: "missing", pack: "docs-drift", setting: "hold-from", summary: "How many days a finding may wait." },
      { kind: "missing", pack: "deprecations", setting: "window", summary: "The window that counts as current." },
    ], DEFAULT_CONFIG_NAME),
    settingsRefusal([
      { kind: "undeclared", pack: "docs-drift", setting: "docs-foler", declared: ["docs-folder", "hold-from"] },
      { kind: "invalid", pack: "docs-drift", setting: "hold-from", rule: NOT_SEVERITY, value: "urgent" },
      { kind: "invalid", pack: "docs-drift", setting: "docs-folder", rule: NOT_ABSOLUTE, value: "/etc" },
      { kind: "unknown-pack", pack: "linter", inUse: ["docs-drift", "deprecations"] },
    ], DEFAULT_CONFIG_NAME),
  ];
  for (const output of outputs) {
    for (const line of output.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toMatch(/\b(safe|valid|verified)\b/);
    }
  }
});

it("shows a printable string, number or boolean as JSON, and nothing else", () => {
  expect(shownValue("urgent")).toBe('"urgent"');
  expect(shownValue(7)).toBe("7");
  expect(shownValue(false)).toBe("false");
  expect(shownValue("a‮b")).toBeNull();
  expect(shownValue("a\nb")).toBeNull();
  expect(shownValue("{{task.x}}")).toBeNull();
  expect(shownValue("x".repeat(41))).toBeNull();
  expect(shownValue(["docs"])).toBeNull();
  expect(shownValue(undefined)).toBeNull();
});

it("starts a statement with The value when the value cannot be shown", () => {
  expect(ownerWords(NOT_SEVERITY, "a\nb").statement).toBe("The value is not a severity.");
});

it("prints no remedy for a rule it does not know", () => {
  expect(ownerWords("has a value the pack cannot use", "x")).toEqual({
    statement: "The value cannot be used: it has a value the pack cannot use.",
    remedy: "",
  });
});

it("writes the snippet on one line when it fits in 60 columns, and expanded otherwise", () => {
  expect(snippetLines([{ pack: "docs-drift", setting: "docs-folder" }])).toEqual([
    '  "packSettings": { "docs-drift": { "docs-folder": "..." } }',
  ]);
});
