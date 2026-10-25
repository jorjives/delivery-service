import { z } from "zod";
import { GuardName, Severity } from "../schema.js";
import { activeGuards, guardChanges } from "../task-guards.js";
import { isBuiltInPack, promptOf, type Pack } from "./manifest.js";
import { wideningsOf } from "./widening.js";
import { resolveSettings, type ResolvedSetting } from "./settings.js";
import { SETTING_TYPES } from "./setting-types.js";
import { renderSettings, settingNamesIn } from "../placeholders.js";
import { PACK_SCHEMAS_READ, type PackWorkflow } from "./pack-format.js";
import { FILE_ROLES, type PackFolderFile } from "./pack-folder.js";
import { Finding, findingsOf, HiddenCharacter, hiddenCharactersOf } from "./inspection-findings.js";
import { openSchema, type JsonSchema } from "../report/json-schema.js";

export const INSPECTION_SCHEMA = "delivery.pack-inspection/1";

/** The check or the landing the project's own settings name, as the owner reads it. */
export const Selection = z.object({ source: z.literal("project"), type: z.string(), summary: z.string() });
export type Selection = z.infer<typeof Selection>;

/** The project a pack is inspected in: the check and landing that will judge and land its work, read from data only. */
export const ProjectBaseline = z.object({
  found: z.boolean(),
  /** The project's top folder, when one was found. */
  path: z.string().nullable(),
  /** How its settings were read: a JSON file, no file (the defaults), a JavaScript file this command does not run, or a file that could not be read. */
  config: z.enum(["read", "none", "code", "unreadable"]),
  gate: Selection.nullable(),
  closer: Selection.nullable(),
});
export type ProjectBaseline = z.infer<typeof ProjectBaseline>;
export const NO_PROJECT: ProjectBaseline = { found: false, path: null, config: "none", gate: null, closer: null };

const InstructionsSchema = z.object({ authored: z.string(), harness: z.string().nullable() });

/** Where the value a setting shows came from: the pack's default, the owner's configuration, nothing, or owner values that were not read. */
export const SETTING_SOURCES = ["default", "configuration", "unset", "not-read"] as const;

/** A setting as the owner reads it: what it asks, the value in effect, where that came from, and the workflows that use it. */
export const InspectedSetting = z.object({
  name: z.string(),
  type: z.enum(SETTING_TYPES),
  summary: z.string(),
  required: z.boolean(),
  default: z.string().nullable(),
  value: z.string().nullable(),
  source: z.enum(SETTING_SOURCES),
  usedBy: z.array(z.string()),
});
export type InspectedSetting = z.infer<typeof InspectedSetting>;

const InspectedStep = z.object({
  name: z.string(),
  instructions: InstructionsSchema,
  guards: z.object({ added: z.array(GuardName), off: z.array(GuardName) }),
  /** The prompt as the agent is given it, with the settings it uses filled in; null when one of them has no value. */
  given: z.string().nullable(),
  /** The settings the step's authored prompt uses, in first-use order, with the value each would fill in. */
  uses: z.array(z.object({ placeholder: z.string(), setting: z.string(), value: z.string().nullable() })),
});

export const InspectedWorkflow = z.object({
  name: z.string(),
  local: z.string(),
  kind: z.enum(["find", "act"]),
  summary: z.string().nullable(),
  offers: z.array(z.string()).nullable(),
  steps: z.array(InspectedStep),
  /** Guards the workflow gains on upgrade from an older format that its file does not state. */
  upgraded: z.array(GuardName),
  /** What the workflow does that the project's own would not: ways it widens what the agent may do. Empty when it widens nothing. */
  widens: z.array(z.string()),
  hold: Severity.nullable(),
});
export type InspectedWorkflow = z.infer<typeof InspectedWorkflow>;

