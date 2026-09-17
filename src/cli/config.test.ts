import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configCandidates, DeliveryConfig, describeProblem, loadConfig, NO_SUCH_CONFIG, unknownCloser } from "./config.js";
import { EXIT, Refusal } from "./failures.js";

const FILE = "delivery.config.json";

/** The message the command would print for a config file it refuses. */
function problemFor(raw: unknown): string {
  const parsed = DeliveryConfig.safeParse(raw);
  if (parsed.success) throw new Error(`expected ${JSON.stringify(raw)} to be refused`);
  return describeProblem(FILE, parsed.error, raw);
}

describe("what a config file may contain", () => {
  it("accepts exactly task, domain, gate, closer and budgets, in the shapes the library already documents", () => {
    const config = {
      task: { intent: "add a function that says goodbye to a name, with a test" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back", deleteBranch: true },
      budgets: { correction: 5 },
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
});

describe("what it says about a file it can't use", () => {
  it("names an unknown top-level key, and what the file does take", () => {
    expect(problemFor({ closr: { type: "merge-back" } })).toBe(
      "I can't use delivery.config.json: there's no setting called `closr`. A config file takes only `task`, `domain`, `gate`, `closer` and `budgets`.",
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

  it("names a malformed value and the setting it belongs to", () => {
    expect(problemFor({ gate: { type: "command", command: "npm test", parseMode: "toml" } })).toContain(
      'I can\'t use delivery.config.json: the setting `gate.parseMode` is `"toml"`',
    );
  });

  it("names a setting given the wrong kind of value altogether", () => {
    expect(problemFor({ task: "add a goodbye function" })).toContain(
      'I can\'t use delivery.config.json: the setting `task` is `"add a goodbye function"`',
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

  it("still names a description given the wrong kind of value altogether, rather than calling it empty", () => {
    expect(problemFor({ domain: 42 })).toContain("I can't use delivery.config.json: the setting `domain` is `42`");
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
      `I can't use ${file}: there's no setting called \`closr\`. A config file takes only \`task\`, \`domain\`, \`gate\`, \`closer\` and \`budgets\`.`,
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
