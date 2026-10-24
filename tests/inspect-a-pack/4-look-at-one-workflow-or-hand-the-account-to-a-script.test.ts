// Slice 4: Look at one workflow, or hand the account to a script
// Source: docs/superpowers/specs/2026-10-23-inspect-a-pack-slices.md
// Recorded: 2026-10-24 against commit 72fdb72
//
// Drives the compiled `delivery packs inspect` command as a real subprocess (tests/helpers.ts's
// runDelivery), in a throwaway git repository. Asserts on stable phrases, exit codes and JSON keys,
// not full-output equality.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INSPECT_RULE } from "../../src/cli/packs-inspect-render.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { runDelivery } from "../helpers.js";

const project = initTempRepo("uat-inspect-4-", { "package.json": '{"name":"p"}\n', "a.js": "x\n" });
const inspect = (...args: string[]) => runDelivery(["packs", "inspect", "deprecations", ...args], { cwd: project });
const flat = (text: string): string => text.replace(/\s+/g, " ");
interface Account {
  schema: string;
  ok: boolean;
  pack: { hash: string; summary: string };
  workflows: { name: string; local: string; steps: { instructions: { authored: string } }[] }[];
  problems: { field: string; message: string }[];
  findings?: unknown;
}
const parse = (stdout: string) => JSON.parse(stdout) as Account;

const one = inspect("--workflow", "tests");
const whole = inspect();
const json = inspect("--json");
const oneJson = inspect("--workflow", "tests", "--json");
const unknown = inspect("--workflow", "nope");
const unknownJson = inspect("--workflow", "nope", "--json");
const schema = runDelivery(["packs", "inspect", "--schema"], { cwd: project });

describe("UAT: look at only the tests workflow of the deprecations pack", () => {
  it("shows the pack identity, the standing notices and the workflow's limits", () => {
    expect(one.status).toBe(0);
    expect(one.stderr).toBe("");
    expect(one.stdout.split("\n")[0]).toBe("Pack: Move off deprecated code");
    const text = flat(one.stdout);
    expect(text).toContain("Fingerprint, which changes if any instruction changes");
    expect(text).toContain("Does it widen what the agent may do?");
    expect(text).toContain("The instructions themselves are not analysed, so read them");
    expect(text).toContain("Lands without asking you again, once you have approved the idea");
  });

  it("shows the workflow's instructions in full and drops the others", () => {
    expect(one.stdout).toContain("Instructions for tests");
    expect(one.stdout).toContain("# Move one test file off deprecated code");
    expect(one.stdout).toContain("Never delete or skip a test.");
    expect(one.stdout).not.toContain("Instructions for scan");
    expect(one.stdout).not.toContain("Instructions for code");
    expect(one.stdout.split(INSPECT_RULE).length - 1).toBe(2);
  });

  it("is shorter than the account of the whole pack", () => {
    expect(whole.stdout).toContain("Instructions for scan");
    expect(one.stdout.length).toBeLessThan(whole.stdout.length);
  });
});

describe("UAT: the machine-readable account", () => {
  it("returns a document with the version, the fingerprint and the raw instruction text", () => {
    expect(json.status).toBe(0);
    expect(json.stderr).toBe("");
    const doc = parse(json.stdout);
    expect(doc.schema).toBe("delivery.pack-inspection/1");
    expect(doc.ok).toBe(true);
    expect(doc.pack.hash).toMatch(/^[0-9a-f]{64}$/);
    const tests = doc.workflows.find((w) => w.name === "deprecations:tests");
    expect(tests?.steps[0]?.instructions.authored).toContain("# Move one test file off deprecated code");
  });

  it("carries the same facts as the plain account", () => {
    const doc = parse(json.stdout);
    const hash: string = doc.pack.hash;
    const text = whole.stdout.replace(/\s+/g, "");
    expect(text).toContain(hash);
    expect(flat(whole.stdout)).toContain(doc.pack.summary);
    expect(doc.workflows.map((w) => w.local)).toEqual(["scan", "code", "tests"]);
  });

  it("with one workflow named, keeps only that workflow and the same fingerprint", () => {
    const doc = parse(oneJson.stdout);
    expect(oneJson.status).toBe(0);
    expect(doc.workflows.map((w) => w.name)).toEqual(["deprecations:tests"]);
    expect(doc.pack.hash).toBe(parse(json.stdout).pack.hash);
  });
});

describe("UAT: an unknown workflow name", () => {
  it("is refused plainly, listing the real workflow names", () => {
    expect(unknown.status).not.toBe(0);
    expect(flat(unknown.stdout + unknown.stderr)).toContain('There is no workflow called "nope" in the deprecations pack. Its workflows are: scan, code, tests.');
  });

  it("is refused in the machine-readable form as ok false with each problem and the same exit code", () => {
    expect(unknownJson.status).toBe(unknown.status);
    const doc = parse(unknownJson.stdout);
    expect(doc.schema).toBe("delivery.pack-inspection/1");
    expect(doc.ok).toBe(false);
    expect(doc.problems).toHaveLength(1);
    expect(doc.problems[0]?.field).toBe("workflow");
    expect(doc.problems[0]?.message).toContain("Its workflows are: scan, code, tests.");
  });
});

describe("AC: the published schema", () => {
  it("is printed as JSON Schema naming the version", () => {
    expect(schema.status).toBe(0);
    expect(JSON.parse(schema.stdout).$schema).toContain("json-schema.org");
    expect(schema.stdout).toContain("delivery.pack-inspection/1");
  });

  it("validates the account, the one-workflow account and a refusal", () => {
    const published = z.fromJSONSchema(JSON.parse(schema.stdout));
    for (const out of [json.stdout, oneJson.stdout, unknownJson.stdout]) {
      expect(published.safeParse(parse(out)).error).toBeUndefined();
    }
  });

  it("allows a key added within the version, and refuses a removed key", () => {
    const published = z.fromJSONSchema(JSON.parse(schema.stdout));
    const doc = parse(json.stdout);
    expect(published.safeParse({ ...doc, addedLater: 1 }).success).toBe(true);
    expect(published.safeParse({ ...doc, findings: undefined }).success).toBe(false);
  });
});

describe("AC: determinism", () => {
  it("gives identical output on a second run, in both forms and for one workflow", () => {
    expect(inspect().stdout).toBe(whole.stdout);
    expect(inspect("--workflow", "tests").stdout).toBe(one.stdout);
    expect(inspect("--json").stdout).toBe(json.stdout);
    expect(inspect("--workflow", "tests", "--json").stdout).toBe(oneJson.stdout);
  });
});
