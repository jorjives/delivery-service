import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../git-env.js";
import { deriveReport } from "../report/derive.js";
import { footerFailed, formDone, snapshotOf } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { PACKAGE } from "./command-fixtures.js";
import { isSaved, notSaved, SAVED_DATA, SAVED_TEXT, SAVED_TO, saveReport } from "./saved-report.js";

const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));
const LINES = ["Your task list: 1 of 4 tasks completed and merged.", "", "Next: delivery status --all (every run)"];
const repoOf = (prefix: string): string => initTempRepo(prefix, { "package.json": PACKAGE });
const modeOf = (path: string): number => statSync(path).mode & 0o777;

describe("saving a report", () => {
  it("names one fixed pair inside the project's .delivery folder", () => {
    expect([SAVED_TEXT, SAVED_DATA]).toEqual([".delivery/last-report.txt", ".delivery/last-report.json"]);
    expect(SAVED_TO).toBe("Saved to: .delivery/last-report.txt and .delivery/last-report.json");
  });

  it("writes the text as given and the document as data", async () => {
    const repo = repoOf("saved-report-pair-");

    await saveReport(repo, doc, LINES);

    expect(readFileSync(join(repo, SAVED_TEXT), "utf-8")).toBe(`${LINES.join("\n")}\n`);
    expect(JSON.parse(readFileSync(join(repo, SAVED_DATA), "utf-8"))).toEqual(doc);
  });

  it("replaces the earlier pair whole, leaving nothing half-written beside it", async () => {
    const repo = repoOf("saved-report-replace-");
    await saveReport(repo, doc, ["an earlier report"]);

    await saveReport(repo, doc, LINES);

    expect(readFileSync(join(repo, SAVED_TEXT), "utf-8")).toBe(`${LINES.join("\n")}\n`);
    expect(readdirSync(join(repo, ".delivery")).sort()).toEqual([".gitignore", "last-report.json", "last-report.txt"]);
  });

  it("lets only the user who ran the command read the pair", async () => {
    const repo = repoOf("saved-report-mode-");

    await saveReport(repo, doc, LINES);

    expect([modeOf(join(repo, SAVED_TEXT)), modeOf(join(repo, SAVED_DATA))]).toEqual([0o600, 0o600]);
  });

  it("keeps the pair out of the project's version control", async () => {
    const repo = repoOf("saved-report-ignored-");

    await saveReport(repo, doc, LINES);

    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, env: cleanGitEnv(), encoding: "utf-8" })).toBe("");
  });

  it("fails, leaving no text behind, when a file cannot be put in place", async () => {
    const repo = repoOf("saved-report-fails-");
    // A folder where the data file belongs: nothing can be renamed over it.
    mkdirSync(join(repo, SAVED_DATA), { recursive: true });

    await expect(saveReport(repo, doc, LINES)).rejects.toThrow();
    expect(readdirSync(join(repo, ".delivery"))).not.toContain("last-report.txt");
  });

  it("says a report could not be saved in one sentence, quoting what the system said with control characters taken out", () => {
    expect(notSaved(new Error("EACCES: permission denied\u001B[2J"))).toBe(
      'This report could not be saved to .delivery/last-report.txt and .delivery/last-report.json. The system said: "EACCES: permission denied"',
    );
  });
});

describe("whether the saved text is this report", () => {
  it("is so only when the file holds exactly these lines", async () => {
    const repo = repoOf("saved-report-same-");
    expect(await isSaved(repo, LINES)).toBe(false);

    await saveReport(repo, doc, LINES);

    expect(await isSaved(repo, LINES)).toBe(true);
    expect(await isSaved(repo, [...LINES, "one more line"])).toBe(false);
  });
});
