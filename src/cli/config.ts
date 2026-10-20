import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { messageOf } from "../gate-support.js";
import { AgentOptions, CloserRef, GuardName, GuardSwitches, Severity, TaskDef, Written } from "../schema.js";
import { FenceSetting } from "../fence.js";
import { GateChoice, isPresetName, PRESET_DETAILS, PRESET_NAMES, type PresetName } from "./gate-presets.js";
import { EXIT, Refusal } from "./failures.js";
import { withPackWorkflows } from "./pack-workflows.js";
import { eachIssue, fieldOf, valueAt, type Issue } from "../schema-issues.js";

/** The one filename family a project uses, and the forms it may take. A `.js` or `.mjs` file exports the same object, for a project that computes a value. */
export const CONFIG_BASENAME = "delivery.config";
export const CONFIG_EXTENSIONS = [".json", ".js", ".mjs"] as const;

/** The keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `tasks`, `domain`, `agent`, `gate`, `closer`, `budgets`, `concurrency`, `fence`, `workflows`, `packs`, `sources`, `after`, `parkAfter` and `notify`";

/** The closer types a person can name without a module path of their own, from the library's own list so the two can never disagree. */
export const BUILT_IN_CLOSERS: string[] = CloserRef.options
  .map((option) => option.shape.type.value)
  .filter((type) => type !== "custom");

/** Names as a sentence lists them, each in code: `a`, `b` and `c`. */
export function andList(names: readonly string[]): string {
  const quoted = names.map((name) => `\`${name}\``);
  return quoted.length < 2 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
}

/** A closer type the harness does not know, answered with the choices rather than with a schema complaint. */
export function unknownCloser(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the closer type \`${type}\`` : "that closer type";
  return (
    `I don't know ${named}. The built-in choices are ${andList(BUILT_IN_CLOSERS)}. ` +
    `To use your own, put \`{ "type": "custom", "modulePath": "./closers/mine.js" }\` in ${CONFIG_BASENAME}.json.`
  );
}

