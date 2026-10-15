import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "./git-env.js";
import { landingBoundary, landingEnv, refusingRemote } from "./landing-boundary.js";
import { LANDING_BOUNDARY } from "./prompt-assembly.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";

const BRANCH = "surface/add-a-page";

/** A repository with an origin, and the task's working copy on its own branch: what a run sets up. */
function taskCopy(files: Record<string, string> = { "a.txt": "a\n" }) {
  const repo = initTempRepo("landing-", files);
  const origin = addLocalOrigin(repo);
  const worktree = join(mkdtempSync(join(tmpdir(), "landing-wt-")), "wt");
  spawnSync("git", ["worktree", "add", "-q", "-b", BRANCH, worktree], { cwd: repo, env: cleanGitEnv() });
  return { repo, origin, worktree, hooksDir: join(mkdtempSync(join(tmpdir(), "landing-run-")), "hooks"), env: { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "landing-state-")) } };
}

async function sessionGit(place: ReturnType<typeof taskCopy>, branch: string | null = BRANCH) {
  const env = { ...cleanGitEnv(), ...(await landingBoundary({ repoPath: place.repo, hooksDir: place.hooksDir, branch, base: cleanGitEnv(), env: place.env })) };
  return (cwd: string, args: string[]) => spawnSync("git", ["-c", "user.name=agent", "-c", "user.email=agent@example.invalid", ...args], { cwd, env, encoding: "utf-8" });
}

const head = (cwd: string, ref: string): string => spawnSync("git", ["rev-parse", ref], { cwd, env: cleanGitEnv(), encoding: "utf-8" }).stdout.trim();

describe("inside its own branch, a session keeps full git", () => {
  it("commits, stashes, rebases and reads history", async () => {
    const place = taskCopy();
    const run = await sessionGit(place);
    writeFileSync(join(place.worktree, "b.txt"), "b\n");
    expect(run(place.worktree, ["add", "b.txt"]).status).toBe(0);
    expect(run(place.worktree, ["commit", "-qm", "b"]).status).toBe(0);
    writeFileSync(join(place.worktree, "a.txt"), "changed\n");
    expect(run(place.worktree, ["stash"]).status).toBe(0);
    expect(run(place.worktree, ["stash", "pop"]).status).toBe(0);
    expect(run(place.worktree, ["checkout", "--", "a.txt"]).status).toBe(0);
    expect(run(place.worktree, ["rebase", "main"]).status).toBe(0);
    expect(run(place.worktree, ["log", "--oneline"]).stdout).toContain("b");
    // Spec §8: a fetch (remote-tracking refs) and a bisect (refs/bisect/*) also pass.
    expect(run(place.worktree, ["fetch", "-q", "origin"]).status).toBe(0);
    expect(run(place.worktree, ["bisect", "start", "HEAD", "main"]).status).toBe(0);
    expect(run(place.worktree, ["bisect", "reset"]).status).toBe(0);
  });
});

