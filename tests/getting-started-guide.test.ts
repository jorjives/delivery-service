// Slice 5: a newcomer gets from nothing to a finished run by following one
// guide. This runs the guide's own commands and checks that what it says you
// will see is what the command prints, so the guide cannot drift from the tool.
// It stays offline: the actual pack-and-install (global, and project-local for
// `import "delivery-service"`) is tests/getting-started-guide-install.ci.test.ts,
// gated on `DELIVERY_PACK_TESTS` for the same reason tests/packaging.ci.test.ts is.
//
// The steps here run the compiled command from this checkout rather than an
// installed copy: the agent is routed to the vendored scripted agent, which is a
// dev dependency and so is absent from an installed copy (design, Testing). The
// file they run is the same `dist/cli/main.js` an install would contain.

import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { writeMockScript, type MockScript } from "../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { documented, git, outputBlock, REPO_ROOT, runDelivery, sectionOf, useScratch } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/getting-started.md"), "utf-8");
const RUN_TIMEOUT = 120_000;

// A whole sample project.
const scratch = useScratch();

/** The guide's own task text, so the test asks for exactly what the guide tells a reader to ask for. */
function taskInGuide(): string {
  const match = /delivery run --task "([^"]+)"/.exec(guide);
  if (!match?.[1]) throw new Error("the guide has no `delivery run --task \"...\"` command");
  return match[1];
}

/** A scripted agent that writes the greeting the guide's task asks for, so the sample project's `npm test` passes. */
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

let project: string;
let env: NodeJS.ProcessEnv;
let stdout: string;

beforeAll(async () => {
  // Step 2 of the guide, run as written: copy the sample project and make it a repository.
  project = join(scratch("getting-started-"), "sample-project");
  cpSync(join(REPO_ROOT, "examples", "sample-project"), project, { recursive: true });
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "user.email", "harness@example.invalid"]);
  git(project, ["config", "user.name", "Harness"]);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-q", "-m", "Start the sample project"]);

  const scriptPath = join(scratch("getting-started-script-"), "mock.json");
  await writeMockScript(scriptPath, completes);
  env = { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: scratch("gs-state-") };

  const run = runDelivery(["run", "--task", taskInGuide()], { cwd: project, env });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(EXIT.ok);
  stdout = run.stdout;
}, RUN_TIMEOUT);

describe("the getting-started guide", () => {
  it("teaches both the global command install and the project-local library install", () => {
    const install = sectionOf(guide, "## 1. Install the command", "## 2.");
    expect(install).toContain("npm pack");
    expect(install).toContain("npm install -g ./delivery-service-");
    // Where npm's global folder belongs to root, `-g` fails without sudo; the guide gives a
    // route into the reader's own home instead (the packing CI test installs the same way).
    expect(install).toContain("npm install -g --prefix ~/.local ./delivery-service-");
    expect(install).toContain("delivery --version");
    // The guide names no version number. package.json owns the version, so a guide that
    // pinned `0.1.0` would fail this test on the changesets version pull request, which
    // bumps the version and touches nothing else: a release blocked by its own guide,
    // rather than a guide caught drifting from the tool. What is proved instead is that
    // the command a reader installs prints the version this repository claims.
    expect(install).not.toMatch(/\d+\.\d+\.\d+/);
    // A global install puts `delivery` on PATH; it resolves nothing for a bare
    // `import "delivery-service"` in a reader's own project. That needs a second,
    // non-global install of the same tarball, inside that project. Without this line
    // every snippet the other guides show (Task 4) fails with ERR_MODULE_NOT_FOUND for
    // a reader who only ran the global install above.
    expect(install).toMatch(/npm install(?! -g)[^\n]*delivery-service-\*\.tgz/);
    // Actually packing and installing, both ways, is
    // tests/getting-started-guide-install.ci.test.ts (CI only: it needs the registry).
  });

  it("tells the reader how to get a project to try it on, and the commands work", () => {
    const setUp = sectionOf(guide, "## 2. Get a project to try it on", "## 3.");
    expect(setUp).toContain("examples/sample-project");
    expect(setUp).toContain("git init -b main");
    expect(git(project, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
  });

  it("shows the run's progress and its closing sentence exactly as the command prints them", () => {
    for (const line of outputBlock(sectionOf(guide, "## 3. Run your first task", "## 4."))) {
      expect(stdout).toMatch(documented(line));
    }
  });

  it("finishes on a branch the closing sentence names, leaving main alone", () => {
    const branch = /branch (surface\/\S+?)\.$/m.exec(stdout)?.[1];
    expect(branch).toBeDefined();
    expect(git(project, ["branch", "--format=%(refname:short)"]).split("\n")).toContain(branch);
  });

  it("shows what `delivery status` prints afterwards, exactly as it prints it", () => {
    const section = sectionOf(guide, "## 4. Read what happened, later", "## Next steps");
    expect(section).toContain("delivery status");
    const status = runDelivery(["status"], { cwd: project, env });
    expect(status.status).toBe(EXIT.ok);
    for (const line of outputBlock(section)) expect(status.stdout).toMatch(documented(line));
  }, RUN_TIMEOUT);

  it("says what a reader needs, and points on to the other guides", () => {
    const needs = sectionOf(guide, "## What you need", "## 1.");
    expect(needs).toContain("Node.js 22");
    expect(needs).toMatch(/git/);
    expect(needs).toContain("claude auth login");
    const next = sectionOf(guide, "## Next steps");
    // The next step after one task is a whole project: it comes first.
    const firstNext = next.split("\n").find((line) => line.startsWith("- "));
    expect(firstNext).toContain("(project-configuration.md)");
    for (const doc of ["writing-a-gate.md", "writing-a-closer.md", "testing-your-pipeline.md"]) {
      expect(next).toContain(doc);
    }
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });
});