/** A check the harness does not know, answered in one line with the ready-made names rather than with a schema complaint. */
export function unknownGate(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the check \`${type}\`` : "that check";
  return `I don't know ${named}. The ready-made checks are ${andList(PRESET_NAMES)}. To write one out in full, see docs/writing-a-gate.md.`;
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
 * Something a person wrote, in their own words: the schema's own `Written`,
 * named for what it holds here. The text is kept exactly as typed: it is
 * prose, and trimming it would edit the owner's words.
 */
const Prose = Written;

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
 * How many tasks may run at once: a whole number, 1 or more. Named so that a
 * number arriving as text (a flag, an environment variable, an answer typed
 * into `delivery init`) is held to this rule itself, not to a second copy of it.
 */
export const Concurrency = z.number().int().positive();

export const sameStep = (workflow: string, step: string): string =>
  `the workflow \`${workflow}\` has two steps called \`${step}\`. Give each step its own name.`;
export const firstStepContinues = (workflow: string): string =>
  `the first step of the workflow \`${workflow}\` has \`continue\`, but there is no step before it to continue from. Remove it.`;

/** One step of a workflow, as the file writes it. Its gate is resolved, and its options pinned, when a run starts. */
export const StepConfig = z
  .object({
    name: Written,
    // What this step's agent is asked to do. The task itself is still in front of it.
    prompt: Prose,
    // How this step is checked; the project's own `gate` when left out.
    gate: GateChoice.optional(),
    // Laid over the project's `agent` for this step only.
    agent: AgentOptions.optional(),
    // Pick up the previous step's agent session instead of starting a new one.
    continue: z.boolean().optional(),
    // Guards added or turned off for this step only.
    guards: GuardSwitches.optional(),
  })
  .strict();
export type StepConfig = z.infer<typeof StepConfig>;

/**
 * One thing done once a run's work has landed and the closer has taken it (spec §5.7): a command of the operator's,
 * run in their own checkout (`base`) or in a throwaway copy of what landed (`worktree`, the default), or an agent pass.
 * `check` is a command whose success confirms the step, such as `curl -f https://…/health` after a deploy.
 */
const CommandAfter = z.object({ name: Written.optional(), run: Written, in: z.enum(["base", "worktree"]).optional(), check: Written.optional() }).strict();
const AgentAfter = z.object({ name: Written.optional(), prompt: Prose, check: Written.optional() }).strict();
export const AfterStep = z.union([CommandAfter, AgentAfter]);
export type AfterStep = z.infer<typeof AfterStep>;

export const isCommandStep = (step: AfterStep): step is z.infer<typeof CommandAfter> => "run" in step;

const LABEL_LIMIT = 60;
/** How a report names a step: its `name`, else its command, else its prompt's first line. */
export function stepLabel(step: AfterStep): string {
  if (step.name !== undefined) return step.name;
  if (isCommandStep(step)) return step.run;
  const first = step.prompt.split("\n").find((line) => line.trim() !== "")?.trim() ?? "agent pass";
  return first.length <= LABEL_LIMIT ? first : `${first.slice(0, LABEL_LIMIT - 1)}…`;
}

// `after` replaces the project's own after steps for a task delivered through this workflow; an empty list runs none.
// `hold`: a finished task whose item is at or above this severity waits for `delivery sign-off` instead of landing (spec 5.13).
export const WorkflowConfig = z.object({ steps: z.array(StepConfig).min(1), after: z.array(AfterStep).optional(), hold: Severity.optional() }).strict();
export type WorkflowConfig = z.infer<typeof WorkflowConfig>;

/** One place `delivery run --sources` finds work. A `fallback` is read only when no other source has any. */
export const SourceConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("backlog"), name: Written.optional(), fallback: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("list"), name: Written.optional(), fallback: z.boolean().optional() }).strict(),
  z.object({
    type: z.literal("command"), command: Written, name: Written.optional(), fallback: z.boolean().optional(),
    // `tracker`: the script is a tracker and also answers `<command> raise`; follow-ups its items' agents write are raised through it instead of landing in the backlog (spec §5.5)
    tracker: z.boolean().optional(),
  }).strict(),
  // `github`: open issues carrying `label` (default "delivery"), read through the gh CLI; `workflow` delivers an issue with no workflow: label (spec §5.5).
  z.object({ type: z.literal("github"), label: Written.optional(), workflow: Written.optional(), name: Written.optional(), fallback: z.boolean().optional() }).strict(),
]);
export type SourceConfig = z.infer<typeof SourceConfig>;

/** A source's name as the run's report and its duplicate check know it: its `name`, or else its type. */
export const sourceName = (source: SourceConfig): string => source.name ?? source.type;

