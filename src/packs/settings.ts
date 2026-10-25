import { renderSettings, settingNamesIn } from "../placeholders.js";
import { valueAt } from "../schema-issues.js";
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

/** A required setting the owner has not given, with the summary the pack gives it. */
export interface UnmetSetting {
  setting: string;
  summary: string;
}

/** One thing wrong with a pack's settings or the owner's values for them, as data: the words are the renderer's. */
export type SettingProblem =
  | { kind: "missing"; pack: string; setting: string; summary: string }
  | { kind: "undeclared"; pack: string; setting: string; declared: readonly string[] }
  | { kind: "invalid"; pack: string; setting: string; rule: string; value: unknown }
  | { kind: "unknown-pack"; pack: string; inUse: readonly string[] };

/** The value a setting is bound to: the owner's when given, else the pack's default. Undefined when neither holds. */
function boundRaw(declaration: { default?: unknown }, name: string, given: Readonly<Record<string, unknown>>): unknown {
  return Object.hasOwn(given, name) ? given[name] : declaration.default;
}

/**
 * The required settings a pack has no value for, the owner's or its own default: the one list every surface names them from.
 * A value that is given but faulty is not unmet; it is a problem of its own.
 */
export function unmetSettings(pack: Pack, values: Readonly<Record<string, unknown>> | undefined): UnmetSetting[] {
  const given = values ?? {};
  return Object.entries(pack.manifest.settings ?? {})
    .filter(([name, declaration]) => boundRaw(declaration, name, given) === undefined)
    .map(([setting, declaration]) => ({ setting, summary: declaration.summary }));
}

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
  const unmet = new Map(unmetSettings(pack, values).map((entry) => [entry.setting, entry]));
  const problems: SettingProblem[] = [];
  const rendered: Record<string, string> = {};
  const sources: Record<string, SettingSource> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    const missing = unmet.get(name);
    if (missing !== undefined) {
      problems.push({ kind: "missing", pack: packName, setting: name, summary: missing.summary });
      continue;
    }
    const raw = boundRaw(declaration, name, given);
    const checked = settingValueSchema(declaration).safeParse(raw);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      problems.push({ kind: "invalid", pack: packName, setting: name, rule: issue?.message ?? "has a value the pack cannot use", value: issue === undefined ? raw : valueAt(raw, issue.path) });
      continue;
    }
    rendered[name] = renderSettingValue(checked.data);
    sources[name] = Object.hasOwn(given, name) ? "configuration" : "default";
  }
  const names = Object.keys(declarations);
  for (const name of Object.keys(given)) {
    if (Object.hasOwn(declarations, name)) continue;
    problems.push({ kind: "undeclared", pack: packName, setting: name, declared: names });
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
