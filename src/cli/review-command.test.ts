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
import { IDEA_CAP, resolvePack } from "../packs/manifest.js";
import { FORBIDDEN } from "../report/report-fixtures.js";
import { liveRunFound } from "./run-exclusion.js";
import { findWords, MAY_BE_MORE, reviewed } from "./review-command.js";

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
    expect(stderr).toContain('There is no pack called "moves". The packs available are: code, security.');
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

describe("a delivery.pack/2 pack's words", () => {
  it("are today's, byte for byte", async () => {
    const code = await resolvePack("code", "/");
    const words = findWords(code);
    expect(words.starting(undefined)).toEqual([]);
    expect(words.added(0)).toEqual(["The review found nothing to add to your backlog."]);
    expect(words.added(2)).toEqual(["The review added 2 ideas to your backlog.", "Read them with: delivery backlog", "Choose what to fix with: delivery approve <ids>, or delivery approve --all"]);
    expect(words.added(IDEA_CAP)).not.toContain(MAY_BE_MORE);
    expect(words.raised(1, "GitHub")).toEqual(["The review raised 1 idea in GitHub, without the label you deliver by.", "On GitHub, adding the label is the approval: the next delivery run --sources fixes each one you label."]);
    expect(words.task("src")).toEqual({ intent: "Code review of only src in this project", body: "Review only src in this project and add one idea to the backlog for each problem you find, as the step says. Change nothing else." });
  });
});

describe("a delivery.pack/3 pack's words", () => {
  const moves = async (title = "Move off old code") => {
    const repo = movesProject({ "moves-pack/pack.json": JSON.stringify({ ...JSON.parse(MOVES_FILES["moves-pack/pack.json"] ?? "{}"), title }) });
    return resolvePack("./moves-pack", repo);
  };

  it("start by naming the pack and what it reads, then its summary", async () => {
    const words = findWords(await moves());
    expect(words.starting(undefined)).toEqual(["Starting: Move off old code. This reads your project and adds to your backlog; it changes nothing else.", "Finds places that still use old code, and moves them."]);
    expect(words.starting("src")[0]).toBe("Starting: Move off old code. This reads only src in your project and adds to your backlog; it changes nothing else.");
    expect(words.task(undefined).intent).toBe("Move off old code in this project");
    expect(words.task("src").intent).toBe("Move off old code, only src in this project");
  });

  it("say plainly when nothing was added, and that it is the agent's reading", async () => {
    expect(findWords(await moves()).added(0)).toEqual(["Move off old code found nothing to add. That is the agent's reading of your project, not a guarantee."]);
  });

  it("count what was added, one idea or several, and say there may be more at or above the cap", async () => {
    const words = findWords(await moves());
    expect(words.added(1)[0]).toBe("The pack added 1 idea to your backlog.");
    expect(words.added(3)[0]).toBe("The pack added 3 ideas to your backlog.");
    expect(words.added(3)).not.toContain(MAY_BE_MORE);
    expect(words.added(IDEA_CAP).at(-1)).toBe(MAY_BE_MORE);
    expect(words.added(IDEA_CAP + 1).at(-1)).toBe(MAY_BE_MORE);
    expect(words.raised(IDEA_CAP, "GitHub").at(-1)).toBe(MAY_BE_MORE);
  });

  it("never double a full stop the title ends with", async () => {
    const words = findWords(await moves("Move off old code."));
    expect(words.starting(undefined)[0]).toMatch(/^Starting: Move off old code\. This/);
    expect(words.added(0)[0]).toMatch(/^Move off old code found/);
  });

  it("never call the pack a review, nor use the harness's own words", async () => {
    const words = findWords(await moves());
    const all = [...words.starting(undefined), ...words.starting("src"), ...words.added(0), ...words.added(1), ...words.added(IDEA_CAP), ...words.raised(2, "GitHub"), words.task(undefined).intent, words.task("src").intent];
    for (const line of all) {
      expect(line).not.toMatch(/review/i);
      expect(line).not.toMatch(FORBIDDEN);
    }
  });

  it("are what delivery review prints for the pack, with none of the review's lines", async () => {
    const repo = movesProject({ "old.js": "export const old = 1;\n" });
    const { stdout } = await delivery(["review", "moves"], { cwd: repo, env: await env(ideasScript([LOOK_IDEA])) });
    expect(stdout).toContain("Starting: Move off old code. This reads your project and adds to your backlog; it changes nothing else.");
    expect(stdout).toContain("The pack added 1 idea to your backlog.");
    expect(stdout).not.toContain("The review");
    expect(stdout).not.toContain("added 1 ideas"); // the mock's rationale is never quoted as the harness's words
  }, RUN_TIMEOUT);

  it("prints the nothing-found line when the find adds no idea", async () => {
    const { exitCode, stdout } = await delivery(["review", "moves"], { cwd: movesProject(), env: await env(ideasScript([])) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Move off old code found nothing to add. That is the agent's reading of your project, not a guarantee.");
  }, RUN_TIMEOUT);

  it("raises its ideas on a GitHub-backed project in its own words", async () => {
    const gh = createGhStandIn();
    const repo = movesProject({ "old.js": "export const old = 1;\n", "delivery.config.json": JSON.stringify({ sources: [{ type: "github" }], packs: ["moves-pack"] }) });
    const before = git(repo, ["rev-parse", "HEAD"]);
    const ghEnv = { ...(await env(ideasScript([LOOK_IDEA]))), PATH: `${gh.binDir}:${process.env.PATH ?? ""}` };
    const { exitCode, stdout } = await delivery(["review", "moves"], { cwd: repo, env: ghEnv });
    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["diff", "--name-only", before, "main"])).toBe("");
    expect(stdout).toContain("The pack raised 1 idea in GitHub, without the label you deliver by.");
    expect(gh.issues()).toHaveLength(1);
  }, RUN_TIMEOUT);
});