export const DEFAULT_SOURCES: SourceConfig[] = [{ type: "backlog" }];

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
    // Options for every agent session, passed to Claude Code as written, and
    // `append`, text added to what every agent is told.
    agent: AgentOptions.optional(),
    // How the work is checked: a ready-made check by name, or one written out
    // as the library takes it. Resolved to the written-out form before any run
    // starts, so a run's record never holds a name.
    gate: GateChoice.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
    // How many tasks from `tasks` may run at once. One, the default, is the
    // list worked down in order; more starts that many side by side.
    concurrency: Concurrency.optional(),
    // Whether every agent session runs inside the write fence: `preferred`, `required` or `off`, or an object with `mode` and `devices`.
    fence: FenceSetting.optional(),
    // Named ways of doing a task in more than one checked step, chosen with `delivery run --workflow <name>`.
    workflows: z.record(Written, WorkflowConfig).optional(),
    // Review folders of the project's own, relative to this file; each adds its <name>:scan and <name>:fix workflows (spec 5.13).
    packs: z.array(Written).optional(),
    // Where `delivery run --sources` finds work, in order; a fallback is read only when nothing else has any.
    sources: z.array(SourceConfig).min(1).optional(),
    // How many runs in a row an item may end undelivered before it is set aside (default 3).
    parkAfter: z.number().int().positive().optional(),
    // Steps run once per run, after the closer has taken the delivery branch and only when a task landed (spec §5.7).
    after: z.array(AfterStep).optional(),
    // A command run at the end of every run with the run's report JSON on its standard input.
    notify: Written.optional(),
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
  })
  .superRefine((config, ctx) => {
    // A task's guards are checked here, not in the entry's own schema, so a wrong name gets its own sentence
    // rather than the whole entry being quoted back as the wrong kind.
    const entries: [PropertyKey[], unknown][] = [
      ...(config.task === undefined ? [] : [[["task"], config.task] as [PropertyKey[], unknown]]),
      ...(config.tasks ?? []).map((entry, index): [PropertyKey[], unknown] => [["tasks", index], entry]),
    ];
    for (const [path, entry] of entries) {
      if (typeof entry !== "object" || entry === null || !("guards" in entry)) continue;
      if (!GuardSwitches.safeParse(entry.guards).success) ctx.addIssue({ code: "custom", path: [...path, "guards"], message: "guards" });
    }
  })
  .superRefine((config, ctx) => {
    for (const [name, { steps }] of Object.entries(config.workflows ?? {})) {
      steps.forEach((step, index) => {
        if (steps.findIndex((other) => other.name === step.name) !== index) {
          ctx.addIssue({ code: "custom", path: ["workflows", name, "steps", index, "name"], message: sameStep(name, step.name) });
        }
      });
      if (steps[0]?.continue === true) {
        ctx.addIssue({ code: "custom", path: ["workflows", name, "steps", 0, "continue"], message: firstStepContinues(name) });
      }
    }
  })
  .superRefine((config, ctx) => {
    // Two sources with one name would be one source in the run's report, so the second is refused and asked to be named.
    const seen = new Set<string>();
    for (const [index, source] of (config.sources ?? []).entries()) {
      const name = sourceName(source);
      if (seen.has(name)) {
        ctx.addIssue({ code: "custom", path: ["sources", index], message: `\`sources\` names ${name} twice. Give one of them its own \`name\`.` });
      }
      seen.add(name);
    }
  });
export type DeliveryConfig = z.infer<typeof DeliveryConfig>;

/**
 * What each setting takes, said as the fix for a value of the wrong kind.
 * Keyed on the schema's own keys, so a new setting does not compile until it
 * can say what it wants. Plain words, never the schema's own complaint: the
 * reader is fixing a file, not debugging a parser.
 */
const WHAT_IT_TAKES: Record<keyof DeliveryConfig, string> = {
  task:
    'It is one thing you want done, written as an object with an `intent` sentence in it: `{ "intent": "add a page" }`. ' +
    "For a list of sentences, use `tasks`.",
  tasks: "It is a list of the things you want done, one sentence each, in the order you want them.",
  domain: "It is a sentence or two describing your project.",
  agent:
    'It is a set of options for the agent\'s sessions, passed to Claude Code as written, for example `{ "model": "opus", "effort": "high" }`, ' +
    "and `append`, text added to what every agent is told.",
  gate:
    'It says how the work is checked: a ready-made check such as `{ "type": "test-runner" }`, or one written out such as ' +
    '`{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`: see docs/writing-a-gate.md.',
  closer: "It says what happens to work that passes: see docs/writing-a-closer.md for the choices and what each one takes.",
  budgets: 'It is a set of limits, each a whole number of attempts, for example `{ "correction": 5 }`.',
  concurrency: "It says how many tasks from your list may run at once: a whole number, 1 or more, such as `3`.",
  fence:
    'It says whether the agent works inside a fence that keeps your main folder read-only: "preferred", "required" or "off", ' +
    'or an object such as `{ "mode": "required", "devices": ["/dev/kvm"] }`.',
  packs:
    'It is a list of folders of review packs of your own, relative to this file, such as `["reviews/mine"]`: each adds its `<name>:scan` and `<name>:fix` workflows.',
  workflows:
    'It names ways of doing a task in steps, each a list of `steps` run in order, for example ' +
    '`{ "plan-then-build": { "steps": [{ "name": "plan", "prompt": "write PLAN.md" }, { "name": "build", "prompt": "carry out PLAN.md", "continue": true }] } }`: ' +
    "see docs/configuration-reference.md.",
  sources:
    'It is the list of places work comes from, in order, for `delivery run --sources`: each one an object with a `type` of "backlog", "list", "command" or "github" ' +
    '(a command source also takes `command`, and `"tracker": true` when it can `raise` follow-ups; a github source may take a `label` and a default `workflow`), ' +
    'for example `[{ "type": "github", "label": "delivery" }, { "type": "command", "command": "./next-slice.sh" }]`. ' +
    'Add `"fallback": true` to one that is used only when nothing else has work.',
  after:
    "It is a list of steps run once a run's work has landed and your closer has taken it: each one a command, such as " +
    '`{ "run": "make deploy", "check": "curl -f http://localhost/health" }` (add `"in": "base"` to run it in your own folder rather than a copy of what landed), ' +
    'or an agent pass, such as `{ "prompt": "Write release notes for the landed commits." }`: see docs/configuration-reference.md.',
  parkAfter:
    "It is how many runs in a row an item may end without being delivered before it is set aside: a whole number, 1 or more, such as `3`.",
  notify: 'It is a command run at the end of every run with the run\'s report on its standard input, such as `"./tell-me.sh"`.',
};

