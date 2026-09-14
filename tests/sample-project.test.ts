import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { inferGate } from "../src/cli/project.js";
import { REPO_ROOT } from "./helpers.js";

const SAMPLE = join(REPO_ROOT, "examples", "sample-project");

describe("the sample project", () => {
  it("has a test script the harness picks up as its check", async () => {
    expect(await inferGate(SAMPLE)).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
  });

  it("passes its own tests as shipped, so a first run starts from green", () => {
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: SAMPLE, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });

  it("ships only its source, so a copy is ready for git init", () => {
    expect(readdirSync(SAMPLE).sort()).toEqual(["README.md", "add.js", "add.test.js", "package.json"]);
  });
});
