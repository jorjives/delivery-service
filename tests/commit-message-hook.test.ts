// A commit message whose body starts on the line after the subject makes git
// fold the whole body into the subject, so `git log --oneline` shows a paragraph.
// The `commit-msg` hook refuses such a message where it is written. These tests
// commit through the real hook, so its name and executable bit are held too.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { initTempRepo } from "../src/temp-repo.js";
import { git, REPO_ROOT } from "./helpers.js";

const repo = initTempRepo("commit-msg-hook-", { "seed.txt": "hello\n" });
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function commit(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    "git",
    ["-c", `core.hooksPath=${join(REPO_ROOT, ".githooks")}`, "commit", "--allow-empty", ...args],
    { cwd: repo, encoding: "utf-8", env: { ...cleanGitEnv(), ...env } },
  );
}

const subjects = () => git(repo, ["log", "--format=%s"]).split("\n");

describe("the commit-msg hook", () => {
  it("refuses a body that starts on the line after the subject, and says why", () => {
    const result = commit(["-m", "Add a thing\nbecause it was missing\nCo-Authored-By: A <a@example.invalid>"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("blank line after the subject");
    expect(subjects()).toEqual(["seed"]);
  });

  it("accepts a subject on its own", () => {
    expect(commit(["-m", "Add a thing"]).status).toBe(0);
    expect(subjects()[0]).toBe("Add a thing");
  });

  it("accepts a subject, a blank line, then a body", () => {
    expect(commit(["-m", "Add another thing\n\nbecause it was missing\nand wanted"]).status).toBe(0);
    expect(subjects()[0]).toBe("Add another thing");
  });

  it("accepts a subject typed above the editor's comments and a verbose diff", () => {
    writeFileSync(join(repo, "seed.txt"), "hello again\n");
    git(repo, ["add", "seed.txt"]);

    const result = commit(["--verbose"], { GIT_EDITOR: "sed -i '1s/^/Add a third thing/'" });

    expect(result.status).toBe(0);
    expect(subjects()[0]).toBe("Add a third thing");
  });

  it("is installed by `npm install`, which points git at the hooks directory", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.prepare).toBe("git config core.hooksPath .githooks");
  });
});
