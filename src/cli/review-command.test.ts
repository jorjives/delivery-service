import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { git } from "../../tests/helpers.js";
import { createGhStandIn } from "../gh-stand-in.js";
import type { MockScript } from "../mock-script.js";
import { repoLocked, takeRepoLock } from "../repo-lock.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, movesProject, MOVES_FILES, PACKAGE, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { ideasScript, type ScriptedIdea } from "../packs/review-fixtures.js";
import { liveRunFound } from "./run-exclusion.js";
import { reviewed } from "./review-command.js";

const IDEA_FILE = ".delivery/backlog/20261019T120000Z-total-below-zero.md";
const idea = (anchor: string) => `---\nstatus: idea\nworkflow: code:fix\nseverity: high\ncheck:\n  kind: anchor-gone\n  path: total.js\n  anchor: "${anchor}"\n---\n# The total can go below zero\n\nA discount larger than the price makes the total negative.\n`;
const scan = (...effects: NonNullable<MockScript["expectations"][number]["effects"]>): MockScript => ({ expectations: [{ effects, json: { status: "completed", rationale: "reviewed" } }] });
const project = () => initTempRepo("review-", { "package.json": PACKAGE, "total.js": "export const total = (price, discount) => {\n  return price - discount;\n};\n" });
const env = async (script: MockScript) => ({ XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "review-state-")), [TEST_MOCK_SCRIPT]: await scriptFile(script) });
const LOOK_IDEA: ScriptedIdea = { file: "20261023T120000Z-old-call.md", title: "Totals still use the old code", severity: "low", workflow: "moves:tests",
  check: { kind: "anchor-gone", path: "old.js", anchor: "export const old = 1;" }, body: "The totals still call old.js." };

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

  it("refuses to start while another run is going here, before the scan agent is asked", async () => {
    const repo = project();
    const release = await takeRepoLock(repo);
    try {
      const { exitCode, stderr } = await delivery(["review", "code"], { cwd: repo, env: await env(scan({ write: { path: IDEA_FILE, content: idea("return price - discount;") } })) });
      expect(exitCode).toBe(EXIT.configuration);
      expect(stderr.trimEnd()).toBe(liveRunFound(undefined));
    } finally {
      await release?.();
    }
  });

  it(
    "holds the repository's lock while its scan agent works, and lets it go at the end",
    async () => {
      const repo = project();
      const running = delivery(["review", "code"], { cwd: repo, env: await env({ ...scan({ write: { path: IDEA_FILE, content: idea("return price - discount;") } }), delayMs: 1000 }) });
      await vi.waitFor(async () => expect(await repoLocked(repo)).toBe(true), { timeout: 30_000, interval: 50 });

      expect((await running).exitCode).toBe(EXIT.ok);
      expect(await repoLocked(repo)).toBe(false);
    },
    RUN_TIMEOUT * 2,
  );

  it("shows what the scan agent would be told with --preview, with no config file", async () => {
    const { exitCode, stdout } = await delivery(["review", "security", "--preview"], { cwd: project() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("workflow: security:fix");
  });

  it("starts a pack the project lists by its name", async () => {
    const repo = initTempRepo("listed-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ packs: ["mine-pack"] }),
      "mine-pack/pack.json": JSON.stringify({ schema: "delivery.pack/2", name: "mine", version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } }),
      "mine-pack/scan.md": "# Scan mine\n",
      "mine-pack/fix.md": "# Fix mine\n",
    });
    const { exitCode, stdout } = await delivery(["review", "mine", "--preview"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("# Scan mine");
  });

  it("refuses a pack folder the project does not list, naming the pack and how to list it", async () => {
    const repo = initTempRepo("unlisted-", { "package.json": PACKAGE, ...MOVES_FILES });
    const { exitCode, stderr } = await delivery(["review", "./moves-pack"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr.trimEnd()).toBe(`The pack "moves" in ${join(repo, "moves-pack")} is not one your project uses yet. List its folder under "packs" in delivery.config.json, then start it with: delivery review moves`);
    expect(stderr).not.toMatch(/the review/i);
  });

  it("refuses a name no pack has, naming the built-in ones, in a project that lists none", async () => {
    const { exitCode, stderr } = await delivery(["review", "moves"], { cwd: project() });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain('There is no review called "moves". The reviews available are: code, security.');
  });

  it("runs a pack's find when it is not called scan, landing its ideas on the current branch", async () => {
    const repo = movesProject({ "old.js": "export const old = 1;\n" });
    const before = git(repo, ["rev-parse", "HEAD"]);
    const { exitCode } = await delivery(["review", "moves"], { cwd: repo, env: await env(ideasScript([LOOK_IDEA])) });
    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["diff", "--name-only", before, "main"])).toBe(`.delivery/backlog/${LOOK_IDEA.file}`);
  }, RUN_TIMEOUT);

  it("previews a pack's find under its own step name, offering each act workflow, for only the part given", async () => {
    const { exitCode, stdout } = await delivery(["review", "moves", "--preview", "--path", "src"], { cwd: movesProject({ "src/a.js": "x\n" }) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("# Look for old code");
    expect(stdout).toContain("`moves:code`: Code that still calls the old code.");
    expect(stdout).toContain("`moves:tests`: A test file that still calls the old code.");
    expect(stdout).toContain("only src in this project");
  });
});
