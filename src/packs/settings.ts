import { renderSettings, settingNamesIn } from "../placeholders.js";
import { promptOf, type Instructions, type Pack } from "./manifest.js";
import { renderSettingValue, settingValueSchema, type SettingType } from "./setting-types.js";

export type SettingSource = "default" | "configuration";

/** A setting as a pack was bound to it: its value as the agent is told it, where that came from, and the workflows whose prompts use it. */
export interface AppliedSetting {
  name: string;
  type: SettingType;
  value: string;
  source: SettingSource;
  /** Qualified names of the workflows whose authored prompt uses the setting, in manifest order. */
  usedBy: readonly string[];
}

/** One thing wrong with a pack's settings or the owner's values for them. The value is never part of the message. */
export interface SettingProblem {
  pack: string;
  setting: string;
  kind: "missing" | "undeclared" | "invalid";
  message: string;
}

const MISSING = "has no value, and the pack gives no default";

/**
 * Binds a pack to its owner's values. The value applied is the owner's, else the pack's default, else a problem. On
 * success the authored half of each prompt is rendered; the harness half, the fingerprint and the instructions are not.
 * Pure: a pack with no settings and no values is returned as it is.
 */
export function bindSettings(pack: Pack, values: Readonly<Record<string, unknown>> | undefined): { ok: true; pack: Pack } | { ok: false; problems: SettingProblem[] } {
  const declared = pack.manifest.settings;
  const given = values ?? {};
  if (declared === undefined && Object.keys(given).length === 0) return { ok: true, pack };
  const declarations = declared ?? {};
  const packName = pack.manifest.name;
  const problems: SettingProblem[] = [];
  const rendered: Record<string, string> = {};
  const sources: Record<string, SettingSource> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    const owned = Object.prototype.hasOwnProperty.call(given, name);
    const raw = owned ? given[name] : declaration.default;
    if (raw === undefined) {
      problems.push({ pack: packName, setting: name, kind: "missing", message: MISSING });
      continue;
    }
    const checked = settingValueSchema(declaration).safeParse(raw);
    if (!checked.success) {
      problems.push({ pack: packName, setting: name, kind: "invalid", message: checked.error.issues[0]?.message ?? "has a value the pack cannot use" });
      continue;
    }
    rendered[name] = renderSettingValue(checked.data);
    sources[name] = owned ? "configuration" : "default";
  }
  const names = Object.keys(declarations);
  for (const name of Object.keys(given)) {
    if (Object.prototype.hasOwnProperty.call(declarations, name)) continue;
    const message = names.length === 0 ? "is not a setting of this pack, which has no settings." : `is not a setting of this pack. Its settings are: ${names.join(", ")}.`;
    problems.push({ pack: packName, setting: name, kind: "undeclared", message });
  }
  if (problems.length > 0) return { ok: false, problems };

  const workflows = { ...pack.workflows };
  for (const [name, told] of Object.entries(pack.instructions)) {
    const workflow = pack.workflows[name];
    const [step, ...more] = workflow?.steps ?? [];
    if (workflow === undefined || step === undefined) continue;
    const bound: Instructions = { ...told, authored: renderSettings(told.authored, rendered) };
    workflows[name] = { ...workflow, steps: [{ ...step, prompt: promptOf(bound) }, ...more] };
  }
  const applied = Object.entries(declarations).map(([name, declaration]) => ({
    name,
    type: declaration.type,
    value: rendered[name] ?? "",
    source: sources[name] ?? "default",
    usedBy: Object.entries(pack.instructions)
      .filter(([, told]) => settingNamesIn(told.authored).includes(name))
      .map(([workflow]) => workflow),
  }));
  return { ok: true, pack: { ...pack, workflows, applied } };
}
