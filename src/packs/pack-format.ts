import { basename } from "node:path";
import { z } from "zod";
import { GuardName, Severity } from "../schema.js";
import type { JsonSchema } from "../report/json-schema.js";
import { hasHidden } from "./hidden-characters.js";

/** The versions of the pack format this build reads. `/2` is read, never written. */
export const PACK_SCHEMAS_READ = ["delivery.pack/2", "delivery.pack/3"] as const;
export type PackSchemaVersion = (typeof PACK_SCHEMAS_READ)[number];

/** The version of the pack format this build writes. Additive-only within the major. */
export const PACK_SCHEMA = "delivery.pack/3";

export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lower-case letters, digits and dashes");
const Sentence = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .refine((text) => !hasHidden(text), "must be one line of plain text, with no line break, tab or hidden character");
const PackFile = z.string().refine((file) => file !== "" && basename(file) === file, "must be the name of a file in the pack folder");
const Version = z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version such as 1.0.0");

/**
 * A pack's manifest as `delivery.pack/2` wrote it. Data only and strict: a key this format does not
 * name is refused. Kept byte for byte so the `/2` format it describes stays readable.
 */
export const PackManifestV2 = z.strictObject({
  /** Where an editor finds the schema to check this file against while it is written (`delivery packs --schema`). Ignored by the harness. */
  $schema: z.string().optional(),
  schema: z.literal("delivery.pack/2"),
  name: Slug,
  version: Version,
  title: Sentence,
  summary: Sentence,
  /** What the reviewing agent is told, beside the harness's own description of an idea. */
  scan: z.strictObject({ prompt: PackFile }),
  /** What the agent fixing one idea is told, and the guards its fix turns on beside `tests-unchanged`. */
  fix: z.strictObject({ prompt: PackFile, guards: z.strictObject({ add: z.array(GuardName).min(1) }).optional() }),
  /** Fixes of ideas rated this or more serious wait for the owner's sign-off. */
  hold: Severity.optional(),
});
export type PackManifestV2 = z.infer<typeof PackManifestV2>;

const FindWorkflow = z.strictObject({
  kind: z.literal("find"),
  prompt: PackFile,
  ideasFor: z.array(Slug).min(1, "must name at least one act workflow"),
});

const ActWorkflow = z.strictObject({
  kind: z.literal("act"),
  prompt: PackFile,
  summary: Sentence.optional(),
  guards: z.strictObject({ add: z.array(GuardName).min(1) }).optional(),
  hold: z.strictObject({ atOrAbove: Severity }).optional(),
});

/** One workflow a pack holds: a find that scans for ideas, or an act that fixes one. */
export const PackWorkflow = z.discriminatedUnion("kind", [FindWorkflow, ActWorkflow]);
export type FindWorkflow = z.infer<typeof FindWorkflow>;
export type ActWorkflow = z.infer<typeof ActWorkflow>;
export type PackWorkflow = z.infer<typeof PackWorkflow>;

/**
 * A pack's manifest as `delivery.pack/3` writes it. Data only and strict: a key this format does not
 * name is refused, so a pack can never carry a tool list, code to run, or anything else that would
 * widen what a review's agent may do.
 */
export const PackManifest = z.strictObject({
  /** Where an editor finds the schema to check this file against while it is written. Ignored by the harness. */
  $schema: z.string().optional(),
  schema: z.literal(PACK_SCHEMA),
  name: Slug,
  version: Version,
  title: Sentence,
  summary: Sentence,
  workflows: z.record(Slug, PackWorkflow),
});
export type PackManifest = z.infer<typeof PackManifest>;

/**
 * The JSON Schema of `pack.json` as an author writes it: strict, so an editor flags a key the format
 * does not name, or a guard it does not have, while it is typed. Describes `delivery.pack/3` only; what
 * `delivery packs --schema` prints.
 */
export const packSchema = (): JsonSchema => ({ ...z.toJSONSchema(PackManifest, { io: "input" }), title: PACK_SCHEMA });

/** The guards the upgrade adds to a `/2` pack's fix that its file does not state: `tests-unchanged`, unless the file names it too. */
export const upgradeGuards = (v2: PackManifestV2): GuardName[] => (v2.fix.guards?.add.includes("tests-unchanged") ? [] : ["tests-unchanged"]);

/** The same pack as `delivery.pack/3` means it: `scan` becomes a find offering `fix`, and `fix` an act. Pure and total. */
export function upgradeV2(v2: PackManifestV2): PackManifest {
  const fixAdd = [...upgradeGuards(v2), ...(v2.fix.guards?.add ?? [])];
  const workflows: Record<string, PackWorkflow> = {
    scan: { kind: "find", prompt: v2.scan.prompt, ideasFor: ["fix"] },
    fix: {
      kind: "act",
      prompt: v2.fix.prompt,
      guards: { add: fixAdd },
      ...(v2.hold === undefined ? {} : { hold: { atOrAbove: v2.hold } }),
    },
  };
  return { schema: PACK_SCHEMA, name: v2.name, version: v2.version, title: v2.title, summary: v2.summary, workflows };
}
