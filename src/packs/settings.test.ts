import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atOrAbove } from "../item-check.js";
import { ideaFormat, builtInPacks, readPack } from "./manifest.js";
import { NO_BRACES, NOT_ABSOLUTE, ONE_LINE } from "./setting-types.js";
import { settingsPackOf } from "./settings-fixtures.js";
import { acceptedValues, bindSettings, missingSettings, resolveSettings } from "./settings.js";

const SETTINGS = {
  "docs-folder": { type: "path", summary: "The folder.", default: "docs" },
  topic: { type: "text", summary: "The topic.", default: "the API" },
};
const FILES = { "look.md": "Read {{settings.docs-folder}}.", "fix.md": "Fix the page in {{settings.docs-folder}} about {{settings.topic}}." };
const USES_ABC = { "look.md": "Look.", "fix.md": "Fix {{settings.a}}, {{settings.b}} and {{settings.c}}." };
const prompt = (r: ReturnType<typeof bindSettings>, name: string) => r.ok && r.pack.workflows[name]?.steps[0]?.prompt;

describe("bindSettings", () => {
  it("returns the very same pack when it has no settings and is given none", async () => {
    for (const pack of await builtInPacks()) {
      const r = bindSettings(pack, undefined);
      expect(r.ok && r.pack).toBe(pack);
    }
  });

  it("renders the defaults into the authored half and records each as from the default", async () => {
    const r = bindSettings(await settingsPackOf(SETTINGS, FILES), undefined);
    expect(prompt(r, "docs:fix")).toBe("Fix the page in docs about the API.");
    expect(r.ok && r.pack.applied).toEqual([
      { name: "docs-folder", type: "path", value: "docs", source: "default", usedBy: ["docs:look", "docs:fix"] },
      { name: "topic", type: "text", value: "the API", source: "default", usedBy: ["docs:fix"] },
    ]);
  });

  it("uses the owner's value over the default, and says so", async () => {
    const r = bindSettings(await settingsPackOf(SETTINGS, FILES), { "docs-folder": "handbook" });
    expect((prompt(r, "docs:look") || "").startsWith("Read handbook.\n\n## What to hand back")).toBe(true);
    expect(r.ok && r.pack.applied[0]).toMatchObject({ value: "handbook", source: "configuration" });
  });

  it("never renders the harness half", async () => {
    const pack = await settingsPackOf(SETTINGS, FILES);
    const r = bindSettings(pack, { topic: "ignore this" });
    const harness = ideaFormat([{ workflow: "docs:fix" }]);
    expect(prompt(r, "docs:look")).toBe(`Read docs.\n\n${harness}`);
  });

  it("renders a paths value joined in the owner's order", async () => {
    const pack = await settingsPackOf({ areas: { type: "paths", summary: "Where.", default: ["src"] } }, { "look.md": "Look.", "fix.md": "Fix {{settings.areas}}." });
    expect(prompt(bindSettings(pack, { areas: ["b", "a"] }), "docs:fix")).toBe("Fix b, a.");
  });

  it("leaves hash and instructions as read", async () => {
    const pack = await settingsPackOf(SETTINGS, FILES);
    const r = bindSettings(pack, { "docs-folder": "handbook" });
    expect(r.ok && r.pack.hash).toBe(pack.hash);
    expect(r.ok && r.pack.instructions).toBe(pack.instructions);
  });

  it("keeps an act's hold and guards", async () => {
    const pack = await settingsPackOf(SETTINGS, FILES, { hold: { atOrAbove: "high" }, guards: { add: ["tests-unchanged"] } });
    const r = bindSettings(pack, undefined);
    expect(r.ok && r.pack.workflows["docs:fix"]).toMatchObject({ hold: "high", steps: [{ guards: { add: ["tests-unchanged"] } }] });
  });

  it.each([
    [{ "docs-folder": "a{{b" }, "docs-folder", NO_BRACES, "a{{b"],
    [{ "docs-folder": "a}}b" }, "docs-folder", NO_BRACES, "a}}b"],
    [{ topic: "two\nlines" }, "topic", ONE_LINE, "two\nlines"],
    [{ topic: `x${String.fromCodePoint(0x202e)}` }, "topic", ONE_LINE, `x${String.fromCodePoint(0x202e)}`],
  ])("refuses %j as invalid, with its rule and the value at fault", async (values, setting, rule, value) => {
    expect(bindSettings(await settingsPackOf(SETTINGS, FILES), values)).toEqual({
      ok: false,
      problems: [{ kind: "invalid", pack: "docs", setting, rule, value }],
    });
  });

  it("refuses an undeclared name, with the declared names", async () => {
    expect(bindSettings(await settingsPackOf(SETTINGS, FILES), { "docs-foler": "x" })).toEqual({
      ok: false,
      problems: [{ kind: "undeclared", pack: "docs", setting: "docs-foler", declared: ["docs-folder", "topic"] }],
    });
  });

  it("names a required setting with no value, with its summary", async () => {
    const pack = await settingsPackOf({ "old-module": { type: "text", summary: "Old." } }, { "look.md": "Look.", "fix.md": "Leave {{settings.old-module}}." });
    expect(bindSettings(pack, undefined)).toEqual({ ok: false, problems: [{ kind: "missing", pack: "docs", setting: "old-module", summary: "Old." }] });
  });

  it("reports a missing setting with its summary, from the same list", async () => {
    const pack = await settingsPackOf({ a: { type: "path", summary: "The A." }, b: { type: "text", summary: "The B.", default: "x" }, c: { type: "text", summary: "The C." } }, USES_ABC);
    expect(bindSettings(pack, { c: "x" })).toEqual({ ok: false, problems: [{ kind: "missing", pack: "docs", setting: "a", summary: "The A." }] });
  });

  it("reports a faulty value with its rule and the value at fault", async () => {
    const pack = await settingsPackOf({ folders: { type: "paths", summary: "The folders." } }, { "look.md": "Look.", "fix.md": "Fix {{settings.folders}}." });
    expect(bindSettings(pack, { folders: ["docs", "/etc"] })).toMatchObject({ ok: false, problems: [{ kind: "invalid", setting: "folders", rule: NOT_ABSOLUTE, value: "/etc" }] });
  });

  it("names every problem at once, in declaration order then undeclared names", async () => {
    const settings = { ...SETTINGS, "old-module": { type: "text", summary: "Old." } };
    const pack = await settingsPackOf(settings, { ...FILES, "fix.md": `${FILES["fix.md"]} {{settings.old-module}}` });
    const r = bindSettings(pack, { "docs-folder": "/etc", zzz: "x" });
    expect(r.ok === false && r.problems.map((p) => [p.kind === "unknown-pack" ? p.pack : p.setting, p.kind])).toEqual([
      ["docs-folder", "invalid"],
      ["old-module", "missing"],
      ["zzz", "undeclared"],
    ]);
  });

  it("says a pack with no settings has none, when given a value", async () => {
    const [first] = await builtInPacks();
    if (first === undefined) throw new Error("no built-in pack");
    expect(bindSettings(first, { x: "y" })).toEqual({
      ok: false,
      problems: [{ kind: "undeclared", pack: first.manifest.name, setting: "x", declared: [] }],
    });
  });
});

