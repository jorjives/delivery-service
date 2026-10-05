import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { initTempRepo } from "../temp-repo.js";
import { confirmFindings, findingId, locate, normaliseAnchor, TEXT_LIMITS } from "./confirm.js";
import type { ScanEnvelope, ScannedFinding } from "./finding.js";

const TOTAL = "export function total(price, discount) {\n  return price - discount;\n}\n";

const problem = (overrides: Partial<ScannedFinding> = {}): ScannedFinding => ({
  title: "The total can go below zero",
  category: "correctness",
  severity: "high",
  where: { path: "total.js" },
  problem: "A discount larger than the price makes the total negative.",
  whyItMatters: "The shop would pay the customer.",
  fixedLooksLike: "A total never goes below zero.",
  anchor: "return price - discount;",
  check: { kind: "anchor-gone" },
  ...overrides,
});

const envelope = (...findings: ScannedFinding[]): ScanEnvelope => ({ findings, notes: "" });
const head = (repo: string) => git(repo, ["rev-parse", "HEAD"]);
const confirm = (repo: string, env: ScanEnvelope, maxFindings = 40) => confirmFindings(repo, head(repo), { pack: "code", maxFindings }, env);

/** Commit `files` on top of `repo`'s main branch. */
function commit(repo: string, files: Record<string, string>): void {
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(repo, name), contents);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "change"]);
}

describe("placing a reported problem in the project", () => {
  it("confirms it at the line its flagged code starts on, with an identity from what it is and where", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const { findings, unconfirmed } = await confirm(repo, envelope(problem()));
    expect(unconfirmed).toEqual([]);
    expect(findings).toEqual([
      expect.objectContaining({ id: findingId("code", "correctness", "total.js", "return price - discount;"), where: { path: "total.js", line: 2, endLine: 2 }, source: "reviewer" }),
    ]);
  });

  it("finds flagged code however its spacing differs, and spans the lines it covers", () => {
    expect(locate("a\n  if (x)   {\n\n    y();\n  }\n", "if (x) {\n y();")).toEqual({ line: 2, endLine: 4 });
    expect(normaliseAnchor("  a \n\t b  ")).toBe("a b");
  });

  it("counts lines from the true top of a file that starts with blank lines", async () => {
    const repo = initTempRepo("confirm-", { "total.js": `\n\n${TOTAL}` });
    expect((await confirm(repo, envelope(problem()))).findings[0]?.where.line).toBe(4);
  });

  it("keeps one identity when the problem is reworded or its lines move", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const [before] = (await confirm(repo, envelope(problem()))).findings;
    commit(repo, { "total.js": `// a header\n// more\n${TOTAL}` });
    const [after] = (await confirm(repo, envelope(problem({ title: "Negative totals", problem: "Totals can be negative." })))).findings;
    expect(after?.id).toBe(before?.id);
    expect(after?.where.line).toBe(4);
  });

  it.each([
    ["a file that is not there", { where: { path: "nope.js" } }, "no_such_file"],
    ["a path leading out of the project", { where: { path: "../outside.js" } }, "outside_project"],
    ["an absolute path", { where: { path: "/etc/passwd" } }, "outside_project"],
    ["a folder", { where: { path: "lib" } }, "not_a_file"],
    ["a link", { where: { path: "link.js" } }, "not_a_file"],
    ["flagged code that is not in the file", { anchor: "return price + tax;" }, "text_not_found"],
    ["flagged code too short to find reliably", { anchor: "x = 1" }, "vague"],
    ["flagged code longer than five lines", { anchor: "a;\nb;\nc;\nd;\ne;\nreturn price - discount;" }, "vague"],
  ] as const)("does not offer %s, and lists it as could not be confirmed", async (_, overrides, reason) => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    mkdirSync(join(repo, "lib"));
    writeFileSync(join(repo, "lib", "a.js"), "x\n");
    symlinkSync("total.js", join(repo, "link.js"));
    commit(repo, {});
    const { findings, unconfirmed } = await confirm(repo, envelope(problem(overrides as Partial<ScannedFinding>)));
    expect(findings).toEqual([]);
    expect(unconfirmed).toEqual([expect.objectContaining({ title: "The total can go below zero", severity: "high", reason })]);
  });

  it("reads the commit it is given, not the working copy", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    writeFileSync(join(repo, "total.js"), "uncommitted\n");
    expect((await confirm(repo, envelope(problem()))).findings).toHaveLength(1);
  });
});

describe("the list a review offers", () => {
  it("shows two reports of the same flagged code once, keeping the first", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const { findings } = await confirm(repo, envelope(problem(), problem({ title: "Said again" })));
    expect(findings.map((f) => f.title)).toEqual(["The total can go below zero"]);
  });

  it("orders by how serious, then identity, and cuts to the limit, counting what it left out", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL, "b.js": "const unusedThing = 1;\n", "c.js": "// TODO remove this hack\n" });
    const low = problem({ severity: "low", where: { path: "b.js" }, anchor: "const unusedThing = 1;" });
    const critical = problem({ severity: "critical", where: { path: "c.js" }, anchor: "// TODO remove this hack" });
    const { findings, notShown } = await confirm(repo, envelope(low, problem(), critical), 2);
    expect(findings.map((f) => f.severity)).toEqual(["critical", "high"]);
    expect(notShown).toBe(1);
  });

  it("keeps a pattern check that matches the code now", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const check = { kind: "pattern-absent" as const, pattern: "price - discount", paths: ["*.js"] };
    expect((await confirm(repo, envelope(problem({ check })))).findings[0]?.check).toEqual(check);
  });

  it.each([
    ["does not match the code as it stands", { kind: "pattern-absent" as const, pattern: "price \\* tax", paths: ["total.js"] }],
    ["is not a valid pattern", { kind: "pattern-absent" as const, pattern: "(", paths: ["total.js"] }],
    ["looks outside the project", { kind: "pattern-absent" as const, pattern: "price", paths: ["../x"] }],
    ["is too long to run safely", { kind: "pattern-absent" as const, pattern: "a".repeat(501), paths: ["total.js"] }],
  ])("offers a problem whose pattern check %s with the flagged-code check instead, keeping the suggestion for engineers", async (_, check) => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const [found] = (await confirm(repo, envelope(problem({ check })))).findings;
    expect(found?.check).toEqual({ kind: "anchor-gone" });
    expect(found?.droppedCheck).toEqual(check);
  });

  it("strips anything that could drive the terminal from the agent's words, and cuts them to size", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const [found] = (await confirm(repo, envelope(problem({ title: "Bad\u001b[31m total", problem: "x".repeat(1000) })))).findings;
    expect(found?.title).toBe("Bad total");
    expect(found?.problem).toHaveLength(TEXT_LIMITS.sentence);
    expect(found?.problem.endsWith("…")).toBe(true);
  });
});
