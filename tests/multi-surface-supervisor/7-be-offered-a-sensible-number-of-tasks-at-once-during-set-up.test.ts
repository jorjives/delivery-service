// Slice 7: Be Offered a Sensible Number of Tasks at Once During Set-Up
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-10-01 against commit a7c52ad
//
// `delivery init`'s questions cannot be driven through a real terminal here (no
// pty), so, as tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts
// does, this drives `initCommand` through its `Ask` seam with a scripted person,
// against a real sample-project copy. Whether a written (or hand-typed) setting is
// one `delivery validate` accepts is proved with a genuine subprocess over the
// compiled dist/cli/main.js (tests/helpers.ts's runDelivery).

import { describe, expect, it } from "vitest";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { context, scriptedAsk } from "../../src/cli/init-fixtures.js";
import { CONFIG_FILE, initCommand, SUGGESTED_AT_ONCE } from "../../src/cli/init.js";
import { git, REPO_ROOT, runDelivery, useScratch } from "../helpers.js";

const scratch = useScratch();

function sampleProjectCopy(): string {
  const repo = scratch("uat-slice-7-sample-");
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

const THREE = ["say hello", "say goodbye", "say thanks"];
// description (Enter), check (Enter), then the tasks, then Enter to finish.
const texts = (tasks: string[], ...afterTasks: (string | undefined)[]) => [undefined, undefined, ...tasks, undefined, ...afterTasks];

const written = (repo: string): Record<string, unknown> => JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"));
const validate = (repo: string) => runDelivery(["validate"], { cwd: repo, env: { ...process.env } });

describe("UAT: decide during set-up whether tasks run at the same time, with a safe suggestion", () => {
  it("explains the trade-off, suggests a number, and writes it once accepted; declining leaves it out", async () => {
    const repo = sampleProjectCopy();

    // Enter three tasks; accept the suggested number (Enter at "how many").
    const accepted = scriptedAsk({ texts: texts(THREE), confirm: true });
    expect(await initCommand({}, context(repo).ctx, accepted.ask)).toBe(EXIT.ok);

    const question = accepted.asked.find((q) => "default" in q && typeof q.default === "boolean");
    expect(question?.message).toContain("at the same time");
    expect(question?.message).toContain("costs more");
    expect(question?.message).toContain("working copy");
    expect(question?.message).toContain(`${SUGGESTED_AT_ONCE} at once`);

    expect(written(repo)).toMatchObject({ tasks: THREE, concurrency: SUGGESTED_AT_ONCE });
    expect(validate(repo).status).toBe(EXIT.ok);

    // Run init again, replace the file, and decline.
    const declined = scriptedAsk({ texts: texts(THREE), confirms: [true, false] });
    expect(await initCommand({}, context(repo).ctx, declined.ask)).toBe(EXIT.ok);
    expect(written(repo)).toMatchObject({ tasks: THREE });
    expect(written(repo)).not.toHaveProperty("concurrency");
  });
});

describe("AC: with one task or none, init does not ask", () => {
  it("asks nothing about running at once when one task is entered", async () => {
    const repo = sampleProjectCopy();
    const { ask, asked } = scriptedAsk({ texts: texts(["say hello"]), confirm: true });
    expect(await initCommand({}, context(repo).ctx, ask)).toBe(EXIT.ok);

    expect(asked.some((q) => q.message.includes("at the same time"))).toBe(false);
    expect(written(repo)).not.toHaveProperty("concurrency");
  });
});

describe("AC: a value typed in place of the suggestion is checked with the rule validate uses", () => {
  it("refuses what validate refuses, takes what validate accepts, and writes the typed number", async () => {
    const bad = ["0", "2.5", "two", "-1"];
    const repo = sampleProjectCopy();

    // Each bad value is refused by the question, then 4 is typed and taken.
    const { ask, refused } = scriptedAsk({ texts: texts(THREE, ...bad, "4"), confirm: true });
    expect(await initCommand({}, context(repo).ctx, ask)).toBe(EXIT.ok);
    expect(refused).toHaveLength(bad.length);

    expect(written(repo)).toMatchObject({ concurrency: 4 });
    expect(validate(repo).status).toBe(EXIT.ok);

    // The same refused values, put in the file by hand, are refused by validate too.
    for (const value of ["0", 2.5, "two", -1]) {
      writeFileSync(CONFIG_FILE(repo), JSON.stringify({ ...written(repo), concurrency: value }));
      expect(validate(repo).status, `concurrency ${JSON.stringify(value)}`).not.toBe(EXIT.ok);
    }
  });
});