/** What a pack will do when run, as the loader reads it: the same pack the engine runs, shown rather than run. */
export const Inspection = z.object({
  schema: z.literal(INSPECTION_SCHEMA),
  ok: z.literal(true),
  pack: z.object({
    name: z.string(),
    version: z.string(),
    title: z.string(),
    summary: z.string(),
    format: z.enum(PACK_SCHEMAS_READ),
    hash: z.string(),
    source: z.object({ kind: z.enum(["built-in", "folder", "installed"]), path: z.string(), package: z.object({ name: z.string(), version: z.string(), integrity: z.string() }).nullable() }),
    /** Every qualified workflow name, in manifest order. */
    workflows: z.array(z.string()),
  }),
  defaultGuards: z.array(GuardName),
  settings: z.array(InspectedSetting),
  workflows: z.array(InspectedWorkflow),
  project: ProjectBaseline,
  files: z.array(z.object({ path: z.string(), role: z.enum(FILE_ROLES), bytes: z.number().int().nonnegative().nullable() })),
  /** Whether any workflow widens what the agent may do: true exactly when a finding is a wider one. */
  widens: z.boolean(),
  findings: z.array(Finding),
  hiddenCharacters: z.array(HiddenCharacter),
});
export type Inspection = z.infer<typeof Inspection>;

/** An inspection before its findings are computed from it. */
export type InspectionBase = Omit<Inspection, "widens" | "findings" | "hiddenCharacters">;

/** The inspection with its findings, widening flag and hidden characters computed from the rest. Pure: no I/O. */
export function withFindings(base: InspectionBase): Inspection {
  const findings = findingsOf(base.workflows);
  return { ...base, widens: findings.some((finding) => finding.relation === "wider"), findings, hiddenCharacters: hiddenCharactersOf(base) };
}

/**
 * The settings as the owner reads them. With the owner's values, each one's answer is resolved as the run would resolve it;
 * with none read (null), each shows its default, marked not read. Values with a fault for this pack are the caller's to refuse.
 */
function inspectedSettings(pack: Pack, values: Readonly<Record<string, unknown>> | null): InspectedSetting[] {
  const shown = (setting: ResolvedSetting, value: string | null, source: InspectedSetting["source"]): InspectedSetting => ({
    name: setting.name,
    type: setting.type,
    summary: setting.summary,
    required: setting.default === null,
    default: setting.default,
    value,
    source,
    usedBy: [...setting.usedBy],
  });
  if (values === null) return resolveSettings(pack, {}).settings.map((setting) => shown(setting, setting.default, "not-read"));
  const { settings, problems } = resolveSettings(pack, values);
  if (problems.some((problem) => problem.kind === "invalid" || problem.kind === "undeclared")) throw new Error(`owner values for ${pack.manifest.name} must be checked before inspection`);
  return settings.map((setting) => shown(setting, setting.value, setting.source));
}

/** One workflow as it will run: its steps with their instructions, guard changes and prompt as given, and what a find offers or an act says it is for. */
function inspectedWorkflow(pack: Pack, local: string, workflow: PackWorkflow, settings: readonly InspectedSetting[]): z.infer<typeof InspectedWorkflow> {
  const name = `${pack.manifest.name}:${local}`;
  const config = pack.workflows[name];
  const instructions = pack.instructions[name];
  if (config === undefined || instructions === undefined) throw new Error(`the workflow ${name} was not built`);
  const valueOf = (setting: string): string | null => settings.find((shown) => shown.name === setting)?.value ?? null;
  const uses = settingNamesIn(instructions.authored).map((setting) => ({ placeholder: `{{settings.${setting}}}`, setting, value: valueOf(setting) }));
  const filled = Object.fromEntries(settings.flatMap((shown) => (shown.value === null ? [] : [[shown.name, shown.value]])));
  const given = uses.every((use) => use.value !== null) ? promptOf({ ...instructions, authored: renderSettings(instructions.authored, filled) }) : null;
  const steps = config.steps.map((step) => ({
    name: step.name,
    instructions,
    guards: guardChanges({}, step.guards) ?? { added: [], off: [] },
    given,
    uses,
  }));
  const base = { name, local, kind: workflow.kind, summary: null, offers: null, steps, upgraded: [...(pack.upgraded[local] ?? [])], widens: wideningsOf(config), hold: config.hold ?? null };
  if (workflow.kind === "find") return { ...base, offers: [...new Set(workflow.ideasFor)].map((act) => `${pack.manifest.name}:${act}`) };
  return workflow.summary === undefined ? base : { ...base, summary: workflow.summary };
}

