import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { BUILT_IN_PACKS } from "../packs/manifest.js";
import { AGENT_OPINION, earlierHiddenLine, fixNowLines, NOT_NOW, NOTHING_CHANGED, READS_ONLY, CANNOT_BE_CHECKED, NO_TESTS_LEVEL, NO_TESTS_WARNING } from "../packs/render.js";
import { packsRoot } from "../packs/review-record.js";
import { UNDECIDED } from "../packs/fix-state.js";
import { EXAMPLE_SCAN, EXAMPLE_SECURITY_SCAN, exampleRepo, sampleFinding, PACK_FORBIDDEN, PAYMENTS_PASSWORD, scanScript, NO_TESTS_DIR, NO_TESTS_SCAN } from "../packs/review-fixtures.js";
import { plainReporter } from "./report.js";
import { NOT_SIGNED_IN, TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { scriptedAsk } from "./init-fixtures.js";
import { UNCOMMITTED_NOTE } from "./project.js";
import { pickQuestion, reviewCommand, WHEN_QUESTION } from "./review-command.js";
import type { CommandContext } from "./context.js";
import { withoutCredentials } from "../mock-session.js";
import { FINDINGS_SCHEMA, type FindingsDocument } from "../packs/findings-document.js";

const mocked = async (script = scanScript(EXAMPLE_SCAN)) => ({ [TEST_MOCK_SCRIPT]: await scriptFile(script) });
const reviewDirs = (repo: string) => (existsSync(packsRoot(repo)) ? readdirSync(packsRoot(repo)).filter((name) => name !== "scan-errors") : []);

/** A terminal session, in process, with a person answering through `ask`. */
async function atTerminal(repo: string, ask: ReturnType<typeof scriptedAsk>["ask"]) {
  const lines: string[] = [];
  const writeLine = (line: string): void => void lines.push(line);
  const ctx: CommandContext = {
    cwd: repo,
    env: { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "review-state-")), ...(await mocked()) },
    colour: false,
    json: false,
    interactive: true,
    stdin: process.stdin,
    writeLine,
    report: plainReporter(writeLine, false),
  };
  return { exitCode: await reviewCommand("code", undefined, ctx, ask), lines };
}