/** The roles a config file could once change, in the order a refusal checks them. */
const OLD_ROLES = ["worker", "gateMaintenance"] as const;

/** A config file written before `roles` was removed, told where each part of it now lives. */
export function rolesRemoved(file: string, raw: unknown): string {
  const withTools = OLD_ROLES.find((role) => valueAt(raw, ["roles", role, "allowedTools"]) !== undefined);
  if (withTools !== undefined) {
    return (
      `I can't use ${file}: \`roles.${withTools}.allowedTools\` is no longer used. ` +
      "The agent now has the tools your own Claude Code setup gives it; to keep it from one, add it to `permissions.deny` in your Claude settings."
    );
  }
  return `I can't use ${file}: \`roles\` is no longer used. Put any instructions for the agent in \`agent.append\` instead.`;
}

/**
 * A ready-made check with a detail missing, empty, of the wrong kind or not
 * its own, said as the one detail to fix. The first issue is enough, as
 * everywhere else: zod reports a missing detail before an extra one.
 */
function presetProblem(file: string, issue: Issue, name: PresetName): string {
  const details = PRESET_DETAILS[name];
  if (issue.code === "unrecognized_keys") {
    return `I can't use ${file}: the ready-made check \`${name}\` takes only ${andList(Object.keys(details))}, so remove \`${issue.keys[0]}\`.`;
  }
  const detail = String(issue.path[1]);
  return `I can't use ${file}: the ready-made check \`${name}\` needs \`${detail}\`, ${details[detail]}.`;
}

/** One problem with a config file, as a script reads it: the setting it concerns, and the sentence a person is shown. */
export interface ConfigProblem {
  /** The setting's path as written in the file, dot-joined, array positions from 0; null when the problem is with the file as a whole. */
  field: string | null;
  message: string;
}

/**
 * One plain-language sentence about one thing wrong with a config file,
 * naming the key or the value. The plain form shows the first of these and
 * stops, because a list of schema complaints is the stack trace that command
 * exists to avoid; `validate --json` lists them all, each in the same words.
 */
function describeIssue(file: string, issue: Issue, raw: unknown): string {
  const where = issue.path.join(".");

  if (issue.code === "unrecognized_keys" && issue.path.length === 0 && issue.keys.includes("roles")) return rolesRemoved(file, raw);

  if (issue.path[0] === "agent" && issue.code === "custom") return `I can't use ${file}: ${issue.message}`;
  if (issue.path[0] === "workflows" && issue.code === "custom") return `I can't use ${file}: ${issue.message}`;
  if (issue.path[0] === "sources" && issue.code === "custom") return `I can't use ${file}: ${issue.message}`;
  if (where === "gate.type") return unknownGate(valueAt(raw, issue.path));
  const gateType = valueAt(raw, ["gate", "type"]);
  if (issue.path[0] === "gate" && isPresetName(gateType)) return presetProblem(file, issue, gateType);

  if (issue.code === "custom" && issue.path.at(-1) === "guards") {
    return (
      `I can't use ${file}: \`${where}\` names a guard I don't know. The guards are ${andList(GuardName.options)}, ` +
      "and `add` and `off` each take a list of them."
    );
  }

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
    return `I can't use ${file}: \`tasks\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ${WHAT_IT_TAKES.tasks}`;
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
  if (where === "") {
    return (
      `I can't use ${file}: it should hold one object of settings, using ${CONFIG_KEYS}. ` +
      "A `.js` or `.mjs` file exports that object as its default."
    );
  }
  // Every other path starts at one of the schema's keys: `.strict()` names any
  // other key through the unrecognised-key branch above.
  const setting = issue.path[0] as keyof DeliveryConfig;
  const value = valueAt(raw, issue.path);
  // A required value left out says so, rather than quoting JavaScript's word for nothing.
  const is = value === undefined ? "is missing" : `is \`${JSON.stringify(value)}\``;
  return `I can't use ${file}: the setting \`${where}\` ${is}. ${WHAT_IT_TAKES[setting]}`;
}

