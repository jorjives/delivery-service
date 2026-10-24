import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_PROJECT } from "../packs/inspection.js";
import { initTempRepo } from "../temp-repo.js";
import { MOVES_FILES, PACKAGE } from "./command-fixtures.js";
import { projectBaseline } from "./project-baseline.js";

/** A fresh pack folder holding the moves pack, its files named relative to the folder itself. */
function packFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-folder-"));
  for (const [name, text] of Object.entries(MOVES_FILES)) {
    const path = join(dir, name.replace(/^moves-pack\//, ""));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

/** The moves pack laid at the repository root, so the pack and the project are the same folder. */
const MOVES_PACK_AT_ROOT: Record<string, string> = Object.fromEntries(
  Object.entries(MOVES_FILES).map(([name, text]) => [name.replace(/^moves-pack\//, ""), text]),
);

describe("projectBaseline", () => {
  it("is no project outside a repository", async () => expect(await projectBaseline(mkdtempSync(join(tmpdir(), "np-")), {}, packFolder())).toEqual(NO_PROJECT));

  it("names the inferred check and the default landing in a project with no config", async () => {
    const repo = initTempRepo("bl-", { "package.json": PACKAGE });
    expect(await projectBaseline(repo, {}, packFolder())).toEqual({
      found: true,
      path: realpathSync(repo),
      config: "none",
      gate: { source: "project", type: "command", summary: "runs `npm test`" },
      closer: { source: "project", type: "commit-to-branch", summary: "commits to a new branch" },
    });
  });

  it("names the closer a JSON config chooses", async () => {
    const repo = initTempRepo("bl-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ closer: { type: "open-pr" } }) });
    expect(await projectBaseline(repo, {}, packFolder())).toMatchObject({
      found: true,
      config: "read",
      closer: { source: "project", type: "open-pr", summary: "opens a pull request" },
    });
  });

  it("does not run a JavaScript config, and says its settings are code", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "bl-marker-"));
    const marker = join(scratch, "ran");
    const repo = initTempRepo("bl-", {
      "package.json": PACKAGE,
      "delivery.config.js": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran"); export default {};`,
    });
    expect(await projectBaseline(repo, {}, packFolder())).toMatchObject({ found: true, config: "code", gate: null, closer: null });
    expect(existsSync(marker)).toBe(false);
  });

  it("degrades, and says so, when the config is not valid JSON", async () => {
    const repo = initTempRepo("bl-", { "package.json": PACKAGE, "delivery.config.json": "{ not json" });
    expect(await projectBaseline(repo, {}, packFolder())).toMatchObject({ found: true, config: "unreadable", gate: null, closer: null });
  });

  it("leaves the check unknown when none can be inferred, and still names the landing", async () => {
    const repo = initTempRepo("bl-", { "README.md": "# Readme\n" });
    expect(await projectBaseline(repo, {}, packFolder())).toMatchObject({
      found: true,
      config: "none",
      gate: null,
      closer: { source: "project", type: "commit-to-branch", summary: "commits to a new branch" },
    });
  });

  it("never reads a config inside the pack folder as the project's", async () => {
    const repo = initTempRepo("bl-", { ...MOVES_PACK_AT_ROOT, "delivery.config.json": JSON.stringify({ closer: { type: "open-pr" } }) });
    expect(await projectBaseline(repo, {}, repo)).toEqual(NO_PROJECT);
  });
});
