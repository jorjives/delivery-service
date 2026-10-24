import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { cleanGitEnv } from "./git-env.js";
import { initTempRepo } from "./temp-repo.js";
import { DELIVERY_IGNORE, prepareDeliveryDir, prepareRunDir, repoKey, runIdFor, runPlace, runsRoot, stateHome, supervisedPlace, supervisedRunId } from "./run-location.js";
import { startedInstant } from "./run-records.js";

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

  it("gives a task the next free id when its first choice is taken, keeping the stamp last", () => {
    const first = runIdFor("add a thing", AT);
    expect(runIdFor("add a thing", AT, new Set([first]))).toBe("add-a-thing-2-20260914T210309Z");
    expect(runIdFor("add a thing", AT, new Set([first, "add-a-thing-2-20260914T210309Z"]))).toBe("add-a-thing-3-20260914T210309Z");
    expect(startedInstant("add-a-thing-2-20260914T210309Z")).toBe("2026-09-14T21:03:09Z");
  });

  it("keeps its first choice when nothing has taken it", () => {
    expect(runIdFor("add a thing", AT, new Set(["something-else-20260914T210309Z"]))).toBe(runIdFor("add a thing", AT));
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

describe("runsRoot", () => {
  it("is where every run's record in a repository lives", () => {
    expect(runsRoot("/tmp/project")).toBe("/tmp/project/.delivery/runs");
    expect(runPlace("/tmp/project", "add-a-thing-20260914T210309Z", {}).dir).toBe(
      join(runsRoot("/tmp/project"), "add-a-thing-20260914T210309Z"),
    );
  });
});

describe("prepareRunDir", () => {
  it("creates an empty record folder that git status does not report", async () => {
    const repo = initTempRepo("run-location-prepare-", { "a.txt": "a\n" });
    const { dir } = runPlace(repo, "add-a-thing-20260914T210309Z", { XDG_STATE_HOME: "/state" });

    await prepareRunDir(repo, dir);

    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(repo, ".delivery", ".gitignore"), "utf-8")).toBe(DELIVERY_IGNORE);
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

describe("the .delivery folder", () => {
  it("ignores the harness's own records but lets the backlog be tracked", async () => {
    const repo = initTempRepo("delivery-dir-", { "package.json": "{}" });
    await prepareDeliveryDir(repo);
    mkdirSync(join(repo, ".delivery", "runs", "r1"), { recursive: true });
    writeFileSync(join(repo, ".delivery", "runs", "r1", "case.json"), "{}");
    mkdirSync(join(repo, ".delivery", "backlog"), { recursive: true });
    writeFileSync(join(repo, ".delivery", "backlog", "20261016T090000Z-x.md"), "---\nstatus: open\n---\nx\n");

    expect(git(repo, ["status", "--porcelain", "--untracked-files=all"])).toBe("?? .delivery/backlog/20261016T090000Z-x.md");
  });

  it("ignores run state and working files but keeps the backlog, the added packs and their record", async () => {
    const repo = initTempRepo("ignore-packs-", { "a.js": "x\n" });
    await prepareDeliveryDir(repo);
    const ignored = (path: string): boolean => spawnSync("git", ["check-ignore", "-q", path], { cwd: repo, env: cleanGitEnv(process.env) }).status === 0;
    for (const kept of [".delivery/backlog/a.md", ".delivery/packs.lock.json", ".delivery/packs/docs-drift/pack.json", ".delivery/packs/docs-drift/fixtures/project/a.js"]) expect(ignored(kept), kept).toBe(false);
    for (const dropped of [".delivery/runs/x/case.json", ".delivery/packs/.staging/abc/pack.json", ".delivery/packs.lock.json.lock", ".delivery/last-report.txt"]) expect(ignored(dropped), dropped).toBe(true);
  });
});

describe("a run of several tasks at once", () => {
  it("is named by the UTC second it started", () => {
    expect(supervisedRunId(AT)).toBe("run-20260914T210309Z");
  });

  it("keeps its record beside the tasks' records, not among them", () => {
    expect(supervisedPlace("/repo", "run-20260914T210309Z")).toBe(join("/repo", ".delivery", "supervised", "run-20260914T210309Z"));
    expect(supervisedPlace("/repo", "run-x").startsWith(runsRoot("/repo"))).toBe(false);
  });
});

describe("a run record's folder permissions", () => {
  it("makes a run's record folder readable by its owner only, since it can hold a secret a review found", async () => {
    const repo = initTempRepo("run-dir-", { "a.js": "x\n" });
    const dir = join(runsRoot(repo), "fix-a-20261006T110000Z");
    await prepareRunDir(repo, dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