/** Where the account says a pack came from: its folder, and for an added pack the npm package it was fetched from. */
function sourceOf(pack: Pack): Inspection["pack"]["source"] {
  const { origin } = pack;
  if (origin.kind === "installed") {
    return { kind: "installed", path: pack.dir, package: { name: origin.package, version: origin.version, integrity: origin.integrity } };
  }
  return { kind: isBuiltInPack(pack.dir) ? "built-in" : "folder", path: pack.dir, package: null };
}

/** The model of a loaded pack: its identity and fingerprint, the guards on by default, its settings and their values, every workflow as it will run, the project it is read in, the folder's files, and the findings. Pure: no I/O. */
export function inspectionOf(pack: Pack, project: ProjectBaseline, files: readonly PackFolderFile[], values: Readonly<Record<string, unknown>> | null): Inspection {
  const { manifest } = pack;
  const settings = inspectedSettings(pack, values);
  const workflows = Object.entries(manifest.workflows).map(([local, workflow]) => inspectedWorkflow(pack, local, workflow, settings));
  const base: InspectionBase = {
    schema: INSPECTION_SCHEMA,
    ok: true,
    pack: {
      name: manifest.name,
      version: manifest.version,
      title: manifest.title,
      summary: manifest.summary,
      format: pack.schema,
      hash: pack.hash,
      source: sourceOf(pack),
      workflows: workflows.map(({ name }) => name),
    },
    defaultGuards: [...activeGuards({}).on],
    settings,
    workflows,
    project,
    files: files.map(({ path, role, bytes }) => ({ path, role, bytes })),
  };
  return withFindings(base);
}

/** The inspection narrowed to one workflow, named by its local or qualified name; null when the pack has no such workflow. The pack, the project and the pack-wide flags are kept whole. Pure: a filter over the finished model. */
export function narrowedTo(inspection: Inspection, name: string): Inspection | null {
  const workflow = inspection.workflows.find((shown) => shown.local === name || shown.name === name);
  if (workflow === undefined) return null;
  const ofWorkflow = (item: { workflow: string | null }): boolean => item.workflow === null || item.workflow === workflow.name;
  return { ...inspection, workflows: [workflow], findings: inspection.findings.filter(ofWorkflow), hiddenCharacters: inspection.hiddenCharacters.filter(ofWorkflow) };
}

/** A file or field the inspection could not read, as the owner is told it: a pack problem, with its file named. */
export const InspectionProblem = z.object({ file: z.string().nullable(), field: z.string().nullable(), message: z.string() });
export type InspectionProblem = z.infer<typeof InspectionProblem>;

/** The document of a pack that cannot be inspected: no account, only why. */
export const InspectionRefusal = z.object({ schema: z.literal(INSPECTION_SCHEMA), ok: z.literal(false), problems: z.array(InspectionProblem) });
export type InspectionRefusal = z.infer<typeof InspectionRefusal>;

export function inspectionRefusal(problems: readonly InspectionProblem[]): InspectionRefusal {
  return { schema: INSPECTION_SCHEMA, ok: false, problems: [...problems] };
}

/** The published schema of the inspection document: either an account or a refusal, under the version it names itself by. */
export function inspectionSchema(): JsonSchema {
  return { ...openSchema(z.union([Inspection, InspectionRefusal])), title: INSPECTION_SCHEMA };
}
