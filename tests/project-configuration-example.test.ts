// The project-configuration example: the complete project docs/project-configuration.md
// walks a reader through. What its commands print is proven by
// tests/project-configuration-guide.test.ts; this file holds what the fixture itself
// must be, as tests/sample-project.test.ts does for the no-configuration sample.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/cli/config.js";
import { REPO_ROOT } from "./helpers.js";

const EXAMPLE = join(REPO_ROOT, "examples", "project-configuration-example");
const config = () => readConfig(join(EXAMPLE, "delivery.config.json"));

describe("the project-configuration example", () => {
  it("checks in a configuration with a project description, a list of tasks and its own agent options", async () => {
    const { domain, tasks, agent } = await config();
    expect(domain?.trim()).toBeTruthy();
    expect(tasks?.length).toBeGreaterThanOrEqual(2);
    expect(agent?.append).toBeDefined();
  });

  it("chooses a built-in check and closing action, so the project needs no code of its own", async () => {
    const { gate, closer } = await config();
    expect(gate?.type).toBe("command");
    expect(closer?.type).toBe("commit-to-branch");
  });

  it("passes its own tests as shipped, so the first task starts from green", () => {
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: EXAMPLE, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });

  it("ships only its source and its configuration, so a copy is ready for git init", () => {
    expect(readdirSync(EXAMPLE).sort()).toEqual(["README.md", "delivery.config.json", "package.json", "text.js", "text.test.js"]);
  });
});
