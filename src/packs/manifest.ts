import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eachIssue, fieldOf, valueAt, type Issue } from "../schema-issues.js";
import { InvalidPack, UnknownPack } from "../errors.js";
import { isEnoent } from "../journal.js";
import type { WorkflowConfig } from "../cli/config.js";
import type { JsonSchema } from "../report/json-schema.js";
import { PACK_SCHEMA, PACK_SCHEMAS_READ, PackManifest, PackManifestV2, upgradeV2, type PackSchemaVersion } from "./pack-format.js";

export const scanWorkflowOf = (name: string): string => `${name}:scan`;

/** One act workflow a find's ideas may name, and what it is for, in the words the scanner is shown. */
export interface IdeaTarget {
  workflow: string;
  summary?: string;
}

/** The harness's half of every scan step: what an idea is and how its check is written. A pack only says what to look for. */
export function ideaFormat(targets: readonly [IdeaTarget, ...IdeaTarget[]]): string {
  return [
    "## What to hand back",
    "",
    "Change nothing in the project. For each problem you find, add one new file to `.delivery/backlog/`, named",
    "`<UTC timestamp>-<short-slug>.md` such as `20261019T170000Z-total-below-zero.md`, and nothing else. Each file is:",
    "",
    "```",
    "---",
    "status: idea",
    `workflow: ${targets[0].workflow}`,
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
    ...(targets.length > 1
      ? [
          "",
          "`workflow` says what is to be done about the problem. Name the one of these that fits it:",
          "",
          ...targets.map(({ workflow, summary }) => `- \`${workflow}\`: ${summary ?? ""}`),
        ]
      : []),
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

/** A loaded pack: where it is, the format it is written in, what it says, a hash of everything it holds, the find it runs, and its workflows. */
export interface Pack {
  dir: string;
  schema: PackSchemaVersion;
  manifest: PackManifest;
  hash: string;
  find: string;
  workflows: Record<string, WorkflowConfig>;
}

/**
 * The JSON Schema of `pack.json` as an author writes it: strict, so an editor flags a key the format
 * does not name or a guard it does not have while it is typed. What `delivery packs --schema` prints.
 */
export const packSchema = (): JsonSchema => ({ ...z.toJSONSchema(PackManifestV2, { io: "input" }), title: "delivery.pack/2" });

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

/** The text of a workflow's prompt, which the loader has read before any workflow is built from it. */
function promptText(texts: ReadonlyMap<string, string>, prompt: string): string {
  const text = texts.get(prompt);
  if (text === undefined) throw new Error(`the prompt ${prompt} was not read`);
  return text;
}

/** A non-empty array, as the format guarantees a find's `ideasFor` to be. */
function nonEmpty<T>(items: T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("expected at least one item");
  return [first, ...rest];
}

/**
 * The workflows a pack runs, each named `<pack>:<local>`, in manifest order, and the find among them. A
 * find is the workflow that scans for ideas; an act is the workflow that fixes one.
 */
function packWorkflows(manifest: PackManifest, texts: ReadonlyMap<string, string>): { find: string; workflows: Record<string, WorkflowConfig> } {
  const workflows: Record<string, WorkflowConfig> = {};
  let find = "";
  for (const [local, workflow] of Object.entries(manifest.workflows)) {
    const name = `${manifest.name}:${local}`;
    const text = promptText(texts, workflow.prompt);
    if (workflow.kind === "find") {
      // Until one find per pack is enforced, the first find named is the one that runs.
      if (find === "") find = name;
      const targets = nonEmpty(
        [...new Set(workflow.ideasFor)].map((act) => {
          const target = manifest.workflows[act];
          return { workflow: `${manifest.name}:${act}`, summary: target?.kind === "act" ? target.summary : undefined };
        }),
      );
      // A scan lands nothing but ideas, so the project's own after steps (a deploy) are not run for it.
      workflows[name] = { steps: [{ name: local, prompt: `${text.trim()}\n\n${ideaFormat(targets)}`, guards: { add: ["backlog-only"] } }], after: [] };
    } else {
      workflows[name] = {
        steps: [{ name: local, prompt: text.trim(), ...(workflow.guards === undefined ? {} : { guards: { add: workflow.guards.add } }) }],
        ...(workflow.hold === undefined ? {} : { hold: workflow.hold.atOrAbove }),
      };
    }
  }
  return { find, workflows };
}

/** The hash that names a pack's content: its raw manifest, then the text of each prompt, in the order given. */
function packHash(raw: string, texts: string[]): string {
  const hash = createHash("sha256").update(raw);
  for (const text of texts) hash.update("\0").update(text);
  return hash.digest("hex");
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
  // A manifest in a format this build does not read is refused with its own sentence and never read further: its keys mean something else.
  const declared = typeof json === "object" && json !== null ? (json as { schema?: unknown }).schema : undefined;
  if (declared !== undefined && !(PACK_SCHEMAS_READ as readonly unknown[]).includes(declared)) {
    return { ok: false, problems: [{ file: manifestFile, field: "schema", message: `"schema" is ${JSON.stringify(declared)}, but this harness reads ${PACK_SCHEMAS_READ.join(" and ")} (see docs/writing-a-pack.md)` }] };
  }
  let manifest: PackManifest;
  if (declared === "delivery.pack/2") {
    const v2 = PackManifestV2.safeParse(json);
    if (!v2.success) return { ok: false, problems: packProblems(manifestFile, v2.error, json) };
    manifest = upgradeV2(v2.data);
  } else {
    const v3 = PackManifest.safeParse(json);
    if (!v3.success) return { ok: false, problems: packProblems(manifestFile, v3.error, json) };
    manifest = v3.data;
  }
  const schema: PackSchemaVersion = declared === "delivery.pack/2" ? "delivery.pack/2" : PACK_SCHEMA;

  // Each prompt file is read once, however many workflows name it, and every missing one is named.
  const texts = new Map<string, string>();
  const problems: PackProblem[] = [];
  const seen = new Set<string>();
  for (const { prompt } of Object.values(manifest.workflows)) {
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    const text = await packFile(dir, prompt);
    if (typeof text === "string") texts.set(prompt, text);
    else problems.push(text);
  }
  if (problems.length > 0) return { ok: false, problems };

  const { find, workflows } = packWorkflows(manifest, texts);
  // A /2 pack hashes its prompts in the order it wrote them, scan then fix; a /3 pack in the sorted order of its workflow names.
  const inHashOrder = Object.entries(manifest.workflows);
  if (schema === PACK_SCHEMA) inHashOrder.sort(([a], [b]) => (a < b ? -1 : 1));
  const hash = packHash(raw, inHashOrder.map(([, workflow]) => promptText(texts, workflow.prompt)));
  return { ok: true, pack: { dir, schema, manifest, hash, find, workflows } };
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