describe("a session that tries to land the work itself", () => {
  it.each([
    ["makes another branch", ["branch", "other"]],
    ["moves another branch's pointer", ["update-ref", "refs/heads/main", "HEAD"]],
    ["creates a tag", ["tag", "v1"]],
  ])("is refused when it %s, with the landing sentence", async (_, args) => {
    const place = taskCopy();
    const run = await sessionGit(place);
    // A commit of its own first, so every ref the session aims at would really move.
    writeFileSync(join(place.worktree, "b.txt"), "b\n");
    run(place.worktree, ["add", "b.txt"]);
    expect(run(place.worktree, ["commit", "-qm", "b"]).status).toBe(0);
    const before = head(place.repo, "main");
    const result = run(place.worktree, args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(LANDING_BOUNDARY);
    expect(head(place.repo, "main")).toBe(before);
  });

  it("is refused when it merges into the base branch from the main folder", async () => {
    const place = taskCopy();
    const run = await sessionGit(place);
    writeFileSync(join(place.worktree, "b.txt"), "b\n");
    run(place.worktree, ["add", "b.txt"]);
    run(place.worktree, ["commit", "-qm", "b"]);
    const before = head(place.repo, "main");
    const merged = run(place.repo, ["merge", "--ff-only", BRANCH]);
    expect(merged.status).not.toBe(0);
    // The slice's acceptance criterion: refused with the plain sentence.
    expect(merged.stderr).toContain(LANDING_BOUNDARY);
    expect(head(place.repo, "main")).toBe(before);
  });

  it.each([[[]], [["--no-verify"]]])("is refused when it pushes, %j", async (flags) => {
    const place = taskCopy();
    const run = await sessionGit(place);
    const result = run(place.worktree, ["push", ...flags, "origin", BRANCH]);
    expect(result.status).not.toBe(0);
    // The slice's acceptance criterion: refused with the plain sentence, not a transport error.
    expect(result.stderr).toContain(LANDING_BOUNDARY);
    expect(result.stderr).not.toContain("does not appear to be a git repository");
    expect(spawnSync("git", ["rev-parse", "--verify", "-q", `refs/heads/${BRANCH}`], { cwd: place.origin, env: cleanGitEnv() }).status).not.toBe(0);
  });

  it("is refused by the pre-push hook when it pushes to the remote's address typed out, unless it skips hooks", async () => {
    const place = taskCopy();
    const run = await sessionGit(place);
    const result = run(place.worktree, ["push", place.origin, BRANCH]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(LANDING_BOUNDARY);
    // ponytail: the same push with --no-verify is not caught here (a ceiling, recorded in the plan's Scaffolding Impact).
  });

  it("may move no branch at all from a detached copy, though it may still commit there", async () => {
    const place = taskCopy();
    const run = await sessionGit(place, null);
    const before = head(place.repo, BRANCH);
    expect(run(place.worktree, ["checkout", "-q", "--detach"]).status).toBe(0);
    writeFileSync(join(place.worktree, "c.txt"), "c\n");
    run(place.worktree, ["add", "c.txt"]);
    expect(run(place.worktree, ["commit", "-qm", "c"]).status).toBe(0);
    // update-ref, not `branch -f`: git itself already refuses to force a branch a working copy has checked out.
    const moved = run(place.worktree, ["update-ref", `refs/heads/${BRANCH}`, "HEAD"]);
    expect(moved.status).not.toBe(0);
    expect(moved.stderr).toContain(LANDING_BOUNDARY);
    expect(head(place.repo, BRANCH)).toBe(before);
  });
});

describe("the project's own hooks", () => {
  it("still run, from the shared git folder", async () => {
    const place = taskCopy();
    const marker = join(place.repo, "..", `ran-${Date.now()}`);
    writeFileSync(join(place.repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(join(place.repo, ".git", "hooks", "pre-commit"), 0o755);
    const run = await sessionGit(place);
    writeFileSync(join(place.worktree, "b.txt"), "b\n");
    run(place.worktree, ["add", "b.txt"]);
    expect(run(place.worktree, ["commit", "-qm", "b"]).status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it("still run from a relative core.hooksPath, resolved in the working copy, and can still refuse", async () => {
    const place = taskCopy({ "a.txt": "a\n", ".githooks/pre-commit": "#!/bin/sh\necho 'project says no' >&2\nexit 1\n" });
    chmodSync(join(place.worktree, ".githooks", "pre-commit"), 0o755);
    spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: place.repo, env: cleanGitEnv() });
    const run = await sessionGit(place);
    writeFileSync(join(place.worktree, "b.txt"), "b\n");
    run(place.worktree, ["add", "b.txt"]);
    const result = run(place.worktree, ["commit", "-qm", "b"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("project says no");
  });
});

describe("the refusing remote", () => {
  it("is a bare repository outside the project, made once, whose own hook says the sentence", async () => {
    const place = taskCopy();
    const first = await refusingRemote(place.env);
    expect(await refusingRemote(place.env)).toBe(first);
    expect(first.startsWith(place.repo)).toBe(false);
    const hook = spawnSync(join(first, "hooks", "pre-receive"), { encoding: "utf-8" });
    expect(hook.status).toBe(1);
    expect(hook.stderr).toContain(LANDING_BOUNDARY);
    expect(spawnSync("git", ["rev-parse", "--is-bare-repository"], { cwd: first, env: cleanGitEnv(), encoding: "utf-8" }).stdout.trim()).toBe("true");
  });

  it("refuses with the sentence by the repository's own hook, whatever git settings the pushing process carries", async () => {
    const place = taskCopy();
    const refusing = await refusingRemote(place.env);
    spawnSync("git", ["remote", "set-url", "--push", "origin", refusing], { cwd: place.repo, env: cleanGitEnv() });
    const result = spawnSync("git", ["push", "--no-verify", "origin", BRANCH], { cwd: place.worktree, env: cleanGitEnv(), encoding: "utf-8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(LANDING_BOUNDARY);
  });
});

describe("the session's git settings", () => {
  it("are added after any already in its environment, and include the hooks and push addresses for the project only", async () => {
    const place = taskCopy();
    mkdirSync(place.hooksDir, { recursive: true });
    const refusing = await refusingRemote(place.env);
    const env = await landingEnv(place.repo, place.hooksDir, refusing, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Operator" });
    const file = join(place.hooksDir, "landing.gitconfig");
    const common = realpathSync(join(place.repo, ".git"));
    expect(env).toEqual({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_1: `includeIf.gitdir:${common}.path`,
      GIT_CONFIG_VALUE_1: file,
      GIT_CONFIG_KEY_2: `includeIf.gitdir:${common}/worktrees/*.path`,
      GIT_CONFIG_VALUE_2: file,
    });
    const setting = (key: string) => spawnSync("git", ["config", "--file", file, "--get", key], { env: cleanGitEnv(), encoding: "utf-8" }).stdout.trim();
    expect(setting("core.hooksPath")).toBe(place.hooksDir);
    expect(setting("remote.origin.pushurl")).toBe(refusing);
  });

  it("leave the operator's own git alone", async () => {
    // Spec §8: without the session environment, the same repository accepts every one of them.
    const place = taskCopy();
    await sessionGit(place);
    const own = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, env: cleanGitEnv() }).status;
    expect(own(place.worktree, ["branch", "other"])).toBe(0);
    expect(own(place.worktree, ["tag", "v1"])).toBe(0);
    expect(own(place.repo, ["update-ref", "refs/heads/other", "HEAD"])).toBe(0);
    expect(own(place.worktree, ["push", "-q", "origin", BRANCH])).toBe(0);
  });
});

describe("another repository the session's processes touch", () => {
  // A temp repository made by the project's own test suite, a dependency clone, a scratch repository: none is the project.
  function elsewhere() {
    const repo = initTempRepo("landing-elsewhere-", { "x.txt": "x\n" });
    return { repo, origin: addLocalOrigin(repo) };
  }

  it("makes branches and tags there, and pushes them to that repository's own origin", async () => {
    const run = await sessionGit(taskCopy());
    const other = elsewhere();
    expect(run(other.repo, ["branch", "other"]).status).toBe(0);
    expect(run(other.repo, ["checkout", "-q", "-b", "topic"]).status).toBe(0);
    expect(run(other.repo, ["tag", "v1"]).status).toBe(0);
    const pushed = run(other.repo, ["push", "origin", "topic", "v1"]);
    expect(pushed.status).toBe(0);
    expect(pushed.stderr).not.toContain(LANDING_BOUNDARY);
    expect(head(other.origin, "refs/heads/topic")).toBe(head(other.repo, "topic"));
    expect(head(other.origin, "refs/tags/v1")).toBe(head(other.repo, "v1"));
  });

  it("commits there with that repository's own hooks, never the project's", async () => {
    const place = taskCopy();
    const markers = mkdtempSync(join(tmpdir(), "landing-markers-"));
    const hook = (repo: string, marker: string, exit: number) => {
      writeFileSync(join(repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch '${join(markers, marker)}'\nexit ${exit}\n`);
      chmodSync(join(repo, ".git", "hooks", "pre-commit"), 0o755);
    };
    hook(place.repo, "project", 1);
    const run = await sessionGit(place);
    const other = elsewhere();
    hook(other.repo, "own", 0);
    writeFileSync(join(other.repo, "y.txt"), "y\n");
    run(other.repo, ["add", "y.txt"]);
    expect(run(other.repo, ["commit", "-qm", "y"]).status).toBe(0);
    expect(existsSync(join(markers, "own"))).toBe(true);
    expect(existsSync(join(markers, "project"))).toBe(false);
  });

  it("carries none of the project's settings, though it sits inside the task's working copy", async () => {
    const place = taskCopy();
    const run = await sessionGit(place);
    const nested = join(place.worktree, "scratch");
    expect(run(place.worktree, ["init", "-q", "-b", "main", nested]).status).toBe(0);
    expect(run(nested, ["config", "--get", "core.hooksPath"]).status).toBe(1);
    expect(run(nested, ["commit", "-q", "--allow-empty", "-m", "n"]).status).toBe(0);
    expect(run(nested, ["tag", "n1"]).status).toBe(0);
  });
});
