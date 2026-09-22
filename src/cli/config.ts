import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { messageOf } from "../gate-support.js";
import { CloserRef, GateRef, TaskDef } from "../schema.js";
import { EXIT, Refusal } from "./failures.js";

/** The one filename family a project uses, and the forms it may take. A `.js` or `.mjs` file exports the same object, for a project that computes a value. */
export const CONFIG_BASENAME = "delivery.config";
export const CONFIG_EXTENSIONS = [".json", ".js", ".mjs"] as const;

/** The six keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `tasks`, `domain`, `gate`, `closer` and `budgets`";

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
 * One thing a project wants done, as its owner wrote it: a sentence, or an
 * object carrying that sentence and anything else the project keeps beside it.
 * The extra fields mean nothing to the harness and are passed through
 * untouched, so a project can annotate its own list without asking permission.
 */
export const QueueEntry = z.union([Prose, z.looseObject({ intent: Prose })]);
export type QueueEntry = z.infer<typeof QueueEntry>;

/**
 * An entry as the run machinery takes it. A sentence becomes exactly the shape
 * `--task` already produces, so a listed task and an ad-hoc one of the same
 * words are one task; an object is already that shape and is returned as
 * written. Deterministic on purpose: this is what `validate` and `preview` must
 * be able to do with no agent, no spend and no credential.
 */
export function structureTask(entry: QueueEntry): TaskDef {
  return typeof entry === "string" ? { intent: entry.trim() } : entry;
}

export const BOTH_TASK_AND_TASKS =
  "this project has both `task` and `tasks` set. Use `tasks` for a list of things to do, or `task` for a single one-off, not both.";

export const sameTask = (first: number, second: number): string =>
  `tasks ${first} and ${second} are the same task, so I couldn't tell their runs apart. Reword one, or remove it.`;

/**
 * The whole of a `delivery.config.json`. `task`, `gate` and `closer` are the
 * library's own schemas, composed rather than restated, so the file can never
 * drift from what the harness accepts. `.strict()` on both objects means a typo
 * is named rather than silently ignored.
 */
export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),
    // The things this project wants done, in the order it wants them. A list is
    // the project's own plan for itself; `task` is one thing done over and over.
    // Having both would leave `delivery run` with no honest answer, so the
    // refinement below refuses it.
    tasks: z.array(QueueEntry).min(1).optional(),
    // What this project is, in the owner's own words, sent to every agent on
    // every run of it. One string at both altitudes: a long one is written in
    // the `.js` form with a template literal, not in a file of its own.
    domain: Prose.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.task && config.tasks) ctx.addIssue({ code: "custom", message: BOTH_TASK_AND_TASKS, path: ["tasks"] });
    // Which run answers which entry is decided by what the entry says, so two
    // entries that say the same thing would share one run and one of them could
    // never be done. Refused here, at load, so every command that reads the
    // file inherits the guarantee. A hand-written list is a handful of entries:
    // comparing each against the ones before it is not worth a lookup table.
    const structured = (config.tasks ?? []).map(structureTask);
    structured.forEach((taskDef, index) => {
      const first = structured.findIndex((earlier) => isDeepStrictEqual(earlier, taskDef));
      if (first !== index) ctx.addIssue({ code: "custom", message: sameTask(first + 1, index + 1), path: ["tasks"] });
    });
  });
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
  if (issue.path[0] === "tasks" && issue.path.length > 1) {
    const item = Number(issue.path[1]) + 1;
    // A string that is there but says nothing is the one mistake worth its own
    // sentence, wherever in the entry it sits; anything else is an entry of the
    // wrong kind, quoted back whole.
    const offending = valueAt(raw, issue.path);
    if (typeof offending === "string" && offending.trim() === "") {
      return `I can't use ${file}: \`tasks\` item ${item} is empty. Add a sentence describing what you want done, or remove it.`;
    }
    return (
      `I can't use ${file}: \`tasks\` item ${item} is \`${JSON.stringify(valueAt(raw, issue.path.slice(0, 2)))}\`. ` +
      "Each one is a sentence describing what you want done, or an object with an `intent` sentence in it."
    );
  }
  if (where === "tasks") {
    // The whole-file rules say their own sentence. An empty list and something
    // that is not a list at all are different mistakes: naming the second as
    // the first would send the reader to add an entry to a value that could
    // not hold one.
    if (issue.code === "custom") return `I can't use ${file}: ${issue.message}`;
    if (issue.code === "too_small") {
      return (
        `I can't use ${file}: \`tasks\` is empty. Add at least one sentence describing what you want done, ` +
        "or remove `tasks` and use `--task` for a single run."
      );
    }
    return (
      `I can't use ${file}: \`tasks\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ` +
      "It is a list of the things you want done, one sentence each, in the order you want them."
    );
  }
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

/** Where to look for a config file: the folder the command was run from, the repository it stops at, and whatever the person named. */
export interface ConfigLookup {
  startDir: string;
  repoPath: string;
  flag: string | undefined;
  env: NodeJS.ProcessEnv;
}

/**
 * The config file this invocation means: the one `--config` or
 * `DELIVERY_CONFIG` names, or the nearest one at or above the folder the
 * command was run from. Nothing when nothing was named and there is none,
 * which a run treats as "use the defaults" and `validate` as the thing to say.
 * A named file that isn't there is refused rather than quietly replaced by
 * discovery.
 */
export function findConfig({ startDir, repoPath, flag, env }: ConfigLookup): string | undefined {
  // An empty DELIVERY_CONFIG is CI writing an input nobody filled in: not a
  // file called "", and not a reason to refuse before discovery has run.
  const named = flag ?? (env.DELIVERY_CONFIG || undefined);
  if (named === undefined) return configCandidates(startDir, repoPath).find((candidate) => existsSync(candidate));
  const file = resolve(startDir, named);
  if (!existsSync(file)) throw new Refusal(NO_SUCH_CONFIG(named), EXIT.configuration);
  return file;
}

/** One config file's settings, or a refusal naming the first thing wrong with it. */
export async function readConfig(file: string): Promise<DeliveryConfig> {
  const raw = file.endsWith(".json")
    ? await readJson(file)
    : ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const parsed = DeliveryConfig.safeParse(raw);
  if (!parsed.success) throw new Refusal(describeProblem(file, parsed.error, raw), EXIT.configuration);
  return parsed.data;
}

/**
 * The settings a run starts from: the file the user named, or the nearest one
 * at or above the folder they ran in, or nothing at all, which is not an error
 * because every setting has a default.
 */
export async function loadConfig(lookup: ConfigLookup): Promise<DeliveryConfig> {
  const file = findConfig(lookup);
  return file === undefined ? {} : readConfig(file);
}
