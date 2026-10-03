import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git-exec.js";
import { captureRepair, checkFilesOf, PATCH_CAP_BYTES } from "./repair-changes.js";
import { initTempRepo } from "./temp-repo.js";

const where = (repoPath: string) => ({ repoPath, worktreePath: repoPath });

describe("which files the check runs", () => {
  it("is a custom check's module, relative to the repository", () => {
    expect(checkFilesOf({ type: "custom", modulePath: "./check.mjs" }, where("/repo"))).toEqual(["check.mjs"]);
    expect(checkFilesOf({ type: "custom", modulePath: "/repo/gates/shared.mjs" }, where("/repo"))).toEqual(["gates/shared.mjs"]);
  });

  it("is a command's first word, taken as a path in the working copy", () => {
    expect(checkFilesOf({ type: "command", command: "./scripts/check.sh --fast", parseMode: "exitcode" }, where("/repo"))).toEqual(["scripts/check.sh"]);
    expect(checkFilesOf({ type: "command", command: "npm test", parseMode: "exitcode" }, where("/repo"))).toEqual(["npm"]);
  });

  it("is nothing for a check that lives outside the repository", () => {
    expect(checkFilesOf({ type: "custom", modulePath: "../elsewhere/check.mjs" }, where("/repo"))).toEqual([]);
  });
});

describe("capturing what a repair changed", () => {
  it("lists an edited tracked file and a newly added one, with counts and patches, the new file in full", async () => {
    const repo = initTempRepo("capture-both-", { "a.txt": "one\n", "check.mjs": "export default 1;\n" });

    const { result, changes } = await captureRepair(repo, ["check.mjs"], async () => {
      writeFileSync(join(repo, "check.mjs"), "export default 2;\n");
      mkdirSync(join(repo, "shared"));
      writeFileSync(join(repo, "shared/helper.json"), '{ "command": "npm" }\n');
      return "done";
    });

    expect(result).toBe("done");
    expect(changes?.truncated).toBe(false);
    expect(changes?.files.map((file) => ({ ...file, patch: undefined }))).toEqual([
      { path: "check.mjs", status: "modified", added: 1, removed: 1, touchesCheck: true },
      { path: "shared/helper.json", status: "added", added: 1, removed: 0, touchesCheck: false },
    ]);
    expect(changes?.files[1]?.patch).toContain('+{ "command": "npm" }');
    expect(changes?.files[0]?.patch).toContain("-export default 1;");
  });

  it("leaves out what was already in the working copy before the repair started", async () => {
    const repo = initTempRepo("capture-before-", { "a.txt": "one\n" });
    writeFileSync(join(repo, "worker.txt"), "the task's own work\n");

    const { changes } = await captureRepair(repo, [], async () => writeFileSync(join(repo, "fix.txt"), "fixed\n"));

    expect(changes?.files.map((file) => file.path)).toEqual(["fix.txt"]);
  });

  it("records a deleted file", async () => {
    const repo = initTempRepo("capture-deleted-", { "a.txt": "one\ntwo\n" });

    const { changes } = await captureRepair(repo, [], async () => rmSync(join(repo, "a.txt")));

    expect(changes?.files.map((file) => ({ ...file, patch: undefined }))).toEqual([{ path: "a.txt", status: "deleted", added: 0, removed: 2, touchesCheck: false }]);
  });

  it("records a repair that changed nothing as no files", async () => {
    const repo = initTempRepo("capture-empty-", { "a.txt": "one\n" });

    expect((await captureRepair(repo, [], async () => undefined)).changes).toEqual({ files: [], truncated: false });
  });

  it("keeps a binary file's name and status but no patch, and says the patch was not kept", async () => {
    const repo = initTempRepo("capture-binary-", { "a.txt": "one\n" });

    const { changes } = await captureRepair(repo, [], async () => writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2, 0])));

    expect(changes).toEqual({ files: [{ path: "blob.bin", status: "added", added: 0, removed: 0, touchesCheck: false }], truncated: true });
  });

  it("keeps no patch for a file past the size kept, and still keeps a small one after it", async () => {
    const repo = initTempRepo("capture-cap-", { "a.txt": "one\n" });
    const big = `${"x".repeat(99)}\n`.repeat(Math.ceil(PATCH_CAP_BYTES / 100) + 10);

    const { changes } = await captureRepair(repo, [], async () => {
      writeFileSync(join(repo, "a-big.txt"), big);
      writeFileSync(join(repo, "b-small.txt"), "small\n");
    });

    expect(changes?.truncated).toBe(true);
    expect(changes?.files[0]).toMatchObject({ path: "a-big.txt", status: "added", added: big.split("\n").length - 1 });
    expect(changes?.files[0]?.patch).toBeUndefined();
    expect(changes?.files[1]?.patch).toContain("+small");
  });

  it("stages and commits nothing: the working copy is exactly as the repair left it", async () => {
    const repo = initTempRepo("capture-readonly-", { "a.txt": "one\n" });
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const index = readFileSync(join(repo, ".git/index"));

    await captureRepair(repo, [], async () => {
      writeFileSync(join(repo, "a.txt"), "two\n");
      writeFileSync(join(repo, "new.txt"), "new\n");
    });

    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect(readFileSync(join(repo, ".git/index"))).toEqual(index);
    expect(await git(repo, ["status", "--porcelain"])).toBe("M a.txt\n?? new.txt");
  });

  it("still runs the session, and records nothing, where git cannot read the working copy", async () => {
    const notARepo = join(mkdtempSync(join(tmpdir(), "capture-none-")), "wt");
    const inside = initTempRepo("capture-sub-", { "a.txt": "x\n" });
    mkdirSync(join(inside, "sub"));

    expect(await captureRepair(notARepo, [], async () => "ran")).toEqual({ result: "ran", changes: undefined });
    // A folder below the top of a working copy is not one: git would describe the whole copy.
    expect((await captureRepair(join(inside, "sub"), [], async () => "ran")).changes).toBeUndefined();
  });

  it("passes on a session that fails", async () => {
    const repo = initTempRepo("capture-throws-", { "a.txt": "one\n" });

    await expect(captureRepair(repo, [], () => Promise.reject(new Error("no session")))).rejects.toThrow("no session");
  });
});
