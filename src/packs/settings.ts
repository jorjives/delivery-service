import { Severity } from "../schema.js";
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
  /** Qualified names of the workflows whose authored prompt uses the setting, or whose act holds from it, in manifest order. */
  usedBy: readonly string[];
}

/** Where a setting's answer comes from; `unset` when neither the owner nor the pack gives one. */
export type ResolvedSource = "default" | "configuration" | "unset";

/** A declared setting with its one answer: what the agent would be told, where it came from and the workflows that use it. */
export interface ResolvedSetting {
  name: string;
  type: SettingType;
  summary: string;
  /** The default as the agent would be told it, or null when the pack gives none. */
  default: string | null;
  /** The value as the agent would be told it; null when unset, or when the owner's value is faulty. */
  value: string | null;
  source: ResolvedSource;
  /** Qualified names of the workflows whose authored prompt uses the setting, or whose act holds from it, in manifest order. */
  usedBy: readonly string[];
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
 * Resolves each declared setting to its one answer, and the problems the owner's values raise. Settings are in declaration
 * order; problems are the declared settings' first, then the undeclared names. Binding, the run and inspection all read this.
 */
export function resolveSettings(pack: Pack, values: Readonly<Record<string, unknown>> | undefined): { settings: ResolvedSetting[]; problems: SettingProblem[] } {
  const declarations = pack.manifest.settings ?? {};
  const given = values ?? {};
  const packName = pack.manifest.name;
  const settings: ResolvedSetting[] = [];
  const problems: SettingProblem[] = [];
  for (const [name, declaration] of Object.entries(declarations)) {
    const usedBy = Object.entries(pack.manifest.workflows)
      .filter(([local, workflow]) => {
        const told = pack.instructions[`${packName}:${local}`];
        const inPrompt = told !== undefined && settingNamesIn(told.authored).includes(name);
        return inPrompt || (workflow.kind === "act" && workflow.holdSetting === name);
      })
      .map(([local]) => `${packName}:${local}`);
    const described = {
      name,
      type: declaration.type,
      summary: declaration.summary,
      default: declaration.default === undefined ? null : renderSettingValue(declaration.default),
      usedBy,
    };
    const raw = boundRaw(declaration, name, given);
    if (raw === undefined) {
      problems.push({ kind: "missing", pack: packName, setting: name, summary: declaration.summary });
      settings.push({ ...described, value: null, source: "unset" });
      continue;
    }
    const source: ResolvedSource = Object.hasOwn(given, name) ? "configuration" : "default";
    const checked = settingValueSchema(declaration).safeParse(raw);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      problems.push({ kind: "invalid", pack: packName, setting: name, rule: issue?.message ?? "has a value the pack cannot use", value: issue === undefined ? raw : valueAt(raw, issue.path) });
      settings.push({ ...described, value: null, source });
      continue;
    }
    settings.push({ ...described, value: renderSettingValue(checked.data), source });
  }
  const names = Object.keys(declarations);
  for (const name of Object.keys(given)) {
    if (Object.hasOwn(declarations, name)) continue;
    problems.push({ kind: "undeclared", pack: packName, setting: name, declared: names });
  }
  return { settings, problems };
}

/**
 * Binds a pack to its owner's values. The value applied is the owner's, else the pack's default, else a problem. On
 * success the authored half of each prompt is rendered; the harness half, the fingerprint and the instructions are not.
 * Pure: a pack with no settings and no values is returned as it is.
 */
export function bindSettings(pack: Pack, values: Readonly<Record<string, unknown>> | undefined): { ok: true; pack: Pack } | { ok: false; problems: SettingProblem[] } {
  if (pack.manifest.settings === undefined && Object.keys(values ?? {}).length === 0) return { ok: true, pack };
  const { settings, problems } = resolveSettings(pack, values);
  if (problems.length > 0) return { ok: false, problems };

  const rendered: Record<string, string> = {};
  const applied: AppliedSetting[] = [];
  for (const setting of settings) {
    if (setting.value === null || setting.source === "unset") continue;
    rendered[setting.name] = setting.value;
    applied.push({ name: setting.name, type: setting.type, value: setting.value, source: setting.source, usedBy: setting.usedBy });
  }
  const workflows = { ...pack.workflows };
  for (const [name, told] of Object.entries(pack.instructions)) {
    const workflow = pack.workflows[name];
    const [step, ...more] = workflow?.steps ?? [];
    if (workflow === undefined || step === undefined) continue;
    const bound: Instructions = { ...told, authored: renderSettings(told.authored, rendered) };
    workflows[name] = { ...workflow, steps: [{ ...step, prompt: promptOf(bound) }, ...more] };
  }
  for (const [local, act] of Object.entries(pack.manifest.workflows)) {
    if (act.kind !== "act" || act.holdSetting === undefined) continue;
    const name = `${pack.manifest.name}:${local}`;
    const current = workflows[name];
    if (current === undefined) continue;
    workflows[name] = { ...current, hold: Severity.parse(rendered[act.holdSetting]) };
  }
  return { ok: true, pack: { ...pack, workflows, applied } };
}
