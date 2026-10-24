import { z } from "zod";
import { GuardName, Severity } from "../schema.js";
import { activeGuards, guardChanges } from "../task-guards.js";
import { isBuiltInPack, type Pack } from "./manifest.js";
import { wideningsOf } from "./widening.js";
import { PACK_SCHEMAS_READ, type PackWorkflow } from "./pack-format.js";

export const INSPECTION_SCHEMA = "delivery.pack-inspection/1";

const InstructionsSchema = z.object({ authored: z.string(), harness: z.string().nullable() });

const InspectedStep = z.object({
  name: z.string(),
  instructions: InstructionsSchema,
  guards: z.object({ added: z.array(GuardName), off: z.array(GuardName) }),
});

const InspectedWorkflow = z.object({
  name: z.string(),
  local: z.string(),
  kind: z.enum(["find", "act"]),
  summary: z.string().optional(),
  offers: z.array(z.string()).optional(),
  steps: z.array(InspectedStep),
  /** Guards the workflow gains on upgrade from an older format that its file does not state. */
  upgraded: z.array(GuardName),
  /** What the workflow does that the project's own would not: ways it widens what the agent may do. Empty when it widens nothing. */
  widens: z.array(z.string()),
  hold: Severity.nullable(),
});

/** What a pack will do when run, as the loader reads it: the same pack the engine runs, shown rather than run. */
export const Inspection = z.object({
  schema: z.literal(INSPECTION_SCHEMA),
  pack: z.object({
    name: z.string(),
    version: z.string(),
    title: z.string(),
    summary: z.string(),
    format: z.enum(PACK_SCHEMAS_READ),
    hash: z.string(),
    source: z.object({ kind: z.enum(["built-in", "folder"]), path: z.string() }),
  }),
  defaultGuards: z.array(GuardName),
  workflows: z.array(InspectedWorkflow),
});
export type Inspection = z.infer<typeof Inspection>;

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
  const base = { name, local, kind: workflow.kind, steps, upgraded: [...(pack.upgraded[local] ?? [])], widens: wideningsOf(config), hold: config.hold ?? null };
  if (workflow.kind === "find") return { ...base, offers: [...new Set(workflow.ideasFor)].map((act) => `${pack.manifest.name}:${act}`) };
  return workflow.summary === undefined ? base : { ...base, summary: workflow.summary };
}

/** The model of a loaded pack: its identity and fingerprint, the guards on by default, and every workflow as it will run. Pure: no I/O. */
export function inspectionOf(pack: Pack): Inspection {
  const { manifest } = pack;
  return {
    schema: INSPECTION_SCHEMA,
    pack: {
      name: manifest.name,
      version: manifest.version,
      title: manifest.title,
      summary: manifest.summary,
      format: pack.schema,
      hash: pack.hash,
      source: { kind: isBuiltInPack(pack.dir) ? "built-in" : "folder", path: pack.dir },
    },
    defaultGuards: [...activeGuards({}).on],
    workflows: Object.entries(manifest.workflows).map(([local, workflow]) => inspectedWorkflow(pack, local, workflow)),
  };
}
