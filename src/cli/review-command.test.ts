import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { createGhStandIn } from "../gh-stand-in.js";
import type { MockScript } from "../mock-script.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, PACKAGE, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { reviewed } from "./review-command.js";

const IDEA_FILE = ".delivery/backlog/20261019T120000Z-total-below-zero.md";
const idea = (anchor: string) => `---\nstatus: idea\nworkflow: code:fix\nseverity: high\ncheck:\n  kind: anchor-gone\n  path: total.js\n  anchor: "${anchor}"\n---\n# The total can go below zero\n\nA discount larger than the price makes the total negative.\n`;
const scan = (...effects: NonNullable<MockScript["expectations"][number]["effects"]>): MockScript => ({ expectations: [{ effects, json: { status: "completed", rationale: "reviewed" } }] });
const project = () => initTempRepo("review-", { "package.json": PACKAGE, "total.js": "export const total = (price, discount) => {\n  return price - discount;\n};\n" });
const env = async (script: MockScript) => ({ XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "review-state-")), [TEST_MOCK_SCRIPT]: await scriptFile(script) });

describe("delivery review", () => {
  it("adds one idea per problem to the backlog on the current branch, and changes nothing else", async () => {
    const repo = project();
    const before = git(repo, ["rev-parse", "HEAD"]);
    const { exitCode, stdout } = await delivery(["review", "code"], { cwd: repo, env: await env(scan({ write: { path: IDEA_FILE, content: idea("return price - discount;") } })) });
    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["diff", "--name-only", before, "main"])).toBe(IDEA_FILE);
    expect(git(repo, ["show", `main:${IDEA_FILE}`])).toContain("status: idea");
    expect(stdout).toContain(reviewed(1)[0]);
  }, RUN_TIMEOUT);

  it("rejects a problem the harness cannot find, and lands nothing while the agent keeps reporting it", async () => {
    const repo = project();
    const before = git(repo, ["rev-parse", "HEAD"]);
    const { exitCode } = await delivery(["review", "code"], { cwd: repo, env: await env(scan({ write: { path: IDEA_FILE, content: idea("return price + discount;") } })) });
    expect(exitCode).not.toBe(EXIT.ok);
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
  }, RUN_TIMEOUT);

  it("refuses a scan that changes the code", async () => {
    const repo = project();
    const before = git(repo, ["rev-parse", "HEAD"]);
    const { exitCode } = await delivery(["review", "code"], { cwd: repo, env: await env(scan({ write: { path: IDEA_FILE, content: idea("return price - discount;") } }, { edit: { path: "total.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } })) });
    expect(exitCode).not.toBe(EXIT.ok);
    expect(git(repo, ["rev-parse", "main"])).toBe(before);
  }, RUN_TIMEOUT);

  it("raises the ideas as unlabelled issues on a project whose backlog is GitHub, committing none", async () => {
    const gh = createGhStandIn();
    const repo = initTempRepo("review-gh-", { "package.json": PACKAGE, "total.js": "return price - discount;\n", "delivery.config.json": JSON.stringify({ sources: [{ type: "github" }] }) });
    const before = git(repo, ["rev-parse", "HEAD"]);
    const ghEnv = { ...(await env(scan({ write: { path: IDEA_FILE, content: idea("return price - discount;") } }))), PATH: `${gh.binDir}:${process.env.PATH ?? ""}` };
    const { exitCode } = await delivery(["review", "code"], { cwd: repo, env: ghEnv });
    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["diff", "--name-only", before, "main"])).toBe("");
    const [issue] = gh.issues();
    expect(issue).toMatchObject({ title: "The total can go below zero", labels: [] });
    expect(issue?.body).toContain("workflow: code:fix");
  }, RUN_TIMEOUT);

  it("shows what the scan agent would be told with --preview, with no config file", async () => {
    const { exitCode, stdout } = await delivery(["review", "security", "--preview"], { cwd: project() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("workflow: security:fix");
  });
});