describe("delivery review", () => {
  it("reviews a project with no configuration file: says first that it only reads, then the list, and changes nothing", async () => {
    const repo = exampleRepo();
    const before = git(repo, ["branch", "--list"]);
    const { exitCode, stdout, stderr } = await delivery(["review", "code"], { cwd: repo, env: await mocked() });

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 2)).toEqual(["Code review of your project.", READS_ONLY]);
    expect(stdout).toMatch(/^Review finished in \d+ s\. It found 3 problems\.$/m);
    expect(stdout).toContain(AGENT_OPINION);
    expect(stdout).toContain("1. The price shown at checkout can be negative (high)");
    expect(stdout).toContain("1 more could not be confirmed");
    expect(stdout).toContain("2 of 3 have a specific check; 1 is tests only.");
    expect(stdout).toContain(NOTHING_CHANGED);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["branch", "--list"])).toBe(before);
  }, RUN_TIMEOUT);

  it("says when the project has uncommitted changes, which the review does not see", async () => {
    const repo = exampleRepo();
    writeFileSync(join(repo, "checkout.js"), "changed\n");
    const { stdout } = await delivery(["review", "code"], { cwd: repo, env: await mocked() });
    expect(stdout.split("\n").slice(0, 3)).toEqual(["Code review of your project.", READS_ONLY, UNCOMMITTED_NOTE]);
  }, RUN_TIMEOUT);

  it("says it found nothing, that this is no proof, and exits ok", async () => {
    const repo = exampleRepo();
    const { exitCode, stdout } = await delivery(["review", "code"], { cwd: repo, env: await mocked(scanScript({ findings: [], notes: "" })) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("The review found no problems. That is not proof there are none: the review is an agent's opinion, it looked at 8 files, and it can miss things.");
  }, RUN_TIMEOUT);

  it("reviews for security with nothing configured, opening by severity and never showing the password", async () => {
    const repo = exampleRepo("review-security-");
    const { exitCode, stdout } = await delivery(["review", "security"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(scanScript(EXAMPLE_SECURITY_SCAN)) } });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Security review of your project.");
    expect(stdout).toContain("It found 2 problems.\nBy how serious they are: 1 critical, 0 high, 1 medium, 0 low.\nProblems that are critical or high are fixed and checked");
    expect(stdout).toContain("    What could happen: Anyone who can read this code can use the payments service as you");
    expect(stdout).toContain("    How we will know: checked: the vulnerable version is no longer installed.");
    expect(stdout).toContain("    One thing is left for you: The password has already been seen");
    expect(stdout).not.toContain(PAYMENTS_PASSWORD);
  });

  it("says in one sentence that it could not run when the reply is not a list, saves nothing, and exits with the agent runtime code", async () => {
    const repo = exampleRepo();
    const { exitCode, stderr } = await delivery(["review", "code"], { cwd: repo, env: await mocked(scanScript({ problems: "lots" })) });
    expect(exitCode).toBe(EXIT.agentRuntime);
    expect(stderr).toBe("The review could not run because the agent did not give back a list of problems the harness could read. Run `delivery review code` again.\n");
    expect(reviewDirs(repo)).toEqual([]);
  }, RUN_TIMEOUT);

  it("says the usage limit stopped it, in the limit's own words", async () => {
    const repo = exampleRepo();
    const limited = { expectations: [{ fail: { message: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}' } }] };
    const { exitCode, stderr } = await delivery(["review", "code"], { cwd: repo, env: await mocked(limited) });
    expect(exitCode).toBe(EXIT.agentRuntime);
    expect(stderr).toContain("the AI service is limiting requests");
    expect(reviewDirs(repo)).toEqual([]);
  }, RUN_TIMEOUT);

  it("stops before setting anything up when nobody is signed in", async () => {
    const repo = exampleRepo();
    const home = mkdtempSync(join(tmpdir(), "review-home-"));
    const env = Object.fromEntries(Object.entries(withoutCredentials(process.env)).filter(([name]) => name !== TEST_MOCK_SCRIPT));
    const { exitCode, stderr } = await delivery(["review", "code"], { cwd: repo, env: { ...env, HOME: home, CLAUDE_CODE_DIR: join(home, ".claude") } });
    expect(exitCode).toBe(EXIT.agentRuntime);
    expect(stderr).toBe(`${NOT_SIGNED_IN}\n`);
    expect(existsSync(packsRoot(repo))).toBe(false);
  }, RUN_TIMEOUT);

  it("names the reviews there are when asked for one that does not exist", async () => {
    const { exitCode, stderr } = await delivery(["review", "nope"], { cwd: exampleRepo() });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("The reviews available are: code, security.");
  });

  it("runs a pack from a folder exactly as a built-in one", async () => {
    const repo = exampleRepo();
    const pack = join(mkdtempSync(join(tmpdir(), "own-pack-")), "mine");
    cpSync(join(BUILT_IN_PACKS, "code-review"), pack, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(pack, "pack.json"), "utf-8")) as { name: string; title: string };
    writeFileSync(join(pack, "pack.json"), JSON.stringify({ ...manifest, name: "mine", title: "My review" }));
    const { exitCode, stdout } = await delivery(["review", pack], { cwd: repo, env: await mocked() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe("My review of your project.");
    expect(reviewDirs(repo)).toEqual([expect.stringMatching(/^mine-\d{8}T\d{6}Z$/)]);
  }, RUN_TIMEOUT);

  it("never asks anything in a pipe or with --json, and keeps standard output for the findings document under --json", async () => {
    const repo = exampleRepo();
    const piped = await delivery(["review", "code"], { cwd: repo, env: await mocked(), isTTY: false, answers: ["anything"] });
    expect(piped.exitCode).toBe(EXIT.ok);
    const json = await delivery(["--json", "review", "code"], { cwd: exampleRepo(), env: await mocked(), isTTY: true, answers: ["anything"] });
    expect(json.exitCode).toBe(EXIT.ok);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
    expect(json.stderr).toContain("It found 3 problems.");
  }, RUN_TIMEOUT);

  it("finishes an interrupted review with no second session", async () => {
    const repo = exampleRepo();
    const env = await mocked();
    await delivery(["review", "code"], { cwd: repo, env });
    const [dir] = reviewDirs(repo);
    if (dir === undefined) throw new Error("expected a review");
    rmSync(join(packsRoot(repo), dir, "refs", "scan.json"));
    const journal = `${env[TEST_MOCK_SCRIPT]}.journal.jsonl`;
    const sessionsBefore = readFileSync(journal, "utf-8");

    const { exitCode, stdout } = await delivery(["review", "code"], { cwd: repo, env });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Finishing the review that was interrupted");
    expect(readFileSync(journal, "utf-8")).toBe(sessionsBefore);
  }, RUN_TIMEOUT);

  it("warns at the top of a review of a project with no tests, and tells each problem's level honestly", async () => {
    const repo = exampleRepo("review-no-tests-", NO_TESTS_DIR);
    const { exitCode, stdout } = await delivery(["review", "code"], { cwd: repo, env: await mocked(scanScript(NO_TESTS_SCAN)) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toMatch(new RegExp(`It found 3 problems\\.\\n${NO_TESTS_WARNING.replace(/[.]/g, "\\.")}\\n`));
    expect(stdout).toContain(`    How we will know: checked: the flagged code is gone; ${NO_TESTS_LEVEL}.`);
    expect(stdout).toContain(`    How we will know: ${CANNOT_BE_CHECKED}.`);
  }, RUN_TIMEOUT);

  it("never runs the project's own code to learn whether it has tests", async () => {
    const repo = exampleRepo("review-js-config-", NO_TESTS_DIR);
    const marker = join(mkdtempSync(join(tmpdir(), "review-marker-")), "ran");
    writeFileSync(join(repo, "delivery.config.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "");\nexport default {};\n`);
    const { exitCode } = await delivery(["review", "code"], { cwd: repo, env: await mocked(scanScript(NO_TESTS_SCAN)) });
    expect(exitCode).toBe(EXIT.ok);
    expect(existsSync(marker)).toBe(false);
  }, RUN_TIMEOUT);

  it("says nothing about tests for a project that has them", async () => {
    const { stdout } = await delivery(["review", "code"], { cwd: exampleRepo(), env: await mocked() });
    expect(stdout).not.toContain(NO_TESTS_WARNING);
  }, RUN_TIMEOUT);

  it("does not offer again what the owner skipped in an earlier review of the same kind, and says how many it left out", async () => {
    const repo = exampleRepo();
    await delivery(["review", "code"], { cwd: repo, env: await mocked() });
    await delivery(["findings", "skip", "3"], { cwd: repo });

    const { exitCode, stdout } = await delivery(["review", "code"], { cwd: repo, env: await mocked() });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("1. The price shown at checkout can be negative (high)");
    expect(stdout).not.toContain("3. Old code for a payment provider you no longer use");
    expect(stdout).toContain(earlierHiddenLine(1));
    expect(stdout).toContain("  Fix all 2: delivery findings approve --all, then delivery fix");
  }, RUN_TIMEOUT);
});

describe("delivery review at a terminal", () => {
  it("offers every problem, all picked, then fix now or not now; fix now gives the commands for the ones picked", async () => {
    const repo = exampleRepo();
    const { ask, asked } = scriptedAsk({ picks: [["1", "3"]], choice: "now" });
    const { exitCode, lines } = await atTerminal(repo, ask);
    expect(exitCode).toBe(EXIT.ok);
    expect(asked[0]).toMatchObject({ message: "Which problems would you like fixed?", choices: [{ value: "1" }, { value: "2" }, { value: "3" }] });
    expect(asked[1]).toEqual(WHEN_QUESTION);
    expect(lines.slice(-2)).toEqual(fixNowLines([1, 3]));
  }, RUN_TIMEOUT);

  it("says nothing has changed when the owner chooses not now", async () => {
    const { lines } = await atTerminal(exampleRepo(), scriptedAsk({ choice: "later" }).ask);
    expect(lines.at(-1)).toBe(NOT_NOW);
  }, RUN_TIMEOUT);

  it("gives the review as one findings document with --json, its words on standard error", async () => {
    const repo = exampleRepo();
    const { exitCode, stdout, stderr } = await delivery(["review", "code", "--json"], { cwd: repo, env: await mocked() });
    expect(exitCode).toBe(EXIT.ok);
    const doc = JSON.parse(stdout) as FindingsDocument;
    expect(doc.schema).toBe(FINDINGS_SCHEMA);
    expect(doc.problems.map((p) => [p.title, p.state])).toEqual([
      ["The price shown at checkout can be negative", "proposed"],
      ["A missing or broken settings file stops the shop with an unhelpful error", "proposed"],
      ["Old code for a payment provider you no longer use", "proposed"],
    ]);
    expect(stderr).toContain(READS_ONLY);
  }, RUN_TIMEOUT);

  it("offers in the interactive choice only the problems that can be checked", () => {
    const header = { reviewId: "code-1", pack: { name: "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 40, categories: [{ id: "correctness", title: "Wrong results" }] }, repoPath: "/r", commit: "1".repeat(40), fileCount: 1, startedAt: "2026-10-05T10:15:00.000Z", endedAt: "2026-10-05T10:19:12.000Z", noTests: true as const };
    const findings = [sampleFinding(), sampleFinding({ id: "222222222222", check: { kind: "none" } })];
    expect(pickQuestion({ dir: "/d", header, result: { findings, unconfirmed: [], notShown: 0, notes: "" } }, []).choices.map((choice) => choice.value)).toEqual(["1"]);
  });

  it("asks in the owner's words", () => {
    const review = { dir: "/d", header: {} as never, result: { findings: [], unconfirmed: [], notShown: 0, notes: "" } };
    const text = [pickQuestion(review, []).message, WHEN_QUESTION.message, ...WHEN_QUESTION.choices.flatMap((c) => [c.name, c.description])].join("\n");
    expect(text).not.toMatch(PACK_FORBIDDEN);
  });

  it("leaves out of the interactive choice what an earlier review settled", () => {
    const header = { reviewId: "code-1", pack: { name: "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 40, categories: [{ id: "correctness", title: "Wrong results" }] }, repoPath: "/r", commit: "1".repeat(40), fileCount: 1, startedAt: "2026-10-05T10:15:00.000Z", endedAt: "2026-10-05T10:19:12.000Z" };
    const findings = [sampleFinding(), sampleFinding({ id: "222222222222" })];
    const states = [{ ...UNDECIDED, state: "skipped" as const, earlier: "skipped" as const }, UNDECIDED];
    expect(pickQuestion({ dir: "/d", header, result: { findings, unconfirmed: [], notShown: 0, notes: "" } }, states).choices.map((choice) => choice.value)).toEqual(["2"]);
  });
});
