import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eachIssue, fieldOf, valueAt, type Issue } from "../schema-issues.js";
import { InvalidPack, UnknownPack } from "../errors.js";
import { isEnoent } from "../journal.js";
import { Severity } from "./finding.js";
import { GuardGlob } from "./guards.js";

/** The version of the pack format this build reads. Additive-only within the major. */
export const PACK_SCHEMA = "delivery.pack/1";

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lower-case letters, digits and dashes");
const Sentence = z.string().trim().min(1, "must not be empty");
const PackFile = z.string().refine((file) => file !== "" && basename(file) === file, "must be the name of a file in the pack folder");

/**
 * A pack's manifest. Data only and strict: a key this format does not name is
 * refused, so a pack can never carry a tool list, code to run, or anything else
 * that would widen what a review's agent may do.
 */
export const PackManifest = z.strictObject({
  schema: z.literal(PACK_SCHEMA),
  name: Slug,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version such as 1.0.0"),
  title: Sentence,
  summary: Sentence,
  scan: z.strictObject({
    prompt: PackFile,
    categories: z
      .array(
        z.strictObject({
          id: Slug,
          title: Sentence,
          description: Sentence,
          /** Problems of this kind are fixed by changing a test: the fix may change an existing test, never delete or skip one. */
          changesTests: z.literal(true).optional(),
          /** Problems of this kind come from the reviewer's own knowledge, such as which library versions are unsafe, not from anything the harness looks up. */
          reviewerKnowledge: z.literal(true).optional(),
          /** A fix must clear the flagged text from the whole project: moving it to another file is not fixing it. */
          scope: z.literal("repo").optional(),
          /** The flagged text may hold a secret: every quoted value in it is treated as one and never shown. */
          sensitive: z.literal(true).optional(),
        }),
      )
      .min(1)
      .refine((categories) => new Set(categories.map((category) => category.id)).size === categories.length, "must not name the same category twice"),
    maxFindings: z.int().min(1).max(200).default(40),
    consequenceLabel: z.enum(["why-it-matters", "what-could-happen"]).default("why-it-matters"),
    /** Every problem must have a specific check: one with none is set aside for the owner's decision, in any project. */
    requireCheck: z.literal(true).optional(),
  }),
  /** What the agent fixing one of this pack's problems is told, beside the harness's own fixed instructions, and what the pack adds to the paths and markers a fix may not touch. Optional: the harness's own are enough. */
  fix: z
    .strictObject({ prompt: PackFile, testGlobs: z.array(GuardGlob).optional(), protectedGlobs: z.array(GuardGlob).optional(), skipMarkers: z.array(z.string().min(1)).optional() })
    .optional(),
  severity: z.strictObject({ low: Sentence, medium: Sentence, high: Sentence, critical: Sentence }),
  /** Fixes of problems at or above this severity wait for the owner's sign-off before they reach the main copy. Null, the default, holds nothing. */
  hold: z.strictObject({ atOrAbove: Severity.nullable() }).default({ atOrAbove: null }),
});
export type PackManifest = z.infer<typeof PackManifest>;

/** A loaded pack: where it is, what it says, the scanner's instructions, and a hash of both, so a review records exactly which pack it ran. */
export interface Pack {
  dir: string;
  manifest: PackManifest;
  scanInstructions: string;
  fixInstructions?: string;
  hash: string;
}

/** One thing wrong with a pack, as an author fixes it: the file (absolute), the field in it, and one plain sentence starting with that field. */
export interface PackProblem {
  file: string;
  field: string | null;
  message: string;
}

/** Why a key the format does not name is refused: the format is the whole of what a pack may say. */
export const DATA_ONLY =
  "is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check";