/**
 * Every problem with a config file's shape, in the order they were found, each
 * said exactly as it would be said alone. zod reports several unknown keys in
 * one issue; each is its own problem here, so each is named.
 */
export function configProblems(file: string, error: z.ZodError, raw: unknown): ConfigProblem[] {
  return eachIssue(error).map((issue) => ({ field: fieldOf(issue), message: describeIssue(file, issue, raw) }));
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
  /** For a command that promises only to read: a JSON file alone, never a JavaScript one, which would run the project's own code. */
  dataOnly?: boolean;
}

/**
 * The config file this invocation means: the one `--config` or
 * `DELIVERY_CONFIG` names, or the nearest one at or above the folder the
 * command was run from. Nothing when nothing was named and there is none,
 * which a run treats as "use the defaults" and `validate` as the thing to say.
 * A named file that isn't there is refused rather than quietly replaced by
 * discovery.
 */
export function findConfig({ startDir, repoPath, flag, env, dataOnly }: ConfigLookup): string | undefined {
  // An empty DELIVERY_CONFIG is CI writing an input nobody filled in: not a
  // file called "", and not a reason to refuse before discovery has run.
  const named = flag ?? (env.DELIVERY_CONFIG || undefined);
  const found = named === undefined ? configCandidates(startDir, repoPath).find((candidate) => existsSync(candidate)) : resolve(startDir, named);
  if (named !== undefined && found !== undefined && !existsSync(found)) throw new Refusal(NO_SUCH_CONFIG(named), EXIT.configuration);
  if (dataOnly === true && found !== undefined && !found.endsWith(".json")) return undefined;
  return found;
}

/** What a config file holds: its settings, or every problem with its shape. A file that is not valid JSON is still refused outright. */
export type ConfigCheck = { ok: true; config: DeliveryConfig } | { ok: false; problems: ConfigProblem[] };

export async function checkConfig(file: string): Promise<ConfigCheck> {
  const raw = file.endsWith(".json")
    ? await readJson(file)
    : ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const parsed = DeliveryConfig.safeParse(raw);
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false, problems: configProblems(file, parsed.error, raw) };
}

/** One config file's settings, or a refusal naming the first thing wrong with it. */
export async function readConfig(file: string): Promise<DeliveryConfig> {
  const checked = await checkConfig(file);
  if (checked.ok) return checked.config;
  throw new Refusal(checked.problems[0]?.message ?? `I can't use ${file}.`, EXIT.configuration);
}

/**
 * The settings a run starts from: the file the user named, or the nearest one
 * at or above the folder they ran in, or nothing at all, which is not an error
 * because every setting has a default.
 */
export async function loadConfig(lookup: ConfigLookup): Promise<DeliveryConfig> {
  const file = findConfig(lookup);
  const config = file === undefined ? {} : await readConfig(file);
  return withPackWorkflows(config, file === undefined ? lookup.repoPath : dirname(file));
}

/** The source a project's ideas are raised to instead of committed: its first tracker, if it has one. */
export const trackerSource = (config: DeliveryConfig): SourceConfig | undefined =>
  (config.sources ?? DEFAULT_SOURCES).find((source) => source.type === "github" || (source.type === "command" && source.tracker === true));