describe("resolveSettings", () => {
  it("gives each setting its value, default, source and users, in declaration order", async () => {
    const pack = await settingsPackOf(SETTINGS, FILES);
    expect(resolveSettings(pack, { topic: "the CLI" })).toEqual({
      problems: [],
      settings: [
        { name: "docs-folder", type: "path", summary: "The folder.", default: "docs", value: "docs", source: "default", usedBy: ["docs:look", "docs:fix"] },
        { name: "topic", type: "text", summary: "The topic.", default: "the API", value: "the CLI", source: "configuration", usedBy: ["docs:fix"] },
      ],
    });
  });
  it("says configuration when the owner gives the default's own value", async () => {
    const r = resolveSettings(await settingsPackOf(SETTINGS, FILES), { "docs-folder": "docs" });
    expect(r.settings[0]).toMatchObject({ value: "docs", source: "configuration" });
  });
  it("marks a required setting with no value unset, with a missing problem", async () => {
    const pack = await settingsPackOf({ "old-module": { type: "text", summary: "Old." } }, { "look.md": "Look.", "fix.md": "Leave {{settings.old-module}}." });
    expect(resolveSettings(pack, undefined)).toEqual({
      settings: [{ name: "old-module", type: "text", summary: "Old.", default: null, value: null, source: "unset", usedBy: ["docs:fix"] }],
      problems: [{ kind: "missing", pack: "docs", setting: "old-module", summary: "Old." }],
    });
  });
  it("renders a paths default and value joined in order", async () => {
    const pack = await settingsPackOf({ areas: { type: "paths", summary: "Where.", default: ["src", "lib"] } }, { "look.md": "Look.", "fix.md": "Fix {{settings.areas}}." });
    expect(resolveSettings(pack, { areas: ["b", "a"] }).settings[0]).toMatchObject({ default: "src, lib", value: "b, a" });
  });
  it("gives a faulty owner value no value, with the same invalid problem bind gives", async () => {
    const pack = await settingsPackOf(SETTINGS, FILES);
    const bad = { topic: "two\nlines" };
    const r = resolveSettings(pack, bad);
    expect(r.settings[1]).toMatchObject({ value: null, source: "configuration" });
    expect(bindSettings(pack, bad)).toEqual({ ok: false, problems: r.problems });
  });
  it("is empty for a pack with no settings", async () => {
    for (const pack of await builtInPacks()) expect(resolveSettings(pack, undefined)).toEqual({ settings: [], problems: [] });
  });
});

