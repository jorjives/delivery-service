import { describe, it, expect } from "vitest";
import type { ActWorkflow, PackManifest, SettingDeclaration } from "./pack-format.js";
import { SETTINGS_MAX, settingRuleProblems } from "./setting-rules.js";

const FILE = "/p/pack.json";
const DIR = "/p";
const PATH: SettingDeclaration = { type: "path", summary: "A folder the agent reads" };
const SEVERITY: SettingDeclaration = { type: "severity", summary: "Changes this serious wait.", default: "high" };

const workflows: PackManifest["workflows"] = {
  look: { kind: "find", prompt: "look.md", ideasFor: ["fix"] },
  fix: { kind: "act", prompt: "fix.md" },
};

function manifestWith(settings?: Record<string, SettingDeclaration>): PackManifest {
  return {
    schema: "delivery.pack/3",
    name: "pack",
    version: "1.0.0",
    title: "Pack",
    summary: "A pack",
    workflows,
    ...(settings === undefined ? {} : { settings }),
  };
}

/** A pack whose act `fix` carries `keys` beside its prompt. */
function withActKeys(settings: Record<string, SettingDeclaration> | undefined, keys: Omit<ActWorkflow, "kind" | "prompt">): PackManifest {
  return { ...manifestWith(settings), workflows: { ...workflows, fix: { kind: "act", prompt: "fix.md", ...keys } } };
}

const withSettings = (settings: Record<string, SettingDeclaration>): PackManifest => manifestWith(settings);
const withoutSettings = (): PackManifest => manifestWith();
const texts = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));

const names33 = Array.from({ length: SETTINGS_MAX + 1 }, (_, i) => `setting-${i + 1}`);
const thirtyThree = Object.fromEntries(names33.map((name) => [name, PATH]));
const usesAll = (names: readonly string[]): string => names.map((name) => `{{settings.${name}}}`).join(" ");

