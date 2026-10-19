import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { NO_IDEAS, notAnIdea, PUSH_FIRST, uncommittedItems, unknownFixWorkflow } from "./backlog-commands.js";

const TOTAL = "20261019T120000Z-total-below-zero.md";
const SETTINGS = "20261019T120100Z-settings-error.md";
const idea = (title: string, workflow = "fix") => `---\nstatus: idea\nworkflow: ${workflow}\nseverity: medium\ncheck:\n  kind: anchor-gone\n  path: total.js\n  anchor: "return price - discount;"\n---\n# ${title}\n`;
const CONFIG = JSON.stringify({ workflows: { fix: { steps: [{ name: "fix", prompt: "fix it" }] } } });
const project = () =>
  initTempRepo("choose-", { "delivery.config.json": CONFIG, "total.js": "return price - discount;\n", [`.delivery/backlog/${TOTAL}`]: idea("The total can go below zero"), [`.delivery/backlog/${SETTINGS}`]: idea("A broken settings file gives an unhelpful error") });
const statusOf = (repo: string, file: string) => /status: (\w+)/.exec(git(repo, ["show", `HEAD:.delivery/backlog/${file}`]))?.[1];

describe("delivery approve", () => {
  it("opens the named ideas in one commit of only those files, and says what runs next", async () => {
    const repo = project();
    const { exitCode, stdout } = await delivery(["approve", "total-below-zero"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(statusOf(repo, TOTAL)).toBe("open");
    expect(statusOf(repo, SETTINGS)).toBe("idea");
    expect(git(repo, ["show", "--name-only", "--format=", "HEAD"]).trim()).toBe(`.delivery/backlog/${TOTAL}`);
    expect(stdout).toContain("Approved 1 idea for fixing: The total can go below zero.");
    expect(stdout).toContain("delivery run --sources");
  });

  it("tells the owner to push first when the backlog is read from origin, and not otherwise", async () => {
    const repo = project();
    expect((await delivery(["approve", "total-below-zero"], { cwd: repo })).stdout).not.toContain(PUSH_FIRST);
    const clone = mkdtempSync(join(tmpdir(), "choose-clone-"));
    git(clone, ["clone", "-q", repo, "."]);
    expect((await delivery(["approve", "settings-error"], { cwd: clone })).stdout).toContain(PUSH_FIRST);
  });

  it("opens every idea with --all", async () => {
    const repo = project();
    expect((await delivery(["approve", "--all"], { cwd: repo })).exitCode).toBe(EXIT.ok);
    expect([statusOf(repo, TOTAL), statusOf(repo, SETTINGS)]).toEqual(["open", "open"]);
  });

  it("refuses an item that is not an idea, one with uncommitted changes, and one whose workflow is unknown, changing nothing", async () => {
    const repo = project();
    await delivery(["approve", "total-below-zero"], { cwd: repo });
    expect((await delivery(["approve", "total-below-zero"], { cwd: repo })).stderr).toContain(notAnIdea(TOTAL, "open"));
    writeFileSync(join(repo, ".delivery/backlog", SETTINGS), idea("Edited by hand"));
    expect((await delivery(["approve", "settings-error"], { cwd: repo })).stderr).toContain(uncommittedItems([`.delivery/backlog/${SETTINGS}`]));
    git(repo, ["checkout", "--", "."]);
    const other = initTempRepo("choose-unknown-", { [`.delivery/backlog/${TOTAL}`]: idea("x", "nowhere:fix") });
    expect((await delivery(["approve", "--all"], { cwd: other })).stderr).toContain(unknownFixWorkflow(TOTAL, "nowhere:fix"));
    expect(git(other, ["log", "--format=%s"]).split("\n")).toHaveLength(1);
  });

  it("says so when there is nothing to approve", async () => {
    const repo = initTempRepo("choose-none-", { "a.js": "x\n" });
    expect((await delivery(["approve", "--all"], { cwd: repo })).stderr).toContain(NO_IDEAS);
  });

  it("names a fix workflow for ideas that name none with --workflow", async () => {
    const repo = initTempRepo("choose-workflow-", { "delivery.config.json": CONFIG, [`.delivery/backlog/${TOTAL}`]: "---\nstatus: idea\nseverity: low\n---\n# x\n" });
    expect((await delivery(["approve", "--all", "--workflow", "fix"], { cwd: repo })).exitCode).toBe(EXIT.ok);
    expect(git(repo, ["show", `HEAD:.delivery/backlog/${TOTAL}`])).toContain("workflow: fix");
  });
});

describe("delivery decline", () => {
  it("sets the named ideas aside in a commit of only those files", async () => {
    const repo = project();
    const { exitCode, stdout } = await delivery(["decline", "settings-error"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(statusOf(repo, SETTINGS)).toBe("declined");
    expect(statusOf(repo, TOTAL)).toBe("idea");
    expect(stdout).toContain("Set aside 1 idea: A broken settings file gives an unhelpful error.");
  });
});
