// Slice 9: Get Every Configuration Problem at Once, in a Form Scripts Can Read
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-23 against commit 98e6efa
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js) against a throwaway git repository.
// `validate` needs no agent, no credential and no network, with or without
// `--json`, so no scripted agent turn is involved here.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { READY, type Validation } from "../../src/cli/validate-command.js";
import { git, runDelivery, useScratch } from "../helpers.js";

const scratch = useScratch();

/** A throwaway git repository, seeded with the given `delivery.config.json` contents. */
function repoWith(config: unknown): string {
  const repo = scratch("uat-slice-9-");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample-project", version: "1.0.0", scripts: { test: "node --test" } }));
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config, null, 2));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

const CLEAN_CONFIG = {
  domain: "A small tool.",
  tasks: ["write the README", "add tests"],
  gate: { type: "test-runner" },
  closer: { type: "commit-to-branch" },
};

const TWO_MISTAKES_CONFIG = {
  domain: "",
  tasks: ["write the README", "   "],
  gate: { type: "test-runner" },
  closer: { type: "commit-to-branch" },
};

describe("UAT: get every configuration problem at once, in a form scripts can read", () => {
  it("shows one problem in plain language, and both problems, each with its field, as JSON", () => {
    // Step 1: two mistakes at once: an empty project description, and an empty second task.
    const repo = repoWith(TWO_MISTAKES_CONFIG);

    // Step 2: the plain form shows a single problem.
    const plain = runDelivery(["validate"], { cwd: repo });
    expect(plain.stderr.trimEnd()).toBe(
      `I can't use ${join(repo, "delivery.config.json")}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.`,
    );
    expect(plain.status).toBe(EXIT.configuration);

    // Step 3: the --json form lists both, each naming its field with the plain form's own wording.
    const asJson = runDelivery(["validate", "--json"], { cwd: repo });
    const validation = JSON.parse(asJson.stdout) as Validation;
    expect(validation.ready).toBe(false);
    expect(validation.problems).toEqual([
      {
        field: "tasks.1",
        message: `I can't use ${join(repo, "delivery.config.json")}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.`,
      },
      {
        field: "domain",
        message: `I can't use ${join(repo, "delivery.config.json")}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.`,
      },
    ]);
    // The first JSON problem is byte-for-byte the plain form's one line.
    expect(validation.problems[0]?.message).toBe(plain.stderr.trimEnd());
    expect(asJson.status).toBe(EXIT.configuration);
  });
});

describe("acceptance criteria", () => {
  it("gives --json and plain validate the same exit code, on both a broken and a clean configuration", () => {
    const broken = repoWith(TWO_MISTAKES_CONFIG);
    expect(runDelivery(["validate"], { cwd: broken }).status).toBe(runDelivery(["validate", "--json"], { cwd: broken }).status);

    const clean = repoWith(CLEAN_CONFIG);
    expect(runDelivery(["validate"], { cwd: clean }).status).toBe(runDelivery(["validate", "--json"], { cwd: clean }).status);
  });

  it("leaves validate's plain output unchanged: one problem, in plain language", () => {
    const repo = repoWith(TWO_MISTAKES_CONFIG);
    const { stdout, stderr, status } = runDelivery(["validate"], { cwd: repo });
    expect(stdout).toBe("Checking delivery.config.json…\n");
    expect(stderr.trimEnd()).toBe(
      `I can't use ${join(repo, "delivery.config.json")}: \`tasks\` item 2 is empty. Add a sentence describing what you want done, or remove it.`,
    );
    expect(status).toBe(EXIT.configuration);
  });

  it("gives a clean configuration a ready result with an empty problem list", () => {
    const repo = repoWith(CLEAN_CONFIG);
    const { stdout, status } = runDelivery(["validate", "--json"], { cwd: repo });
    const validation = JSON.parse(stdout) as Validation;
    expect(validation).toEqual({ ready: true, problems: [] });
    expect(status).toBe(EXIT.ok);

    const plain = runDelivery(["validate"], { cwd: repo });
    expect(plain.stdout).toContain(READY);
    expect(plain.status).toBe(EXIT.ok);
  });
});
