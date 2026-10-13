import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { git } from "../../tests/helpers.js";
import { initTempRepo } from "../temp-repo.js";
import { confirmFindings, findingId, inScope, locate, normaliseAnchor, TEXT_LIMITS } from "./confirm.js";
import type { ScanEnvelope, ScannedFinding } from "./finding.js";
import { maskSecret } from "./secrets.js";

/** Every `git grep` confirming runs, so a test can see which checks were tried. */
const greps: string[][] = [];
vi.mock("../git-exec.js", async (actual) => {
  const real = await actual<typeof import("../git-exec.js")>();
  return {
    ...real,
    git: (repo: string, args: string[], options?: Parameters<typeof real.git>[2]) => {
      if (args[0] === "grep") greps.push(args);
      return real.git(repo, args, options);
    },
  };
});

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

const LOCKED = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/minimist": { version: "1.2.5" } } }, null, 2);

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

  it("does not place a problem at a folder named with a trailing slash, even when a file inside holds the flagged code", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    mkdirSync(join(repo, "lib"));
    commit(repo, { "lib/total.js": TOTAL });
    const { findings, unconfirmed } = await confirm(repo, envelope(problem({ where: { path: "lib/" } })));
    expect(findings).toEqual([]);
    expect(unconfirmed.map((u) => u.reason)).toEqual(["not_a_file"]);
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
    const check = { kind: "pattern-absent" as const, pattern: "price - discount", paths: ["total.js"] };
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

  it("runs pattern checks only for the problems it offers, not for those cut by the limit", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL, "c.js": "// TODO remove this hack\n" });
    const critical = problem({ severity: "critical", where: { path: "c.js" }, anchor: "// TODO remove this hack" });
    const cut = problem({ severity: "low", check: { kind: "pattern-absent", pattern: "price - discount", paths: ["total.js"] } });
    greps.length = 0;
    const { notShown } = await confirm(repo, envelope(critical, cut), 1);
    expect(notShown).toBe(1);
    expect(greps).toEqual([]);
  });

  it("strips anything that could drive the terminal from the agent's words, and cuts them to size", async () => {
    const repo = initTempRepo("confirm-", { "total.js": TOTAL });
    const [found] = (await confirm(repo, envelope(problem({ title: "Bad\u001b[31m total", problem: "x".repeat(1000) })))).findings;
    expect(found?.title).toBe("Bad total");
    expect(found?.problem).toHaveLength(TEXT_LIMITS.sentence);
    expect(found?.problem.endsWith("…")).toBe(true);
  });
});

describe("a vulnerable-version check", () => {
  const dependency = (version: string): ScannedFinding =>
    problem({ where: { path: "package-lock.json" }, anchor: '"node_modules/minimist": {', check: { kind: "dependency-absent", package: "minimist", version } });

  it("is kept when the lockfile installs that version now", async () => {
    const repo = initTempRepo("confirm-dependency-", { "package-lock.json": LOCKED });
    const { findings } = await confirm(repo, envelope(dependency("1.2.5")));
    expect(findings[0]?.check).toEqual({ kind: "dependency-absent", package: "minimist", version: "1.2.5" });
  });

  it("is not used when the lockfile does not install that version, and the review's suggestion is kept for engineers", async () => {
    const repo = initTempRepo("confirm-dependency-", { "package-lock.json": LOCKED });
    const { findings } = await confirm(repo, envelope(dependency("9.9.9")));
    expect(findings[0]).toMatchObject({ check: { kind: "anchor-gone" }, droppedCheck: { kind: "dependency-absent", package: "minimist", version: "9.9.9" } });
  });
});

describe("a check the pack does not offer", () => {
  it("is not used: the problem falls back to anchor-gone and the suggestion is kept for engineers", async () => {
    const repo = initTempRepo("confirm-offered-", { "package-lock.json": LOCKED });
    const suggested = { kind: "dependency-absent", package: "minimist", version: "1.2.5" } as const;
    const { findings } = await confirmFindings(repo, head(repo), { pack: "code", maxFindings: 40, checks: ["anchor-gone", "pattern-absent"] }, envelope(problem({ where: { path: "package-lock.json" }, anchor: '"node_modules/minimist": {', check: suggested })));
    expect(findings[0]).toMatchObject({ check: { kind: "anchor-gone" }, droppedCheck: suggested });
  });
});

