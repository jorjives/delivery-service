import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eachIssue, fieldOf, valueAt, type Issue } from "../schema-issues.js";
import { InvalidPack, UnknownPack } from "../errors.js";
import { isEnoent } from "../journal.js";
import { GuardName, Severity } from "../schema.js";
import type { WorkflowConfig } from "../cli/config.js";
import type { JsonSchema } from "../report/json-schema.js";

/** The version of the pack format this build reads. Additive-only within the major. */
export const PACK_SCHEMA = "delivery.pack/2";

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be lower-case letters, digits and dashes");
const Sentence = z.string().trim().min(1, "must not be empty");
const PackFile = z.string().refine((file) => file !== "" && basename(file) === file, "must be the name of a file in the pack folder");

/**
 * A pack's manifest. Data only and strict: a key this format does not name is
 * refused, so a pack can never carry a tool list, code to run, or anything else
 * that would widen what a review's agent may do.
 */
export const PackManifest = z.strictObject({
  /** Where an editor finds the schema to check this file against while it is written (`delivery packs --schema`). Ignored by the harness. */
  $schema: z.string().optional(),
  schema: z.literal(PACK_SCHEMA),
  name: Slug,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version such as 1.0.0"),
  title: Sentence,
  summary: Sentence,
  /** What the reviewing agent is told, beside the harness's own description of an idea. */
  scan: z.strictObject({ prompt: PackFile }),
  /** What the agent fixing one idea is told, and the guards its fix turns on beside `tests-unchanged`. */
  fix: z.strictObject({ prompt: PackFile, guards: z.strictObject({ add: z.array(GuardName).min(1) }).optional() }),
  /** Fixes of ideas rated this or more serious wait for the owner's sign-off. */
  hold: Severity.optional(),
});
export type PackManifest = z.infer<typeof PackManifest>;

export const scanWorkflowOf = (name: string): string => `${name}:scan`;
export const fixWorkflowOf = (name: string): string => `${name}:fix`;

/** The harness's half of every scan step: what an idea is and how its check is written. A pack only says what to look for. */
export function ideaFormat(fixWorkflow: string): string {
  return [
    "## What to hand back",
    "",
    "Change nothing in the project. For each problem you find, add one new file to `.delivery/backlog/`, named",
    "`<UTC timestamp>-<short-slug>.md` such as `20261019T170000Z-total-below-zero.md`, and nothing else. Each file is:",
    "",
    "```",
    "---",
    "status: idea",
    `workflow: ${fixWorkflow}`,
    "severity: high",
    "check:",
    "  kind: anchor-gone",
    "  path: src/checkout.js",
    '  anchor: "return price - discount;"',
    "---",
    "# One plain sentence naming the problem",
    "",
    "What is wrong, in words the owner, who is not technical, can follow.",
    "",
    "## Why it matters",
    "",
    "## What fixed looks like",
    "",
    "## For engineers",
    "",
    "Anything technical: the lines, the cause, a suggested fix.",
    "```",
    "",
    "`severity` is one of critical, high, medium or low. The check is how the harness will know the problem is gone, and",
    "it must find the problem in the project as it stands now, or the idea is refused:",
    "",
    "- `anchor-gone`: `path` is the file and `anchor` the flagged code, copied exactly, at most five lines. For a password,",
    "  key or token add `scope: repo` and `sensitive: true`: it is then looked for across the whole project.",
    "- `pattern-absent`: `pattern` is an extended regular expression matching the problem, and `paths` the files it must",
    "  no longer match in. Use it only for a problem that could come back in other places.",
    "- `dependency-absent`: `package` and `version` exactly as `package-lock.json` installs them.",
    "",
    "Prefer fewer, certain problems to many guesses, and write no more than 40.",
  ].join("\n");
}

/** A loaded pack: where it is, what it says, a hash of everything it holds, and the two workflows it is. */
export interface Pack {
  dir: string;
  manifest: PackManifest;
  hash: string;
  workflows: Record<string, WorkflowConfig>;
}

/**
 * The JSON Schema of `pack.json` as an author writes it: strict, so an editor flags a key the format
 * does not name or a guard it does not have while it is typed. What `delivery packs --schema` prints.
 */
export const packSchema = (): JsonSchema => ({ ...z.toJSONSchema(PackManifest, { io: "input" }), title: PACK_SCHEMA });

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
  // A manifest in another format is refused with its own sentence and never read further: its keys mean something else.
  const schema = typeof json === "object" && json !== null ? (json as { schema?: unknown }).schema : undefined;
  if (schema !== undefined && schema !== PACK_SCHEMA) {
    return { ok: false, problems: [{ file: manifestFile, field: "schema", message: `"schema" is ${JSON.stringify(schema)}, but this harness reads only ${PACK_SCHEMA}: packs are now a scan workflow and a fix workflow over the backlog (see docs/writing-a-pack.md)` }] };
  }
  const parsed = PackManifest.safeParse(json);
  if (!parsed.success) return { ok: false, problems: packProblems(manifestFile, parsed.error, json) };
  const manifest = parsed.data;
  const [scanText, fixText] = await Promise.all([packFile(dir, manifest.scan.prompt), packFile(dir, manifest.fix.prompt)]);
  if (typeof scanText !== "string" || typeof fixText !== "string") return { ok: false, problems: [scanText, fixText].filter((t): t is PackProblem => typeof t !== "string") };
  const fix = fixWorkflowOf(manifest.name);
  const workflows: Record<string, WorkflowConfig> = {
    // A scan lands nothing but ideas, so the project's own after steps (a deploy) are not run for it.
    [scanWorkflowOf(manifest.name)]: { steps: [{ name: "scan", prompt: `${scanText.trim()}\n\n${ideaFormat(fix)}`, guards: { add: ["backlog-only"] } }], after: [] },
    [fix]: {
      steps: [{ name: "fix", prompt: fixText.trim(), guards: { add: [...new Set<GuardName>(["tests-unchanged", ...(manifest.fix.guards?.add ?? [])])] } }],
      ...(manifest.hold === undefined ? {} : { hold: manifest.hold }),
    },
  };
  const hash = createHash("sha256").update(raw).update("\0").update(scanText).update("\0").update(fixText).digest("hex");
  return { ok: true, pack: { dir, manifest, hash, workflows } };
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
