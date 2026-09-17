import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { messageOf } from "../gate-support.js";
import { CloserRef, GateRef, TaskDef } from "../schema.js";
import { EXIT, Refusal } from "./failures.js";

/** The one filename family a project uses, and the forms it may take. A `.js` or `.mjs` file exports the same object, for a project that computes a value. */
export const CONFIG_BASENAME = "delivery.config";
export const CONFIG_EXTENSIONS = [".json", ".js", ".mjs"] as const;

/** The five keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `domain`, `gate`, `closer` and `budgets`";

/** The closer types a person can name without a module path of their own, from the library's own list so the two can never disagree. */
export const BUILT_IN_CLOSERS: string[] = CloserRef.options
  .map((option) => option.shape.type.value)
  .filter((type) => type !== "custom");

/** A closer type the harness does not know, answered with the choices rather than with a schema complaint. */
export function unknownCloser(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the closer type \`${type}\`` : "that closer type";
  const quoted = BUILT_IN_CLOSERS.map((choice) => `\`${choice}\``);
  const choices = `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
  return (
    `I don't know ${named}. The built-in choices are ${choices}. ` +
    `To use your own, put \`{ "type": "custom", "modulePath": "./closers/mine.js" }\` in ${CONFIG_BASENAME}.json.`
  );
}

/**
 * Caps only, one per attempt category, each optional and merged over the
 * default set. `used` is never here: usage is counted from the run's own log,
 * so a config file that could set it could lie about what a run had spent.
 */
export const Budgets = z
  .object({
    correction: z.number().int().positive(),
    gateError: z.number().int().positive(),
    gateMaintenance: z.number().int().positive(),
    terminus: z.number().int().positive(),
    close: z.number().int().positive(),
  })
  .partial()
  .strict();
export type Budgets = z.infer<typeof Budgets>;

/**
 * Something a person wrote, in their own words. Whitespace alone is nothing
 * written, so it is refused here rather than pinned into a run and sent to an
 * agent as a blank line. The text is kept exactly as typed: it is prose, and
 * trimming it would edit the owner's words.
 */
const Prose = z.string().refine((text) => text.trim() !== "");

/**
 * The whole of a `delivery.config.json`. `task`, `gate` and `closer` are the
 * library's own schemas, composed rather than restated, so the file can never
 * drift from what the harness accepts. `.strict()` on both objects means a typo
 * is named rather than silently ignored.
 */
export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),
    // What this project is, in the owner's own words, sent to every agent on
    // every run of it. One string at both altitudes: a long one is written in
    // the `.js` form with a template literal, not in a file of its own.
    domain: Prose.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
  })
  .strict();
export type DeliveryConfig = z.infer<typeof DeliveryConfig>;

/** The value the file actually held at an issue's path, so a complaint can quote it back. */
function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let here: unknown = raw;
  for (const step of path) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
}

/**
 * One plain-language sentence about the first thing wrong with a config file,
 * naming the key or the value. The first issue is enough: a person fixes one
 * thing and runs again, and a list of schema complaints is the stack trace this
 * command exists to avoid.
 */
export function describeProblem(file: string, error: z.ZodError, raw: unknown): string {
  const issue = error.issues[0];
  if (!issue) return `I can't use ${file}.`;
  const where = issue.path.join(".");

  if (issue.code === "unrecognized_keys") {
    const takes = where === "" ? `A config file takes only ${CONFIG_KEYS}.` : `\`${where}\` doesn't take it.`;
    return `I can't use ${file}: there's no setting called \`${issue.keys[0]}\`. ${takes}`;
  }
  if (where === "closer.type") return unknownCloser(valueAt(raw, issue.path));
  // A string that is there but says nothing is the one mistake worth its own
  // sentence; anything else at this key is a value of the wrong kind, and the
  // general sentence below quotes it back.
  if (where === "domain" && typeof valueAt(raw, issue.path) === "string") {
    return `I can't use ${file}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.`;
  }
  if (issue.path[0] === "budgets" && issue.path.length > 1) {
    return (
      `I can't use ${file}: the limit \`${where}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ` +
      `A limit is a whole number of attempts, 1 or more.`
    );
  }
  return `I can't use ${file}: the setting \`${where || "(the file itself)"}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\` (${issue.message}).`;
}

export const NO_SUCH_CONFIG = (file: string): string =>
  `I couldn't find the config file \`${file}\`. Check the path, or leave it out and I'll look for a ${CONFIG_BASENAME}.json next to your code.`;

/** A real path, so a folder reached through a symlink still matches the repository root the walk stops at. */
function realOf(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/**
 * Every place a config file could be, nearest first: the folder the command was
 * run from and each folder above it, stopping at the repository root. Nothing
 * above the repository is considered, so one project's settings can never leak
 * into another's.
 */
export function configCandidates(startDir: string, repoPath: string): string[] {
  const paths: string[] = [];
  const top = realOf(repoPath);
  let dir = realOf(startDir);
  for (;;) {
    for (const extension of CONFIG_EXTENSIONS) paths.push(join(dir, CONFIG_BASENAME + extension));
    if (dir === top || dirname(dir) === dir) break;
    dir = dirname(dir);
  }
  return paths;
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, "utf-8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Refusal(`I can't read ${file}: it isn't valid JSON (${messageOf(err)}).`, EXIT.configuration);
  }
}

/**
 * The settings a run starts from: the file the user named, or the nearest one
 * at or above the folder they ran in, or nothing at all, which is not an error
 * because every setting has a default.
 */
export async function loadConfig({
  startDir,
  repoPath,
  flag,
  env,
}: {
  startDir: string;
  repoPath: string;
  flag: string | undefined;
  env: NodeJS.ProcessEnv;
}): Promise<DeliveryConfig> {
  // An empty DELIVERY_CONFIG is CI writing an input nobody filled in: not a
  // file called "", and not a reason to refuse before discovery has run.
  const named = flag ?? (env.DELIVERY_CONFIG || undefined);
  let file: string | undefined;
  if (named !== undefined) {
    file = resolve(startDir, named);
    if (!existsSync(file)) throw new Refusal(NO_SUCH_CONFIG(named), EXIT.configuration);
  } else {
    file = configCandidates(startDir, repoPath).find((candidate) => existsSync(candidate));
    if (file === undefined) return {};
  }

  const raw = file.endsWith(".json")
    ? await readJson(file)
    : ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const parsed = DeliveryConfig.safeParse(raw);
  if (!parsed.success) throw new Refusal(describeProblem(file, parsed.error, raw), EXIT.configuration);
  return parsed.data;
}