describe("what a pack's categories add to a confirmed problem", () => {
  it("keeps the step left for a person, and stamps whole-project and sensitive categories", async () => {
    const repo = initTempRepo("confirm-flags-", { "total.js": TOTAL });
    const { findings } = await confirmFindings(
      repo,
      head(repo),
      { pack: "security", maxFindings: 40, categories: [{ id: "correctness", title: "Wrong", scope: "repo", sensitive: true }] },
      envelope(problem({ outsideStep: "Change the password at the provider." })),
    );
    expect(findings[0]).toMatchObject({ outsideStep: "Change the password at the provider.", scope: "repo", sensitive: true });
  });

  it("adds nothing for a category that says nothing", async () => {
    const repo = initTempRepo("confirm-flags-", { "total.js": TOTAL });
    const { findings } = await confirm(repo, envelope(problem()));
    expect(findings[0]).not.toHaveProperty("scope");
    expect(findings[0]).not.toHaveProperty("sensitive");
    expect(findings[0]).not.toHaveProperty("outsideStep");
  });
});

describe("a secret the review repeats in its own words", () => {
  const SECRET = "pay-live-7Hq2xV9rLm4K";
  const FILE = `const PAYMENTS_PASSWORD = "${SECRET}";\n`;

  it("is masked everywhere but the flagged text, which is how the problem is found", async () => {
    const repo = initTempRepo("confirm-secret-", { "payments.js": FILE });
    const result = await confirmFindings(
      repo,
      head(repo),
      { pack: "security", maxFindings: 40, categories: [{ id: "correctness", title: "Secrets", sensitive: true }] },
      {
        findings: [problem({ where: { path: "payments.js" }, anchor: FILE.trim(), title: `Password ${SECRET} in code`, problem: `It is ${SECRET}.`, detail: `value ${SECRET}`, outsideStep: `Change ${SECRET}.` }), problem({ where: { path: "nowhere.js" }, problem: `Also ${SECRET}.` })],
        notes: `Saw ${SECRET}.`,
      },
    );
    const [finding] = result.findings;
    expect(finding?.anchor).toContain(SECRET);
    const shown = JSON.stringify({ ...finding, anchor: "" }) + JSON.stringify(result.unconfirmed) + result.notes;
    expect(shown).not.toContain(SECRET);
    expect(shown).toContain(maskSecret(SECRET));
  });
});

describe("how sure the review is", () => {
  it("keeps the review's confidence on each problem it confirms", async () => {
    const repo = initTempRepo("confirm-sure-", { "total.js": TOTAL });
    const result = await confirm(repo, envelope(problem({ confidence: "medium" })));
    expect(result.findings[0]?.confidence).toBe("medium");
  });

  it("lists the problems it is unsure of after every other, whatever their severity", async () => {
    const repo = initTempRepo("confirm-order-", { "total.js": TOTAL, "b.js": "export const b = 'something else entirely';\n" });
    const unsure = problem({ title: "Maybe", severity: "critical", confidence: "low" });
    const sure = problem({ title: "Surely", severity: "low", where: { path: "b.js" }, anchor: "export const b = 'something else entirely';", confidence: "high" });
    const result = await confirm(repo, envelope(unsure, sure));
    expect(result.findings.map((finding) => finding.title)).toEqual(["Surely", "Maybe"]);
  });

  it("cuts the unsure problems first when there are more than the limit", async () => {
    const repo = initTempRepo("confirm-cut-", { "total.js": TOTAL, "b.js": "export const b = 'something else entirely';\n" });
    const unsure = problem({ title: "Maybe", severity: "critical", confidence: "low" });
    const sure = problem({ title: "Surely", severity: "low", where: { path: "b.js" }, anchor: "export const b = 'something else entirely';" });
    const result = await confirm(repo, envelope(unsure, sure), 1);
    expect(result.findings.map((finding) => finding.title)).toEqual(["Surely"]);
    expect(result.notShown).toBe(1);
  });
});

describe("a review of one part of the project", () => {
  it("does not offer a problem outside the part asked for: it is listed as outside it", async () => {
    const repo = initTempRepo("confirm-scope-", { "total.js": TOTAL, "auth/login.js": "export const check = (a, b) => a == b;\n" });
    const outside = problem();
    const inside = problem({ title: "Loose comparison", where: { path: "auth/login.js" }, anchor: "export const check = (a, b) => a == b;" });
    const result = await confirmFindings(repo, head(repo), { pack: "code", maxFindings: 40, scope: "auth" }, envelope(outside, inside));
    expect(result.findings.map((finding) => finding.title)).toEqual(["Loose comparison"]);
    expect(result.unconfirmed).toEqual([expect.objectContaining({ reason: "outside_scope", path: "total.js" })]);
  });

  it("counts a file as inside a part only by whole folder names", () => {
    expect(inScope("auth/login.js", "auth")).toBe(true);
    expect(inScope("auth", "auth")).toBe(true);
    expect(inScope("authority.js", "auth")).toBe(false);
    expect(inScope("total.js", undefined)).toBe(true);
  });
});
