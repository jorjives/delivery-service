import { describe, expect, it } from "vitest";
import { DeliveryConfig, describeProblem, unknownCloser } from "./config.js";

const FILE = "delivery.config.json";

/** The message the command would print for a config file it refuses. */
function problemFor(raw: unknown): string {
  const parsed = DeliveryConfig.safeParse(raw);
  if (parsed.success) throw new Error(`expected ${JSON.stringify(raw)} to be refused`);
  return describeProblem(FILE, parsed.error, raw);
}

describe("what a config file may contain", () => {
  it("accepts exactly task, gate, closer and budgets, in the shapes the library already documents", () => {
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
      "I can't use delivery.config.json: there's no setting called `closr`. A config file takes only `task`, `gate`, `closer` and `budgets`.",
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
