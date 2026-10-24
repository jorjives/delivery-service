import { z } from "zod";
import { GuardName, Severity } from "../schema.js";
import { activeGuards, guardChanges } from "../task-guards.js";
import { isBuiltInPack, type Pack } from "./manifest.js";
import { wideningsOf } from "./widening.js";
import { PACK_SCHEMAS_READ, type PackWorkflow } from "./pack-format.js";
import { FILE_ROLES, type PackFolderFile } from "./pack-folder.js";
import { Finding, findingsOf, HiddenCharacter, hiddenCharactersOf } from "./inspection-findings.js";

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

const InspectedStep = z.object({
  name: z.string(),
  instructions: InstructionsSchema,
  guards: z.object({ added: z.array(GuardName), off: z.array(GuardName) }),
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
    source: z.object({ kind: z.enum(["built-in", "folder"]), path: z.string() }),
    /** Every qualified workflow name, in manifest order. */
    workflows: z.array(z.string()),
  }),
  defaultGuards: z.array(GuardName),
  workflows: z.array(InspectedWorkflow),
  project: ProjectBaseline,
  files: z.array(z.object({ path: z.string(), role: z.enum(FILE_ROLES) })),
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

/** One workflow as it will run: its steps with their instructions and guard changes, and what a find offers or an act says it is for. */
function inspectedWorkflow(pack: Pack, local: string, workflow: PackWorkflow): z.infer<typeof InspectedWorkflow> {
  const name = `${pack.manifest.name}:${local}`;
  const config = pack.workflows[name];
  const instructions = pack.instructions[name];
  if (config === undefined || instructions === undefined) throw new Error(`the workflow ${name} was not built`);
  const steps = config.steps.map((step) => ({
    name: step.name,
    instructions,
    guards: guardChanges({}, step.guards) ?? { added: [], off: [] },
  }));
  const base = { name, local, kind: workflow.kind, summary: null, offers: null, steps, upgraded: [...(pack.upgraded[local] ?? [])], widens: wideningsOf(config), hold: config.hold ?? null };
  if (workflow.kind === "find") return { ...base, offers: [...new Set(workflow.ideasFor)].map((act) => `${pack.manifest.name}:${act}`) };
  return workflow.summary === undefined ? base : { ...base, summary: workflow.summary };
}

/** The model of a loaded pack: its identity and fingerprint, the guards on by default, every workflow as it will run, the project it is read in, the folder's files, and the findings. Pure: no I/O. */
export function inspectionOf(pack: Pack, project: ProjectBaseline, files: readonly PackFolderFile[]): Inspection {
  const { manifest } = pack;
  const workflows = Object.entries(manifest.workflows).map(([local, workflow]) => inspectedWorkflow(pack, local, workflow));
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
      source: { kind: isBuiltInPack(pack.dir) ? "built-in" : "folder", path: pack.dir },
      workflows: workflows.map(({ name }) => name),
    },
    defaultGuards: [...activeGuards({}).on],
    workflows,
    project,
    files: files.map(({ path, role }) => ({ path, role })),
  };
  return withFindings(base);
}