describe("settingRuleProblems", () => {
  it("refuses a placeholder naming a setting the pack does not declare, listing the declared ones", () => {
    expect(settingRuleProblems(FILE, DIR, withSettings({ "docs-folder": PATH }), texts({ "look.md": "{{settings.docs-folder}}", "fix.md": "{{settings.docs-foldr}}" })))
      .toEqual([{ file: "/p/fix.md", field: null, message: "uses {{settings.docs-foldr}}, but pack.json declares no setting of that name. Declared: docs-folder" }]);
  });
  it("refuses a /3 prompt that uses {{settings. when the pack declares no settings", () => {
    expect(settingRuleProblems(FILE, DIR, withoutSettings(), texts({ "look.md": "Look.", "fix.md": "{{settings.x}}" })))
      .toEqual([{ file: "/p/fix.md", field: null, message: "uses {{settings.x}}, but pack.json declares no settings" }]);
  });
  it("refuses a malformed setting placeholder", () => {
    expect(settingRuleProblems(FILE, DIR, withSettings({ "docs-folder": PATH }), texts({ "look.md": "{{settings.docs-folder}}", "fix.md": "{{settings.Docs_Folder}}" })))
      .toEqual([{ file: "/p/fix.md", field: null, message: "uses {{settings.Docs_Folder}}, which is not a setting placeholder: a setting's name is lower-case letters, digits and dashes, as in {{settings.docs-folder}}" }]);
  });
  it("refuses a declared setting that no prompt uses", () => {
    expect(settingRuleProblems(FILE, DIR, withSettings({ "docs-folder": PATH, spare: PATH }), texts({ "look.md": "{{settings.docs-folder}}", "fix.md": "Fix." })))
      .toEqual([{ file: FILE, field: "settings.spare", message: '"settings.spare" is not used by any prompt: put {{settings.spare}} where the agent should be told it, or remove the setting' }]);
  });
  it("refuses more than 32 settings", () => {
    // 33 settings, every one used by look.md, so only the count rule fires.
    expect(settingRuleProblems(FILE, DIR, withSettings(thirtyThree), texts({ "look.md": usesAll(names33), "fix.md": "Fix." })))
      .toEqual([{ file: FILE, field: "settings", message: '"settings" declares 33 settings, but a pack may declare at most 32' }]);
  });
  it("reports every problem at once: count first, then unused settings in declaration order, then prompt problems in manifest prompt order", () => {
    // 33 settings with the last one unused; fix.md has a malformed placeholder then an undeclared name.
    const used = names33.slice(0, -1);
    expect(settingRuleProblems(FILE, DIR, withSettings(thirtyThree), texts({ "look.md": usesAll(used), "fix.md": "{{settings.Setting_1}} {{settings.nope}}" })))
      .toEqual([
        { file: FILE, field: "settings", message: '"settings" declares 33 settings, but a pack may declare at most 32' },
        { file: FILE, field: "settings.setting-33", message: '"settings.setting-33" is not used by any prompt: put {{settings.setting-33}} where the agent should be told it, or remove the setting' },
        { file: "/p/fix.md", field: null, message: "uses {{settings.Setting_1}}, which is not a setting placeholder: a setting's name is lower-case letters, digits and dashes, as in {{settings.docs-folder}}" },
        { file: "/p/fix.md", field: null, message: `uses {{settings.nope}}, but pack.json declares no setting of that name. Declared: ${names33.join(", ")}` },
      ]);
  });
  it("finds nothing for a pack with no settings and no {{settings.", () => {
    expect(settingRuleProblems(FILE, DIR, withoutSettings(), texts({ "look.md": "Look {{task.file}}.", "fix.md": "Fix." }))).toEqual([]);
  });
  it("counts a setting named by an act's holdSetting as used", () => {
    const m = withActKeys({ "hold-from": SEVERITY }, { holdSetting: "hold-from" });
    expect(settingRuleProblems(FILE, DIR, m, texts({ "look.md": "Look.", "fix.md": "Fix." }))).toEqual([]);
  });
  it("refuses hold and holdSetting on one act", () => {
    const m = withActKeys({ "hold-from": SEVERITY }, { hold: { atOrAbove: "high" }, holdSetting: "hold-from" });
    expect(settingRuleProblems(FILE, DIR, m, texts({ "look.md": "Look.", "fix.md": "Fix." }))).toEqual([
      { file: FILE, field: "workflows.fix.holdSetting", message: '"workflows.fix.holdSetting" cannot be used with "hold" on the same workflow: give the severity as the setting\'s default, and remove "hold"' },
    ]);
  });
  it("refuses a holdSetting naming a setting that is not a severity", () => {
    const m = withActKeys({ "docs-folder": PATH }, { holdSetting: "docs-folder" });
    expect(settingRuleProblems(FILE, DIR, m, texts({ "look.md": "{{settings.docs-folder}}", "fix.md": "Fix." }))).toEqual([
      { file: FILE, field: "workflows.fix.holdSetting", message: '"workflows.fix.holdSetting" is "docs-folder", a path setting: a hold must name a severity setting' },
    ]);
  });
  it("refuses a holdSetting naming no declared setting, listing the declared ones", () => {
    const m = withActKeys({ "hold-from": SEVERITY }, { holdSetting: "hold-frm" });
    expect(settingRuleProblems(FILE, DIR, m, texts({ "look.md": "Look.", "fix.md": "Fix." }))).toEqual([
      { file: FILE, field: "settings.hold-from", message: '"settings.hold-from" is not used by any prompt: put {{settings.hold-from}} where the agent should be told it, or remove the setting' },
      { file: FILE, field: "workflows.fix.holdSetting", message: '"workflows.fix.holdSetting" is "hold-frm", but pack.json declares no setting of that name. Declared: hold-from' },
    ]);
  });
  it("refuses a holdSetting in a pack that declares no settings", () => {
    const m = withActKeys(undefined, { holdSetting: "hold-from" });
    expect(settingRuleProblems(FILE, DIR, m, texts({ "look.md": "Look.", "fix.md": "Fix." }))).toEqual([
      { file: FILE, field: "workflows.fix.holdSetting", message: '"workflows.fix.holdSetting" is "hold-from", but pack.json declares no settings' },
    ]);
  });
});
