// Slice 5: Install the Harness Like Any Other Tool and Follow the Guide
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-16 against commit 9d1cfdd
//
// Drives the UAT as a newcomer would: pack the harness for real, install it
// globally from that packed copy into an empty prefix (needs the registry to
// resolve the three runtime dependencies, exactly as
// tests/getting-started-guide-install.ci.test.ts does), and read the version
// back from the installed binary. The installed copy has no vendored scripted
// agent (a dev dependency, absent from a real install: see
// src/cli/agent-session.ts's TEST_MOCK_SCRIPT comment), so continuing the guide
// through a finished run against the sample project drives the same compiled
// dist/cli/main.js from this checkout that the tarball was packed from, routed
// to the vendored scripted agent, exactly as tests/getting-started-guide.test.ts
// does. This file is not CI-gated: unlike the offline/CI split those two files
// keep for `make verify`, a recorded UAT is expected to touch the real registry.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMockScript, type MockScript } from "../../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { git, packTarball, REPO_ROOT, runDelivery, useScratch } from "../helpers.js";

const INSTALL_TIMEOUT = 120_000;
const RUN_TIMEOUT = 60_000;

const scratch = useScratch();

describe("UAT: install the harness from a packed copy and follow the guide to a finished run", () => {
  it(
    "prints the version from an installed copy, finishes the guide's task, and the changelog names the release",
    async () => {
      // Step 1: pack the harness, in a new empty folder, and install it as the guide says.
      const tarball = packTarball(scratch("uat5-pack-"));

      const installPrefix = scratch("uat5-install-");
      execFileSync(
        "npm",
        ["install", "-g", "--prefix", installPrefix, "--prefer-offline", "--no-audit", "--no-fund", tarball],
        { cwd: installPrefix, encoding: "utf-8" },
      );

      // Step 2: type `delivery --version`.
      const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
      const printed = spawnSync(join(installPrefix, "bin", "delivery"), ["--version"], { encoding: "utf-8" });
      expect(printed.status).toBe(0);
      expect(printed.stdout.trim()).toBe(version);
      expect(version).toBe("0.1.0");

      // Step 3: continue through the guide against the sample project until it says the run is finished.
      const project = join(scratch("uat5-sample-"), "sample-project");
      cpSync(join(REPO_ROOT, "examples", "sample-project"), project, { recursive: true });
      git(project, ["init", "-q", "-b", "main"]);
      git(project, ["config", "user.email", "harness@example.invalid"]);
      git(project, ["config", "user.name", "Harness"]);
      git(project, ["add", "-A"]);
      git(project, ["commit", "-q", "-m", "Start the sample project"]);

      const completes: MockScript = {
        expectations: [
          {
            effects: [
              { write: { path: "greet.js", content: "export const greet = (name) => `hello ${name}`;\n" } },
              {
                write: {
                  path: "greet.test.js",
                  content:
                    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from './greet.js';\n\ntest('greets a name', () => assert.equal(greet('ada'), 'hello ada'));\n",
                },
              },
            ],
            json: { status: "completed", rationale: "added greet.js and its test" },
          },
        ],
      };
      const scriptPath = join(scratch("uat5-script-"), "mock.json");
      await writeMockScript(scriptPath, completes);
      const env = { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("uat5-state-") };

      const run = runDelivery(["run", "--task", "add a function that greets a name, with a test"], { cwd: project, env });
      expect(run.status).toBe(EXIT.ok);
      expect(run.stdout).toContain("- done");
      const branch = /branch (surface\/\S+?)\.$/m.exec(run.stdout)?.[1];
      expect(branch).toBeDefined();
      expect(git(project, ["branch", "--format=%(refname:short)"]).split("\n")).toContain(branch);
      expect(git(project, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");

      // Step 4: open CHANGELOG.md and read the latest entry.
      const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf-8");
      const versions = changelog.split("\n").filter((line) => line.startsWith("## "));
      expect(versions[0]).toBe("## 0.1.0");
      expect(changelog).toContain("`delivery`");
    },
    INSTALL_TIMEOUT + RUN_TIMEOUT,
  );
});

describe("AC: the package ships only its built output, readme and changelog, and exposes the library, testing API and command", () => {
  it("declares bin, exports and files as the guide's install relies on", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as Record<string, unknown>;
    expect(pkg.bin).toMatchObject({ delivery: "./dist/cli/main.js" });
    expect(pkg.exports).toMatchObject({
      ".": { default: "./dist/index.js" },
      "./testing": { default: "./dist/testing.js" },
    });
    expect(pkg.files).toEqual(["dist", "packs", "README.md", "CHANGELOG.md"]);
  });
});

describe("AC: running the installed command via npx, without installing, also works", () => {
  it("prints the version through npx --package against the packed tarball", () => {
    const tarball = packTarball(scratch("uat5-npx-pack-"));
    const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };

    const printed = execFileSync("npx", ["--yes", "--package", tarball, "delivery", "--version"], {
      cwd: scratch("uat5-npx-run-"),
      encoding: "utf-8",
      // npx unpacks the tarball into its cache; a scratch cache is removed with the other scratch folders.
      env: { ...process.env, npm_config_cache: scratch("uat5-npx-cache-") },
    });
    expect(printed.trim()).toBe(version);

    // The shared cache must hold no entry for this run's tarball (its path is unique to the run).
    const shared = join(homedir(), ".npm", "_npx");
    const leaked = existsSync(shared)
      ? readdirSync(shared).filter((dir) => {
          const manifest = join(shared, dir, "package.json");
          return existsSync(manifest) && readFileSync(manifest, "utf-8").includes(tarball);
        })
      : [];
    expect(leaked).toEqual([]);
  }, INSTALL_TIMEOUT);
});

describe("AC: the existing guides no longer say the harness is unpublished, and show imports from the package name", () => {
  it("drops the unpublished caveat and imports delivery-service from the package name", () => {
    for (const doc of ["writing-a-gate.md", "writing-a-closer.md", "configuring-a-role.md", "testing-your-pipeline.md"]) {
      const text = readFileSync(join(REPO_ROOT, "docs", doc), "utf-8");
      expect(text).not.toMatch(/not published as a package yet/i);
      expect(text).toMatch(/from ["']delivery-service/);
    }
  });
});
