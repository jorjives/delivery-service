import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkConfig, configCandidates, configProblems, DeliveryConfig, findConfig, loadConfig, NO_SUCH_CONFIG, structureTask, unknownCloser, unknownGate } from "./config.js";
import { EXIT, Refusal } from "./failures.js";

const FILE = "delivery.config.json";

/** Every problem the command would report for a config file it refuses, in order. */
function problemsFor(raw: unknown) {
  const parsed = DeliveryConfig.safeParse(raw);
  if (parsed.success) throw new Error(`expected ${JSON.stringify(raw)} to be refused`);
  return configProblems(FILE, parsed.error, raw);
}

/** The message the command would print for a config file it refuses: the first problem, as the plain form shows it. */
function problemFor(raw: unknown): string {
  const [first] = problemsFor(raw);
  if (first === undefined) throw new Error(`expected a problem for ${JSON.stringify(raw)}`);
  return first.message;
}

describe("what a config file may contain", () => {
  it("accepts exactly task, tasks, domain, roles, gate, closer and budgets, in the shapes the library already documents", () => {
    const config = {
      task: { intent: "add a function that says goodbye to a name, with a test" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back", deleteBranch: true },
      budgets: { correction: 5 },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts instructions and tools for the worker and gate maintenance, each field on its own", () => {
    const config = {
      roles: {
        worker: { systemPromptFragment: "Never modify anything under the ops folder.", allowedTools: ["Read", "Glob", "Grep", "Edit"] },
        gateMaintenance: { allowedTools: ["Read", "Edit"] },
      },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts a custom gate and a custom closer, the shapes a flag cannot express", () => {
    const config = {
      gate: { type: "custom", modulePath: "./gates/mine.mjs", exportName: "slow" },
      closer: { type: "custom", modulePath: "./closers/mine.mjs" },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts an empty file, because every setting has a default", () => {
    expect(DeliveryConfig.parse({})).toEqual({});
  });

  it("accepts a project description as one plain prose value, beside the settings it already took", () => {
    const config = {
      domain: "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
      task: { intent: "add a function that says goodbye to a name, with a test" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back", deleteBranch: true },
      budgets: { correction: 5 },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("takes a cap per attempt category and leaves the rest unset, so they keep their defaults", () => {
    expect(DeliveryConfig.parse({ budgets: { close: 2 } })).toEqual({ budgets: { close: 2 } });
    expect(DeliveryConfig.parse({ budgets: { correction: 5, gateError: 4, gateMaintenance: 3, terminus: 9, close: 2 } })).toEqual({
      budgets: { correction: 5, gateError: 4, gateMaintenance: 3, terminus: 9, close: 2 },
    });
  });

  it("never takes a used counter, which is the harness's own state", () => {
    expect(DeliveryConfig.safeParse({ budgets: { correction: { used: 0, max: 5 } } }).success).toBe(false);
  });

  it("accepts an ordered list of plain sentences", () => {
    const config = {
      tasks: [
        "add a page that shows who's on call today",
        "let someone swap their on-call day with a teammate",
      ],
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts a task written as an object, keeping the fields the harness has no use for", () => {
    const config = { tasks: [{ intent: "add a page that shows who's on call today", area: "billing", priority: 2 }] };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it.each([
    [{ type: "test-runner" }],
    [{ type: "test-runner", command: "npx vitest run" }],
    [{ type: "file-exists", path: "CHANGES.md" }],
    [{ type: "command-succeeds", command: "npm run lint" }],
    [{ type: "schema-validates", file: "data.json", schema: "data.schema.json" }],
  ])("accepts the ready-made check %j with only the detail it needs", (gate) => {
    expect(DeliveryConfig.parse({ gate })).toEqual({ gate });
  });
});

describe("turning what someone wrote into a task", () => {
  it("makes a sentence the same shape --task already makes, without its surrounding space", () => {
    expect(structureTask("  add a page that shows who's on call today  ")).toEqual({
      intent: "add a page that shows who's on call today",
    });
  });

  it("leaves a task object exactly as it was written", () => {
    const entry = { intent: "add a page that shows who's on call today", area: "billing" };
    expect(structureTask(entry)).toEqual(entry);
  });
});

describe("what it says about a file it can't use", () => {
  it("refuses one task and a list of tasks in the same file, rather than guessing which was meant", () => {
    expect(problemFor({ task: { intent: "add a page" }, tasks: ["add a page"] })).toBe(
      "I can't use delivery.config.json: this project has both `task` and `tasks` set. Use `tasks` for a list of things to do, or `task` for a single one-off, not both.",
    );
  });

  it("names an empty list and both ways out", () => {
    expect(problemFor({ tasks: [] })).toBe(
      "I can't use delivery.config.json: `tasks` is empty. Add at least one sentence describing what you want done, or remove `tasks` and use `--task` for a single run.",
    );
  });

  it.each([[""], ["   "], ["\n\t "]])("names the item of the list that is empty, and the two ways out (%j)", (value) => {
    expect(problemFor({ tasks: ["add a page that shows who's on call today", value] })).toBe(
      "I can't use delivery.config.json: `tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.",
    );
  });

  it("names an empty task object's sentence the same way", () => {
    expect(problemFor({ tasks: [{ intent: "  ", area: "billing" }] })).toBe(
      "I can't use delivery.config.json: `tasks` item 1 is empty. Add a sentence describing what you want done, or remove it.",
    );
  });

  it("names a `tasks` that isn't a list at all, rather than calling it empty", () => {
    expect(problemFor({ tasks: "add a page" })).toBe(
      'I can\'t use delivery.config.json: `tasks` is `"add a page"`. It is a list of the things you want done, one sentence each, in the order you want them.',
    );
  });

  it("names an entry that is neither a sentence nor a task object, quoting what was written", () => {
    expect(problemFor({ tasks: [42] })).toBe(
      "I can't use delivery.config.json: `tasks` item 1 is `42`. Each one is a sentence describing what you want done, or an object with an `intent` sentence in it.",
    );
  });

  it("refuses two entries that are the same task, naming both and the fix", () => {
    expect(problemFor({ tasks: ["add a page", "swap a day", "add a page"] })).toBe(
      "I can't use delivery.config.json: tasks 1 and 3 are the same task, so I couldn't tell their runs apart. Reword one, or remove it.",
    );
  });

  it("treats a sentence and the object that means the same thing as one task", () => {
    expect(problemFor({ tasks: ["add a page", { intent: "add a page" }] })).toBe(
      "I can't use delivery.config.json: tasks 1 and 2 are the same task, so I couldn't tell their runs apart. Reword one, or remove it.",
    );
  });

  it("does not call two entries the same when one carries a field the other doesn't", () => {
    expect(DeliveryConfig.safeParse({ tasks: ["add a page", { intent: "add a page", area: "billing" }] }).success).toBe(true);
  });

  it("leads with the empty entry rather than the duplicate it also makes", () => {
    expect(problemFor({ tasks: ["  ", "  "] })).toBe(
      "I can't use delivery.config.json: `tasks` item 1 is empty. Add a sentence describing what you want done, or remove it.",
    );
  });

  it("names a role that can't be changed from the file, and the way out", () => {
    expect(problemFor({ roles: { triage: { allowedTools: ["Read"] } } })).toBe(
      "I can't use delivery.config.json: `roles` has no role called `triage`. " +
        "Only `worker` and `gateMaintenance` can be changed here, so remove it to keep the built-in one.",
    );
  });

  it("names a role setting that doesn't exist, what a role takes, and the way out", () => {
    expect(problemFor({ roles: { worker: { tools: ["Read"] } } })).toBe(
      "I can't use delivery.config.json: `roles.worker` has no setting called `tools`. " +
        "It takes `systemPromptFragment` and `allowedTools`, so remove it to keep the built-in one.",
    );
  });

  it.each([[""], ["   "], ["\n\t "]])("names the worker's empty instructions and the two ways out (%j)", (value) => {
    expect(problemFor({ roles: { worker: { systemPromptFragment: value } } })).toBe(
      "I can't use delivery.config.json: `roles.worker.systemPromptFragment`, the instructions for the worker, is empty. " +
        "Write a sentence, or remove it to keep the built-in one.",
    );
  });

  it("names gate maintenance's empty instructions in the owner's words", () => {
    expect(problemFor({ roles: { gateMaintenance: { systemPromptFragment: "" } } })).toBe(
      "I can't use delivery.config.json: `roles.gateMaintenance.systemPromptFragment`, the instructions for the agent that repairs your check, is empty. " +
        "Write a sentence, or remove it to keep the built-in one.",
    );
  });

  it("names an empty tools list and the two ways out", () => {
    expect(problemFor({ roles: { worker: { allowedTools: [] } } })).toBe(
      "I can't use delivery.config.json: `roles.worker.allowedTools`, the tools the worker may use, is empty. " +
        "Name at least one, or remove it to keep the built-in one.",
    );
  });

  it("names an empty entry in a tools list by its position", () => {
    expect(problemFor({ roles: { worker: { allowedTools: ["Read", " "] } } })).toBe(
      "I can't use delivery.config.json: `roles.worker.allowedTools` item 2 is empty. Name a tool, or remove it.",
    );
  });

  it("names roles given as something other than a set of roles", () => {
    expect(problemFor({ roles: "strict" })).toBe(
      'I can\'t use delivery.config.json: the setting `roles` is `"strict"`. ' +
        'It changes what the worker, or the agent that repairs your check, is told and which tools it may use, for example `{ "worker": { "allowedTools": ["Read", "Edit"] } }`: see docs/configuring-a-role.md.',
    );
  });

  it("names an unknown top-level key, and what the file does take", () => {
    expect(problemFor({ closr: { type: "merge-back" } })).toBe(
      "I can't use delivery.config.json: there's no setting called `closr`. A config file takes only `task`, `tasks`, `domain`, `roles`, `gate`, `closer` and `budgets`.",
    );
  });

  it("names an unknown budget key, and where it was", () => {
    expect(problemFor({ budgets: { corection: 5 } })).toBe(
      "I can't use delivery.config.json: there's no setting called `corection`. `budgets` doesn't take it.",
    );
  });

  it.each([["five"], [0], [-1], [2.5]])("names a limit that is not a whole number of attempts (%p)", (value) => {
    expect(problemFor({ budgets: { correction: value } })).toBe(
      `I can't use delivery.config.json: the limit \`budgets.correction\` is \`${JSON.stringify(value)}\`. A limit is a whole number of attempts, 1 or more.`,
    );
  });

  it("names a malformed check and what a check looks like", () => {
    expect(problemFor({ gate: { type: "command", command: "npm test", parseMode: "toml" } })).toBe(
      'I can\'t use delivery.config.json: the setting `gate.parseMode` is `"toml"`. ' +
        'It says how the work is checked: a ready-made check such as `{ "type": "test-runner" }`, or one written out such as ' +
        '`{ "type": "command", "command": "npm test", "parseMode": "exitcode" }`: see docs/writing-a-gate.md.',
    );
  });

  it("names a task given as a bare sentence and what a task looks like", () => {
    expect(problemFor({ task: "add a goodbye function" })).toBe(
      'I can\'t use delivery.config.json: the setting `task` is `"add a goodbye function"`. ' +
        'It is one thing you want done, written as an object with an `intent` sentence in it: `{ "intent": "add a page" }`. ' +
        "For a list of sentences, use `tasks`.",
    );
  });

  it("still names a description given the wrong kind of value altogether, rather than calling it empty", () => {
    expect(problemFor({ domain: 42 })).toBe(
      "I can't use delivery.config.json: the setting `domain` is `42`. It is a sentence or two describing your project.",
    );
  });

  it("answers an unknown closer type with the choices, not with a schema complaint", () => {
    expect(problemFor({ closer: { type: "teleport" } })).toBe(unknownCloser("teleport"));
  });

  it.each([[""], ["   "], ["\n\t "]])("names an empty project description and the two ways out (%j)", (value) => {
    expect(problemFor({ domain: value })).toBe(
      "I can't use delivery.config.json: `domain` is empty. Describe your project in a sentence or two, or remove it.",
    );
  });

  it("names a closing action's setting of the wrong kind and where the choices are described", () => {
    expect(problemFor({ closer: { type: "merge-back", deleteBranch: "yes" } })).toBe(
      'I can\'t use delivery.config.json: the setting `closer.deleteBranch` is `"yes"`. ' +
        "It says what happens to work that passes: see docs/writing-a-closer.md for the choices and what each one takes.",
    );
  });

  it("names limits given as something other than a set of limits", () => {
    expect(problemFor({ budgets: "lots" })).toBe(
      'I can\'t use delivery.config.json: the setting `budgets` is `"lots"`. ' +
        'It is a set of limits, each a whole number of attempts, for example `{ "correction": 5 }`.',
    );
  });

  it("names a file that holds something other than one object of settings", () => {
    expect(problemFor(["add a page"])).toBe(
      "I can't use delivery.config.json: it should hold one object of settings, using `task`, `tasks`, `domain`, `roles`, `gate`, `closer` and `budgets`. " +
        "A `.js` or `.mjs` file exports that object as its default.",
    );
  });

  it.each([
    [{ gate: { type: "command", command: "npm test", parseMode: "toml" } }],
    [{ gate: { type: "command", parseMode: "exitcode" } }],
    [{ task: "add a goodbye function" }],
    [{ domain: 42 }],
    [{ closer: { type: "custom" } }],
    [{ budgets: "lots" }],
    [["add a page"]],
    [undefined],
    [{ roles: "strict" }],
    [{ roles: { worker: { allowedTools: "Read" } } }],
    [{ gate: { type: "file-exist", path: "CHANGES.md" } }],
    [{ gate: { type: "file-exists" } }],
    [{ gate: { type: "file-exists", path: "CHANGES.md", command: "ls" } }],
    [{ gate: "file-exists" }],
  ])("never repeats the schema's own wording back (%j)", (raw) => {
    expect(problemFor(raw)).not.toMatch(/Invalid|expected|received|undefined/);
  });

  it("says a required value is missing, rather than quoting it as undefined", () => {
    expect(problemFor({ closer: { type: "custom" } })).toBe(
      "I can't use delivery.config.json: the setting `closer.modulePath` is missing. " +
        "It says what happens to work that passes: see docs/writing-a-closer.md for the choices and what each one takes.",
    );
  });

  it("answers a misspelt ready-made check with the four names, in one line", () => {
    const said = problemFor({ gate: { type: "file-exist", path: "CHANGES.md" } });
    expect(said).toBe(unknownGate("file-exist"));
    expect(said.split("\n")).toHaveLength(1);
  });

  it.each<[unknown, string]>([
    [{ type: "file-exists" }, "the ready-made check `file-exists` needs `path`, the file that should exist."],
    [{ type: "file-exists", path: "  " }, "the ready-made check `file-exists` needs `path`, the file that should exist."],
    [{ type: "file-exists", file: "CHANGES.md" }, "the ready-made check `file-exists` needs `path`, the file that should exist."],
    [{ type: "command-succeeds" }, "the ready-made check `command-succeeds` needs `command`, the command that should succeed."],
    [{ type: "schema-validates", file: "data.json" }, "the ready-made check `schema-validates` needs `schema`, the file describing the shape it should have."],
    [{ type: "test-runner", command: 7 }, "the ready-made check `test-runner` needs `command`, the command that runs your tests."],
  ])("names the detail the ready-made check %j is missing", (gate, message) => {
    expect(problemFor({ gate })).toBe(`I can't use delivery.config.json: ${message}`);
  });

  it.each<[unknown, string]>([
    [{ type: "test-runner", path: "CHANGES.md" }, "the ready-made check `test-runner` takes only `command`, so remove `path`."],
    [{ type: "file-exists", path: "CHANGES.md", command: "ls" }, "the ready-made check `file-exists` takes only `path`, so remove `command`."],
  ])("names a detail the ready-made check %j doesn't take", (gate, message) => {
    expect(problemFor({ gate })).toBe(`I can't use delivery.config.json: ${message}`);
  });
});

describe("unknownCloser", () => {
  it("lists the built-in choices and how to point at your own", () => {
    expect(unknownCloser("teleport")).toBe(
      "I don't know the closer type `teleport`. The built-in choices are `merge-back`, `commit-to-branch` and `open-pr`. " +
        'To use your own, put `{ "type": "custom", "modulePath": "./closers/mine.js" }` in delivery.config.json.',
    );
  });

  it("copes with a closer type that is not a string at all", () => {
    expect(unknownCloser(undefined)).toContain("I don't know that closer type.");
  });
});

describe("unknownGate", () => {
  it("lists the four ready-made checks and where to write one out in full", () => {
    expect(unknownGate("file-exist")).toBe(
      "I don't know the check `file-exist`. The ready-made checks are `test-runner`, `file-exists`, `command-succeeds` and `schema-validates`. " +
        "To write one out in full, see docs/writing-a-gate.md.",
    );
  });

  it("copes with a check type that is missing or not a string at all", () => {
    expect(unknownGate(undefined)).toMatch(/^I don't know that check\. The ready-made checks are /);
    expect(unknownGate(42)).toMatch(/^I don't know that check\. /);
  });
});

/** A folder tree standing in for a checkout: `<parent>/repo/sub/deep`, with the repository root at `repo`. */
function tree(): { parent: string; repo: string; sub: string; deep: string } {
  const parent = mkdtempSync(join(tmpdir(), "config-tree-"));
  const repo = join(parent, "repo");
  const sub = join(repo, "sub");
  const deep = join(sub, "deep");
  mkdirSync(deep, { recursive: true });
  return { parent, repo, sub, deep };
}

const write = (dir: string, name: string, contents: string): string => {
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
};

/** Load the config a run would use, with nothing named on the command line or in the environment. */
const found = (startDir: string, repoPath: string, env: NodeJS.ProcessEnv = {}) =>
  loadConfig({ startDir, repoPath, flag: undefined, env });

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("finding a config file nobody named", () => {
  it("uses one in the folder the command was run from", async () => {
    const { repo, deep } = tree();
    write(deep, "delivery.config.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(deep, repo)).toEqual({ closer: { type: "merge-back" } });
  });

  it("walks up to the repository root to find one", async () => {
    const { repo, deep } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    expect(await found(deep, repo)).toEqual({ closer: { type: "open-pr" } });
  });

  it("prefers the nearest one", async () => {
    const { repo, sub, deep } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    write(sub, "delivery.config.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(deep, repo)).toEqual({ closer: { type: "merge-back" } });
  });

  it("stops at the repository root, so a stray file above it is never used", async () => {
    const { parent, repo, deep } = tree();
    write(parent, "delivery.config.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(deep, repo)).toEqual({});
    expect(configCandidates(deep, repo).every((candidate) => candidate.startsWith(repo))).toBe(true);
  });

  it("is not an error when there is no config file at all", async () => {
    const { repo, deep } = tree();
    expect(await found(deep, repo)).toEqual({});
  });
});

describe("reading a config file", () => {
  it("reads a .js module's default export", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.js", 'export default { budgets: { correction: 5 } };\n');
    expect(await found(repo, repo)).toEqual({ budgets: { correction: 5 } });
  });

  it("reads a .mjs module's default export", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.mjs", 'export default { closer: { type: "merge-back" } };\n');
    expect(await found(repo, repo)).toEqual({ closer: { type: "merge-back" } });
  });

  it("refuses a .json file that is not JSON, naming the file", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", "{ not json");
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toContain(`I can't read ${file}: it isn't valid JSON`);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses an empty project description as it loads the file, with the configuration exit code", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ domain: "   " }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("takes a long description from a .js module, which is where a template literal goes", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.js", "export default { domain: `Two paragraphs.\n\nThe second one.` };\n");
    expect(await found(repo, repo)).toEqual({ domain: "Two paragraphs.\n\nThe second one." });
  });

  it("refuses a file whose contents the harness can't use, naming the setting", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ closr: 1 }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: there's no setting called \`closr\`. A config file takes only \`task\`, \`tasks\`, \`domain\`, \`roles\`, \`gate\`, \`closer\` and \`budgets\`.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses a list with an empty item as it loads the file, with the configuration exit code", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ tasks: ["add a page", ""] }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});

describe("naming a config file yourself", () => {
  it("uses the file --config names, wherever it is", async () => {
    const { parent, repo } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    write(parent, "elsewhere.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await loadConfig({ startDir: repo, repoPath: repo, flag: join(parent, "elsewhere.json"), env: {} })).toEqual({
      closer: { type: "merge-back" },
    });
  });

  it("resolves a relative --config against the folder the command was run from", async () => {
    const { repo, deep } = tree();
    write(deep, "elsewhere.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await loadConfig({ startDir: deep, repoPath: repo, flag: "elsewhere.json", env: {} })).toEqual({
      closer: { type: "merge-back" },
    });
  });

  it("uses DELIVERY_CONFIG when no --config is given", async () => {
    const { parent, repo } = tree();
    const file = write(parent, "from-env.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(repo, repo, { DELIVERY_CONFIG: file })).toEqual({ closer: { type: "merge-back" } });
  });

  it("lets --config beat DELIVERY_CONFIG", async () => {
    const { parent, repo } = tree();
    const fromEnv = write(parent, "from-env.json", JSON.stringify({ closer: { type: "merge-back" } }));
    const fromFlag = write(parent, "from-flag.json", JSON.stringify({ closer: { type: "open-pr" } }));
    expect(await loadConfig({ startDir: repo, repoPath: repo, flag: fromFlag, env: { DELIVERY_CONFIG: fromEnv } })).toEqual({
      closer: { type: "open-pr" },
    });
  });

  it("treats DELIVERY_CONFIG set to nothing as not set, and goes on looking", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    expect(await found(repo, repo, { DELIVERY_CONFIG: "" })).toEqual({ closer: { type: "open-pr" } });
  });

  it("refuses a named file that isn't there, rather than quietly falling back to discovery", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    const refusal = await refusalOf(loadConfig({ startDir: repo, repoPath: repo, flag: "missing.json", env: {} }));
    expect(refusal.message).toBe(NO_SUCH_CONFIG("missing.json"));
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});

describe("which config file a command means", () => {
  it("names the nearest file at or above the folder the command was run from", () => {
    const { repo, deep } = tree();
    const file = write(repo, "delivery.config.json", "{}");
    expect(findConfig({ startDir: deep, repoPath: repo, flag: undefined, env: {} })).toBe(realpathSync(file));
  });

  it("names nothing when there is no file, rather than inventing an empty one", () => {
    const { repo, deep } = tree();
    expect(findConfig({ startDir: deep, repoPath: repo, flag: undefined, env: {} })).toBeUndefined();
  });

  it("names the file --config points at, resolved against the folder the command was run from", () => {
    const { repo, deep } = tree();
    write(deep, "elsewhere.json", "{}");
    expect(findConfig({ startDir: deep, repoPath: repo, flag: "elsewhere.json", env: {} })).toBe(join(deep, "elsewhere.json"));
  });

  it("refuses a named file that isn't there", () => {
    const { repo } = tree();
    expect(() => findConfig({ startDir: repo, repoPath: repo, flag: "missing.json", env: {} })).toThrow(NO_SUCH_CONFIG("missing.json"));
  });
});

describe("every problem with a config file's shape, at once", () => {
  it("lists each problem with the setting it concerns, in the words the plain form uses for it alone", () => {
    expect(problemsFor({ domain: " ", tasks: ["add a page", ""] })).toEqual([
      { field: "tasks.1", message: `I can't use ${FILE}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.` },
      { field: "domain", message: `I can't use ${FILE}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.` },
    ]);
  });

  it("gives each unknown key its own problem, named at its place", () => {
    expect(problemsFor({ foo: 1, roles: { triage: {} } })).toEqual([
      {
        field: "roles.triage",
        message: `I can't use ${FILE}: \`roles\` has no role called \`triage\`. Only \`worker\` and \`gateMaintenance\` can be changed here, so remove it to keep the built-in one.`,
      },
      {
        field: "foo",
        message: `I can't use ${FILE}: there's no setting called \`foo\`. A config file takes only \`task\`, \`tasks\`, \`domain\`, \`roles\`, \`gate\`, \`closer\` and \`budgets\`.`,
      },
    ]);
    expect(problemsFor({ foo: 1, bar: 2 }).map((problem) => problem.field)).toEqual(["foo", "bar"]);
  });

  it("names no field for a file that is not an object of settings at all", () => {
    expect(problemsFor("add a page")).toEqual([
      {
        field: null,
        message: `I can't use ${FILE}: it should hold one object of settings, using \`task\`, \`tasks\`, \`domain\`, \`roles\`, \`gate\`, \`closer\` and \`budgets\`. A \`.js\` or \`.mjs\` file exports that object as its default.`,
      },
    ]);
  });

  it("keeps every problem of a written-out gate at its own path", () => {
    expect(problemsFor({ gate: { type: "command" } }).map((problem) => problem.field)).toEqual(["gate.command", "gate.parseMode"]);
  });
});

describe("checking a config file without refusing it", () => {
  function fileHolding(config: unknown): string {
    const file = join(mkdtempSync(join(tmpdir(), "check-config-")), "delivery.config.json");
    writeFileSync(file, JSON.stringify(config));
    return file;
  }

  it("returns the settings of a file with nothing wrong", async () => {
    expect(await checkConfig(fileHolding({ domain: "A tool." }))).toEqual({ ok: true, config: { domain: "A tool." } });
  });

  it("returns every problem of a file with several, the first being the one readConfig refuses with", async () => {
    const file = fileHolding({ domain: "", tasks: ["add a page", ""] });
    const checked = await checkConfig(file);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.problems.map((problem) => problem.field)).toEqual(["tasks.1", "domain"]);
    const refusal = await refusalOf(loadConfig({ startDir: dirname(file), repoPath: dirname(file), flag: file, env: {} }));
    expect(refusal.message).toBe(checked.problems[0]?.message);
  });
});