/** One sentence per issue, in the project configuration's manner: the field, then what is wrong, quoting the value and listing what is allowed. */
function describe(issue: Issue, raw: unknown): string {
  const field = fieldOf(issue);
  const where = field === null ? "the manifest" : `"${field}"`;
  if (issue.code === "unrecognized_keys") return `${where} ${DATA_ONLY}`;
  const value = valueAt(raw, issue.path);
  if (field !== null && value === undefined) return `${where} is missing`;
  if (issue.code === "invalid_value") {
    const allowed = issue.values.map(String).join(", ");
    return `${where} is ${JSON.stringify(value)} but the allowed values are: ${allowed}`;
  }
  return `${where} ${issue.message}`;
}

export function packProblems(file: string, error: z.ZodError, raw: unknown): PackProblem[] {
  return eachIssue(error).map((issue) => ({ file, field: fieldOf(issue), message: describe(issue, raw) }));
}

/** Where the built-in packs are: `packs/` beside `src/` in a checkout, and beside `dist/` in the installed package. */
export const BUILT_IN_PACKS = fileURLToPath(new URL("../../packs/", import.meta.url));

/** The text of a file in the pack, or the problem of its absence. */
async function packFile(dir: string, name: string): Promise<string | PackProblem> {
  const file = join(dir, name);
  try {
    return await readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return { file, field: null, message: "is missing" };
    throw err;
  }
}

/** Read and check the pack in `dir`, naming every problem with it by file and field rather than stopping at the first. */
export async function inspectPack(dir: string): Promise<{ ok: true; pack: Pack } | { ok: false; problems: PackProblem[] }> {
  const manifestFile = join(dir, "pack.json");
  const raw = await packFile(dir, "pack.json");
  if (typeof raw !== "string") return { ok: false, problems: [raw] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, problems: [{ file: manifestFile, field: null, message: "is not valid JSON" }] };
  }
  const parsed = PackManifest.safeParse(json);
  if (!parsed.success) return { ok: false, problems: packProblems(manifestFile, parsed.error, json) };
  const scanInstructions = await packFile(dir, parsed.data.scan.prompt);
  const fixInstructions = parsed.data.fix === undefined ? undefined : await packFile(dir, parsed.data.fix.prompt);
  const missing = [scanInstructions, fixInstructions].filter((text): text is PackProblem => text !== undefined && typeof text !== "string");
  if (missing.length > 0) return { ok: false, problems: missing };
  const hasher = createHash("sha256").update(raw).update("\0").update(scanInstructions as string);
  // A pack without fix instructions keeps the identity it had before they existed.
  if (fixInstructions !== undefined) hasher.update("\0").update(fixInstructions as string);
  return {
    ok: true,
    pack: { dir, manifest: parsed.data, scanInstructions: scanInstructions as string, ...(fixInstructions === undefined ? {} : { fixInstructions: fixInstructions as string }), hash: hasher.digest("hex") },
  };
}

/** Read and check the pack in `dir`. Refuses, naming the file and the field, the first thing the format does not allow. */
export async function loadPack(dir: string): Promise<Pack> {
  const inspected = await inspectPack(dir);
  if (inspected.ok) return inspected.pack;
  const [first] = inspected.problems;
  throw new InvalidPack(first?.file ?? join(dir, "pack.json"), first?.message ?? "is not a valid pack");
}

/** Every pack shipped with the harness, in folder order. */
export async function builtInPacks(): Promise<Pack[]> {
  const entries = await readdir(BUILT_IN_PACKS, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return Promise.all(folders.map((folder) => loadPack(join(BUILT_IN_PACKS, folder))));
}

/**
 * The pack `delivery review` was given: a path (anything with a slash, or
 * starting with a dot) is a folder, resolved from `cwd`; anything else is the
 * name of a built-in pack.
 */
export async function resolvePack(nameOrPath: string, cwd: string): Promise<Pack> {
  if (nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.startsWith(".")) return loadPack(resolve(cwd, nameOrPath));
  const packs = await builtInPacks();
  const found = packs.find((pack) => pack.manifest.name === nameOrPath);
  if (found === undefined) throw new UnknownPack(nameOrPath, packs.map((pack) => pack.manifest.name));
  return found;
}