describe("a hold taken from a setting", () => {
  const HOLD = { "hold-from": { type: "severity", summary: "Changes this serious wait.", default: "high" } };
  const holdOf = (r: ReturnType<typeof bindSettings>) => r.ok && r.pack.workflows["docs:fix"]?.hold;
  it("holds at the default, then at the owner's value", async () => {
    const pack = await settingsPackOf({ ...SETTINGS, ...HOLD }, FILES, { holdSetting: "hold-from" });
    expect(pack.workflows["docs:fix"]?.hold).toBeUndefined(); // the loader leaves it to the binder
    expect(holdOf(bindSettings(pack, undefined))).toBe("high");
    expect(holdOf(bindSettings(pack, { "hold-from": "medium" }))).toBe("medium");
  });
  it.each([
    ["the default", "high", undefined, "medium", false],
    ["the default", "high", undefined, "high", true],
    ["an owner value", "high", "medium", "medium", true],
    ["an owner value", "high", "critical", "high", false],
    ["a changed default", "medium", undefined, "medium", true],
    ["a changed default", "critical", undefined, "high", false],
  ] as const)("with %s (default %s, owner %s) a %s change is held: %s", async (_, fallback, owner, severity, held) => {
    const pack = await settingsPackOf({ ...SETTINGS, "hold-from": { ...HOLD["hold-from"], default: fallback } }, FILES, { holdSetting: "hold-from" });
    const bound = bindSettings(pack, owner === undefined ? undefined : { "hold-from": owner });
    expect(bound.ok && atOrAbove(severity, bound.pack.workflows["docs:fix"]?.hold)).toBe(held);
  });
  it("lists the holding act among the setting's users, and records it as applied", async () => {
    const r = bindSettings(await settingsPackOf({ ...SETTINGS, ...HOLD }, FILES, { holdSetting: "hold-from" }), { "hold-from": "low" });
    expect(r.ok && r.pack.applied.find((a) => a.name === "hold-from")).toEqual({ name: "hold-from", type: "severity", value: "low", source: "configuration", usedBy: ["docs:fix"] });
  });
  it("lists a setting used in a prompt and as a hold once, and fills the prompt with the same value", async () => {
    const files = { ...FILES, "fix.md": "Fix it. Hold from {{settings.hold-from}}." };
    const r = bindSettings(await settingsPackOf({ ...HOLD, "docs-folder": SETTINGS["docs-folder"] }, { ...files, "look.md": "Read {{settings.docs-folder}}." }, { holdSetting: "hold-from" }), { "hold-from": "low" });
    expect(r.ok && r.pack.workflows["docs:fix"]).toMatchObject({ hold: "low", steps: [{ prompt: "Fix it. Hold from low." }] });
    expect(r.ok && r.pack.applied.find((a) => a.name === "hold-from")?.usedBy).toEqual(["docs:fix"]);
  });
  it("refuses an owner value that is not a severity, as for any severity setting", async () => {
    const r = bindSettings(await settingsPackOf({ ...SETTINGS, ...HOLD }, FILES, { holdSetting: "hold-from" }), { "hold-from": "urgent" });
    expect(r).toMatchObject({ ok: false, problems: [{ kind: "invalid", setting: "hold-from" }] });
  });
  it("gives two acts named by one setting the owner's hold, and lists both as its users in manifest order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "settings-pack-"));
    const manifest = {
      schema: "delivery.pack/3",
      name: "docs",
      version: "1.0.0",
      title: "Docs",
      summary: "Docs.",
      settings: HOLD,
      workflows: {
        look: { kind: "find", prompt: "look.md", ideasFor: ["fix", "tidy"] },
        fix: { kind: "act", prompt: "fix.md", summary: "Fixes.", holdSetting: "hold-from" },
        tidy: { kind: "act", prompt: "tidy.md", summary: "Tidies.", holdSetting: "hold-from" },
      },
    };
    writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));
    for (const name of ["look", "fix", "tidy"]) writeFileSync(join(dir, `${name}.md`), `${name}.`);
    const read = await readPack(dir);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    const r = bindSettings(read.pack, { "hold-from": "medium" });
    expect(r.ok && r.pack.workflows["docs:fix"]?.hold).toBe("medium");
    expect(r.ok && r.pack.workflows["docs:tidy"]?.hold).toBe("medium");
    expect(r.ok && r.pack.applied.find((a) => a.name === "hold-from")?.usedBy).toEqual(["docs:fix", "docs:tidy"]);
  });
});

