import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { initTempRepo } from "../temp-repo.js";
import { EXIT, Refusal } from "./failures.js";
import { findRepository, hasUncommittedChanges, inferGate, NO_CHECK, NOT_A_REPOSITORY } from "./project.js";

const withTest = (test: string) => JSON.stringify({ name: "scratch", scripts: { test } });

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("findRepository", () => {
  it("finds the top of the repository from a folder inside it", async () => {
    const repo = initTempRepo("project-find-", { "README.md": "hi\n" });
    mkdirSync(join(repo, "src"));
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() }).trim();
    expect(await findRepository(join(repo, "src"))).toBe(top);
  });

  it("refuses a folder that is not a git repository, saying how to make it one", async () => {
    const refusal = await refusalOf(findRepository(mkdtempSync(join(tmpdir(), "project-not-repo-"))));
    expect(refusal.message).toBe(NOT_A_REPOSITORY);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses a folder that does not exist the same way", async () => {
    const refusal = await refusalOf(findRepository(join(tmpdir(), "project-no-such-folder-9f3a")));
    expect(refusal.message).toBe(NOT_A_REPOSITORY);
  });
});

describe("inferGate", () => {
  it("uses the package's test script, judged by exit code", async () => {
    const repo = initTempRepo("project-gate-", { "package.json": withTest("node --test") });
    expect(await inferGate(repo)).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
  });

  it.each([
    ["no package.json", {}],
    ["a package.json with no scripts", { "package.json": JSON.stringify({ name: "scratch" }) }],
    ["an empty test script", { "package.json": withTest("  ") }],
    ["npm init's always-failing placeholder", { "package.json": withTest('echo "Error: no test specified" && exit 1') }],
    ["a package.json that is not JSON", { "package.json": "{ not json" }],
  ])("refuses %s, naming the missing check", async (_label, files: Record<string, string>) => {
    const repo = initTempRepo("project-no-gate-", { "README.md": "hi\n", ...files });
    const refusal = await refusalOf(inferGate(repo));
    expect(refusal.message).toBe(NO_CHECK);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});

describe("hasUncommittedChanges", () => {
  it("is false for a clean repository", async () => {
    expect(await hasUncommittedChanges(initTempRepo("project-clean-", { "a.txt": "a\n" }))).toBe(false);
  });

  it("is true when a tracked file changed or a new file appeared", async () => {
    const edited = initTempRepo("project-edited-", { "a.txt": "a\n" });
    writeFileSync(join(edited, "a.txt"), "changed\n");
    expect(await hasUncommittedChanges(edited)).toBe(true);

    const added = initTempRepo("project-added-", { "a.txt": "a\n" });
    writeFileSync(join(added, "notes.txt"), "new\n");
    expect(await hasUncommittedChanges(added)).toBe(true);
  });
});
