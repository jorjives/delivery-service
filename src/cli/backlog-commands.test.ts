import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { backlogLines, itemLines, NO_IDEAS, notAnIdea, PUSH_FIRST, uncommittedItems, unknownFixWorkflow } from "./backlog-commands.js";
import { createGhStandIn } from "../gh-stand-in.js";
import { foldLedger } from "../item-ledger.js";
import type { BacklogItem } from "../backlog.js";

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

describe("delivery backlog", () => {
  it("lists ideas, open, held and parked items under plain headings, each with its id", () => {
    const at = "2026-10-19T12:00:00Z";
    const item = (file: string, status: string, title: string, severity?: string) => ({ file, status, ...(severity === undefined ? {} : { severity }), fields: {}, body: `# ${title}\n` }) as BacklogItem;
    const ledger = foldLedger([
      { t: "ended", key: "backlog:20261019T120200Z-key.md", runId: "r1", class: "held", at }, { t: "parked", key: "backlog:20261019T120200Z-key.md", reason: "held", at },
      { t: "ended", key: "backlog:20261019T120300Z-stuck.md", runId: "r2", class: "escalated", at }, { t: "parked", key: "backlog:20261019T120300Z-stuck.md", reason: "escalated", at },
    ]);
    expect(backlogLines([
      item("20261019T120000Z-total.md", "idea", "The total can go below zero", "high"),
      item("20261019T120100Z-greet.md", "open", "Greet people"),
      item("20261019T120200Z-key.md", "open", "A key is written in the code", "critical"),
      item("20261019T120300Z-stuck.md", "open", "Something stuck"),
      item("20261019T120400Z-done.md", "resolved", "Done already"),
    ], ledger)).toEqual([
      "Ideas, waiting for you to choose:",
      "  20261019T120000Z-total  The total can go below zero (high)",
      "Open, to be worked on the next delivery run --sources:",
      "  20261019T120100Z-greet  Greet people",
      "Held, finished and waiting for your sign-off:",
      "  20261019T120200Z-key  A key is written in the code (critical)",
      "Parked, stopped for you:",
      "  20261019T120300Z-stuck  Something stuck",
      "",
      "Read one in full with: delivery backlog <id>",
    ]);
  });

  it("lists a held or parked item from a tracker, which has no file in the backlog folder, by its key and intent", () => {
    const at = "2026-10-19T12:00:00Z";
    const ledger = foldLedger([
      { t: "dispatched", key: "github:#12", runId: "r3", intent: "The total can go below zero", at },
      { t: "ended", key: "github:#12", runId: "r3", class: "held", at }, { t: "parked", key: "github:#12", reason: "held", at },
    ]);
    expect(backlogLines([], ledger)).toEqual([
      "Held, finished and waiting for your sign-off:",
      "  github:#12  The total can go below zero",
      "",
      "Read one in full with: delivery backlog <id>",
    ]);
  });

  it("shows one item in full, then a block for engineers", () => {
    const item = { file: "20261019T120000Z-total.md", status: "idea", workflow: "code:fix", severity: "high", check: { kind: "anchor-gone", path: "total.js", anchor: "return price - discount;" }, fields: {}, body: "# The total can go below zero\n\nA discount larger than the price makes the total negative.\n" } as BacklogItem;
    expect(itemLines(item, undefined)).toEqual([
      "The total can go below zero",
      "An idea, rated high, waiting for you to choose: delivery approve 20261019T120000Z-total, or delivery decline 20261019T120000Z-total",
      "",
      "A discount larger than the price makes the total negative.",
      "",
      "FOR ENGINEERS",
      "  File: .delivery/backlog/20261019T120000Z-total.md",
      "  Fixed through: code:fix",
      "  Done when: the flagged code is no longer in total.js",
      "  Flagged code: return price - discount;",
    ]);
  });

  it("masks a sensitive item's secret wherever the command prints it", async () => {
    const secret = "pay-live-7Hq2xV9rLm4K";
    const repo = initTempRepo("backlog-secret-", { [`.delivery/backlog/${TOTAL}`]: `---\nstatus: idea\nseverity: critical\ncheck:\n  kind: anchor-gone\n  path: payments.js\n  anchor: 'const KEY = "${secret}";'\n  scope: repo\n  sensitive: true\n---\n# A key is written in the code\n` });
    const { stdout } = await delivery(["backlog", "total-below-zero"], { cwd: repo });
    expect(stdout).not.toContain(secret);
    expect(stdout).toContain("pay-… (21 characters)");
  });
});

describe("delivery backlog with a github source", () => {
  it("lists a labelled issue the next delivery run --sources would work", async () => {
    const gh = createGhStandIn();
    const repo = initTempRepo("backlog-github-", { "delivery.config.json": JSON.stringify({ sources: [{ type: "github" }] }) });
    gh.openIssue({ title: "Say hello to a name", body: "Please.", labels: ["delivery"] });
    gh.openIssue({ title: "Not approved yet", body: "Leave me." });
    const { exitCode, stdout } = await delivery(["backlog"], { cwd: repo, env: { PATH: `${gh.binDir}:${process.env.PATH ?? ""}` } });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Say hello to a name");
    expect(stdout).not.toContain("Not approved yet");
    expect(stdout).not.toContain("Your backlog has nothing waiting");
  });
});
