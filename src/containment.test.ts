import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialCaseFile } from "./case-file.js";
import { DEFAULT_BUDGETS } from "./budgets.js";
import { containedSession } from "./containment.js";
import { cleanGitEnv } from "./git-env.js";
import type { CaseFileHeader, FenceRecord } from "./schema.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";

const headerWith = (fence: FenceRecord | undefined): CaseFileHeader => ({
  ...initialCaseFile({ surfaceId: "s", taskDef: { intent: "x" }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } }, DEFAULT_BUDGETS).header,
  ...(fence === undefined ? {} : { fence }),
});

describe("a contained session", () => {
  const repo = initTempRepo("containment-", { "a.txt": "a\n" });
  const place = (fence: FenceRecord | undefined) => ({
    header: headerWith(fence),
    repoPath: repo,
    dir: mkdtempSync(join(tmpdir(), "containment-run-")),
    worktreePath: "/elsewhere",
    env: { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "containment-state-")) },
  });

  it("starts its runtime through the fence when the run started with one", async () => {
    const session = await containedSession({ pathToClaudeCodeExecutable: "/opt/claude" }, place({ mode: "preferred", devices: [], state: { present: true } }));
    expect(session.pathToClaudeCodeExecutable).toMatch(/delivery-service\/fence\/[0-9a-f]{16}\.sh$/);
  });

  it("starts it as it is when the fence was absent or the record predates it", async () => {
    const absent: FenceRecord = { mode: "preferred", devices: [], state: { present: false, reason: "r" } };
    for (const fence of [absent, undefined]) {
      expect((await containedSession({ pathToClaudeCodeExecutable: "/opt/claude" }, place(fence))).pathToClaudeCodeExecutable).toBe("/opt/claude");
    }
  });

  it("points the project's git, and only the project's, at the run's hooks, which keep it to the task's branch", async () => {
    const at = place(undefined);
    const session = await containedSession({ pathToClaudeCodeExecutable: "/opt/claude", env: { PATH: process.env.PATH ?? "" } }, at);
    const file = join(at.dir, "hooks", "landing.gitconfig");
    expect(session.harnessEnv).toMatchObject({ GIT_CONFIG_KEY_0: `includeIf.gitdir:${realpathSync(join(repo, ".git"))}.path`, GIT_CONFIG_VALUE_0: file });
    expect(spawnSync("git", ["config", "--file", file, "--get", "core.hooksPath"], { env: cleanGitEnv(), encoding: "utf-8" }).stdout.trim()).toBe(join(at.dir, "hooks"));
    expect(readFileSync(join(at.dir, "hooks", "reference-transaction"), "utf-8")).toContain("'refs/heads/surface/s'");
  });

  it("points every remote's push address at a repository outside the run, so a push is refused with the sentence", async () => {
    const withOrigin = initTempRepo("containment-origin-", { "a.txt": "a\n" });
    addLocalOrigin(withOrigin);
    const at = { ...place(undefined), repoPath: withOrigin };
    await containedSession({ pathToClaudeCodeExecutable: "/opt/claude", env: { PATH: process.env.PATH ?? "" } }, at);
    const pushurl = spawnSync("git", ["config", "--file", join(at.dir, "hooks", "landing.gitconfig"), "--get", "remote.origin.pushurl"], { env: cleanGitEnv(), encoding: "utf-8" }).stdout.trim();
    expect(pushurl).toMatch(/landing-refused\.git$/);
    expect(pushurl.startsWith(at.dir)).toBe(false);
    expect(pushurl.startsWith(withOrigin)).toBe(false);
  });
});