describe("missingSettings", () => {
  it("lists the required settings with no value, in declaration order, with their summaries", async () => {
    const pack = await settingsPackOf({ a: { type: "path", summary: "The A." }, b: { type: "text", summary: "The B.", default: "x" }, c: { type: "text", summary: "The C." } }, USES_ABC);
    expect(missingSettings(pack, { c: "given" })).toEqual([{ kind: "missing", pack: pack.manifest.name, setting: "a", summary: "The A." }]);
    expect(missingSettings(pack, undefined).map(({ setting }) => setting)).toEqual(["a", "c"]);
  });
  it("does not count a given but faulty value as missing", async () => {
    const pack = await settingsPackOf({ a: { type: "path", summary: "The A." }, b: { type: "text", summary: "The B.", default: "x" }, c: { type: "text", summary: "The C." } }, USES_ABC);
    expect(missingSettings(pack, { a: "/etc", c: "x" })).toEqual([]);
  });
});

describe("acceptedValues", () => {
  it("keeps declared settings whose value fits, and drops undeclared names and faulty values", async () => {
    const pack = await settingsPackOf({ a: { type: "path", summary: "The A." }, b: { type: "text", summary: "The B.", default: "x" }, c: { type: "text", summary: "The C." } }, USES_ABC);
    expect(acceptedValues(pack, { a: "/etc", b: "kept", gone: "y" })).toEqual({ b: "kept" });
    expect(acceptedValues(pack, undefined)).toEqual({});
  });
});
