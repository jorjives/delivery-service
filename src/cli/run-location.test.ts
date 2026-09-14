import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { initTempRepo } from "../temp-repo.js";
import { prepareRunDir, repoKey, runIdFor, runPlace, stateHome } from "./run-location.js";

const AT = new Date("2026-09-14T21:03:09.123Z");

describe("runIdFor", () => {
  it("is the first five words of the task, then the UTC second it started", () => {
    expect(runIdFor("Add a function that says hello to a name, with a test", AT)).toBe(
      "add-a-function-that-says-20260914T210309Z",
    );
  });

  it("keeps only letters and digits from the task, so the id is a safe branch name", () => {
    expect(runIdFor("Fix: the `login` page's 404!", AT)).toBe("fix-the-login-page-s-20260914T210309Z");
  });

  it("falls back to 'run' when the task has no letters or digits", () => {
    expect(runIdFor("!!!", AT)).toBe("run-20260914T210309Z");
  });

  it("gives the same task a new id a second later", () => {
    expect(runIdFor("add a thing", AT)).not.toBe(runIdFor("add a thing", new Date("2026-09-14T21:03:10.000Z")));
  });
});

describe("repoKey", () => {
  it("follows autoloop's target-key rule", () => {
    expect(repoKey("/home/dana/dev/my-app.v2")).toBe("home-dana-dev-my-app.v2");
    expect(repoKey("/home/dana/My Projects/app")).toBe("home-dana-My-Projects-app");
  });
});

describe("stateHome", () => {
  it("uses XDG_STATE_HOME when it is an absolute path", () => {
    expect(stateHome({ XDG_STATE_HOME: "/var/state" })).toBe("/var/state");
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is unset or relative", () => {
    expect(stateHome({})).toBe(join(homedir(), ".local", "state"));
    expect(stateHome({ XDG_STATE_HOME: "state" })).toBe(join(homedir(), ".local", "state"));
  });
});

describe("runPlace", () => {
  it("keeps the record inside the repository and the working copy under the state folder", () => {
    expect(runPlace("/home/dana/app", "add-a-thing-20260914T210309Z", { XDG_STATE_HOME: "/state" })).toEqual({
      dir: "/home/dana/app/.delivery/runs/add-a-thing-20260914T210309Z",
      location: {
        repoPath: "/home/dana/app",
        worktreePath: "/state/delivery-service/worktrees/home-dana-app/add-a-thing-20260914T210309Z",
      },
    });
  });
});

describe("prepareRunDir", () => {
  it("creates an empty record folder that git status does not report", async () => {
    const repo = initTempRepo("run-location-prepare-", { "a.txt": "a\n" });
    const { dir } = runPlace(repo, "add-a-thing-20260914T210309Z", { XDG_STATE_HOME: "/state" });

    await prepareRunDir(repo, dir);

    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(repo, ".delivery", ".gitignore"), "utf-8")).toBe("*\n");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() })).toBe("");
  });

  it("leaves the repository's own .gitignore alone", async () => {
    const repo = initTempRepo("run-location-own-ignore-", { ".gitignore": "node_modules/\n" });
    await prepareRunDir(repo, runPlace(repo, "x-20260914T210309Z", {}).dir);
    expect(readFileSync(join(repo, ".gitignore"), "utf-8")).toBe("node_modules/\n");
  });

  it("refuses to reuse a record folder that already exists", async () => {
    const repo = initTempRepo("run-location-exists-", { "a.txt": "a\n" });
    const { dir } = runPlace(repo, "x-20260914T210309Z", {});
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "case.json"), "{}");
    await expect(prepareRunDir(repo, dir)).rejects.toThrow(/EEXIST/);
    expect(readFileSync(join(dir, "case.json"), "utf-8")).toBe("{}");
  });
});
