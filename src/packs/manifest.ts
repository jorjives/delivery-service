import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { InvalidPack, UnknownPack } from "../errors.js";
import { isEnoent } from "../journal.js";
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
      .array(z.strictObject({ id: Slug, title: Sentence, description: Sentence, /** Problems of this kind are fixed by changing a test: the fix may change an existing test, never delete or skip one. */ changesTests: z.literal(true).optional() }))
      .min(1)
      .refine((categories) => new Set(categories.map((category) => category.id)).size === categories.length, "must not name the same category twice"),
    maxFindings: z.int().min(1).max(200).default(40),
  }),
  /** What the agent fixing one of this pack's problems is told, beside the harness's own fixed instructions, and what the pack adds to the paths and markers a fix may not touch. Optional: the harness's own are enough. */
  fix: z
    .strictObject({ prompt: PackFile, testGlobs: z.array(GuardGlob).optional(), protectedGlobs: z.array(GuardGlob).optional(), skipMarkers: z.array(z.string().min(1)).optional() })
    .optional(),
  severity: z.strictObject({ low: Sentence, medium: Sentence, high: Sentence, critical: Sentence }),
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

/** Where the built-in packs are: `packs/` beside `src/` in a checkout, and beside `dist/` in the installed package. */
export const BUILT_IN_PACKS = fileURLToPath(new URL("../../packs/", import.meta.url));

async function readPackFile(dir: string, name: string): Promise<string> {
  const file = join(dir, name);
  try {
    return await readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) throw new InvalidPack(file, "is missing");
    throw err;
  }
}

/** Read and check the pack in `dir`. Refuses, naming the file and the field, anything the format does not allow. */
export async function loadPack(dir: string): Promise<Pack> {
  const manifestFile = join(dir, "pack.json");
  const raw = await readPackFile(dir, "pack.json");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InvalidPack(manifestFile, "is not valid JSON");
  }
  const parsed = PackManifest.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0);
    const where = issue === undefined || issue.path.length === 0 ? "the manifest" : `"${issue.path.join(".")}"`;
    throw new InvalidPack(manifestFile, `${where} ${issue?.message ?? "is not a valid pack"}`);
  }
  const scanInstructions = await readPackFile(dir, parsed.data.scan.prompt);
  const fixInstructions = parsed.data.fix === undefined ? undefined : await readPackFile(dir, parsed.data.fix.prompt);
  const hasher = createHash("sha256").update(raw).update("\0").update(scanInstructions);
  // A pack without fix instructions keeps the identity it had before they existed.
  if (fixInstructions !== undefined) hasher.update("\0").update(fixInstructions);
  return { dir, manifest: parsed.data, scanInstructions, ...(fixInstructions === undefined ? {} : { fixInstructions }), hash: hasher.digest("hex") };
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
