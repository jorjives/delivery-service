# CLI and Configuration — Slice 5: Install the Harness Like Any Other Tool and Follow the Guide

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Turn the harness into a package a newcomer installs and drives from one guide: a versioned, publish-ready `delivery-service` with a `delivery` binary, a changelog, and a `docs/getting-started.md` that is executed as a test.

**Architecture:** No new runtime code. The work is the package boundary (`bin`, `exports`, `files`, declaration output), the release machinery (changesets, a changelog, a release workflow whose publish step stays off), and documentation that is proven by running it: `tests/packaging.test.ts` packs and installs the package and runs the installed command, `tests/getting-started-guide.test.ts` runs the new guide's own commands against the compiled CLI and the sample project with the agent routed to the vendored scripted agent.

**Tech Stack:** TypeScript compiler (the only build tool), npm (`pack`, `publish --dry-run`), `@changesets/cli`, vitest, GitHub Actions, the vendored `claude-mock`.

## Global Constraints

- The package is `delivery-service`; the binary is `delivery` (design, Packaging).
- ESM only, `"type": "module"`, `engines.node >= 22`, unchanged.
- **Buy-vs-build (Build note):** versioning and the changelog are `changesets`, not `semantic-release` or `release-please` (the repository's commit messages are prose, not Conventional Commits). The TypeScript compiler stays the only build tool: no bundler, no `tsup`/`tshy`.
- **Operability / DX (Operational note):** three release checks exist and run unattended: the getting-started guide executed as a test against the built command and the sample project, an install from a locally packed copy with the installed command run, and a publish dry-run. A release job versions the package and writes the changelog from changeset entries on merges to `main`; its publish step stays disabled and no licence field is added until a human chooses a licence. Contributors gain a changeset step.
- Tests stay offline: every `delivery run` in a test routes the agent to the vendored `claude-mock` through `DELIVERY_TEST_MOCK_SCRIPT`, needing no network, no API key and no sign-in.
- Outward-facing copy (guides, changelog, README) is British English and contains no em-dash; existing guide tests assert `not.toContain("—")` and the new ones do the same.
- `package.json` carries no `license` field and the repository has no `LICENSE` file when this slice ends.

### Facts established before planning (do not re-derive)

- `npm publish --dry-run` at version `0.1.0` **succeeds** (exit 0) with only a "requires you to be logged in" warning. At `0.0.1` it fails, because `delivery-service@0.0.1` already exists on npmjs.com.
- **The npm name `delivery-service` belongs to someone else** (`artem.skyscanner`, a 208-byte stub published over a year ago). The first real publish will therefore need a scope or another name. This is a second human gate beside the licence, recorded in the release workflow's comment in Task 1. Do not rename the package in this slice.
- `tsc -p tsconfig.build.json --declaration` emits cleanly today: declaration output adds no type errors.
- `npm pack` then `npm install <tgz>` into an empty folder takes about 4 seconds with a warm npm cache, and the installed `delivery --version` runs. `npx --package <tgz> delivery --version` works; `npx <tgz>` does not (npx treats the path as a script and fails with "Permission denied").
- The exact output of a successful run and of `delivery status` against the sample project is captured verbatim in Task 3; use it rather than inventing phrasing.

## Scaffolding Impact

- `CONTRIBUTING.md` (how to describe a change in a changeset; the release checks) → updated in Task 1
- `.github/workflows/release.yml` (new: changesets version job, publish disabled) → created in Task 1
- `.github/workflows/ci.yml` (publish dry-run step) → updated in Task 2
- `README.md` (drops "Until the package is published, build and link…", points at the getting-started guide) → updated in Task 3
- `examples/sample-project/README.md` (step 3 tells the reader to `npm run build && npm link`) → updated in Task 3
- `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md` (drop "not published as a package yet", import from the package name) → updated in Task 4
- `Makefile` — deliberately unchanged: `make verify` stays offline, so the publish dry-run (which contacts the registry) is a CI step only. Said so in `CONTRIBUTING.md` in Task 1.

---

## Task 1: Version the harness with changesets and write the changelog

**Files:**
- Modify: `package.json` (version, `devDependencies`)
- Modify: `package-lock.json` (npm writes it)
- Create: `.changeset/config.json`, `.changeset/README.md` (both written by `changeset init`)
- Create: `CHANGELOG.md` (written by `changeset version`)
- Create: `.github/workflows/release.yml`
- Modify: `CONTRIBUTING.md`
- Test: `tests/release.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `version` `0.1.0` in `package.json` and a `CHANGELOG.md` at the repository root. Task 2 asserts both ship in the packed tarball; Task 3's guide prints `0.1.0`.

- [ ] **Step 1: Write the failing test**

Create `tests/release.test.ts`:

```ts
// Slice 5: the harness is released like any other package. The version, the
// changelog and the licence gate are the promises this file holds: publishing
// must stay off until a human chooses a licence, so the gate is asserted rather
// than trusted to a comment.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
const pkg = JSON.parse(read("package.json")) as Record<string, unknown> & { version: string };

describe("releasing the harness", () => {
  it("starts at 0.1.0: usable, with no stability promise yet", () => {
    expect(pkg.version).toBe("0.1.0");
  });

  it("declares no licence, and ships no LICENSE file, until a human chooses one", () => {
    expect(Object.keys(pkg)).not.toContain("license");
    expect(existsSync(join(REPO_ROOT, "LICENSE"))).toBe(false);
  });

  it("has a changelog whose newest entry is the 0.1.0 release, in plain sentences", () => {
    const changelog = read("CHANGELOG.md");
    const versions = changelog.split("\n").filter((line) => line.startsWith("## "));
    expect(versions[0]).toBe("## 0.1.0");
    expect(changelog).toContain("`delivery`");
    expect(changelog).not.toContain("—"); // no em-dashes in outward-facing copy
  });

  it("versions the package from changeset entries on merges to main", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain("changesets/action@v1");
    expect(workflow).toMatch(/^\s*version: npx changeset version$/m);
    expect(JSON.parse(read(".changeset/config.json"))).toMatchObject({ baseBranch: "main" });
  });

  it("keeps the publish step off, and says what a human must settle to turn it on", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).not.toMatch(/^\s*publish:/m); // only the commented-out form may appear
    expect(workflow).toContain("LICENSE");
    expect(workflow).toContain("NPM_TOKEN");
  });

  it("tells contributors how to describe their change", () => {
    expect(read("CONTRIBUTING.md")).toContain("npx changeset");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/release.test.ts`
Expected: FAIL — the version is `0.0.1`, and `CHANGELOG.md`, `.changeset/config.json` and `.github/workflows/release.yml` do not exist.

- [ ] **Step 3: Install changesets and initialise it**

```bash
npm install --save-dev @changesets/cli
npx changeset init
```

Then make sure `.changeset/config.json` names the base branch (edit it if `changeset init` wrote something else):

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

Keep the `$schema` version `changeset init` wrote. Leave `access` as `restricted`: publishing is off, and the access level is part of the same human decision.

- [ ] **Step 4: Describe the release in a changeset and apply it**

Create `.changeset/first-delivery-command.md`:

```md
---
"delivery-service": minor
---

First release of the `delivery` command. Run a task against a git repository from the command line, pick up a run that was interrupted, and read what happened to a run after it ended. The library and the testing API can be imported as `delivery-service` and `delivery-service/testing`.
```

Then apply it, which bumps the version to `0.1.0`, writes `CHANGELOG.md` and consumes the changeset file:

```bash
npx changeset version
```

The generated changelog is changesets' own format: a `# delivery-service` title, then one `## <version>` section per release, newest first, with the entries grouped under `### Minor Changes`. That is the Keep a Changelog shape the slice asks for; do not hand-write a second changelog or a custom generator.

- [ ] **Step 5: Add the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      # Opens or updates a version pull request from the changeset files on main:
      # it bumps the version and writes the changelog entry. Merging that pull
      # request is what makes a release.
      - uses: changesets/action@v1
        with:
          version: npx changeset version
          # publish: npx changeset publish
          #
          # Publishing is deliberately off. Two things a person must settle first:
          #   1. A licence. There is no LICENSE file and package.json declares no
          #      `license`. The same decision settles the effective licence of the
          #      vendored claude-mock copy (vendor/README.md).
          #   2. The name. `delivery-service` on npmjs.com belongs to someone else,
          #      so the first publish needs a scope or a different name.
          # When both are settled: add LICENSE and the `license` field, add the
          # NPM_TOKEN secret, and uncomment the publish line above.
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 6: Tell contributors about the changeset step**

In `CONTRIBUTING.md`, add this section immediately before `## Pull requests`:

```markdown
## Describing your change

Every change that a user of the package would notice needs a changeset: a short
file describing the change in plain sentences, which becomes the changelog entry.

```bash
npx changeset
```

Pick `patch`, `minor` or `major`, then write a sentence or two saying what changed
from a reader's point of view. Commit the file it writes under `.changeset/` with
your change. On a merge to `main`, the release workflow turns the changesets it
finds into a version bump and a `CHANGELOG.md` entry.

Publishing is off until a licence is chosen, so the release checks stop at a dry
run: CI runs `npm publish --dry-run` after the tests. `make verify` leaves it out
deliberately, because the dry run contacts the registry and the local check stays
offline.
```

Also update the `## Pull requests` list, adding after `- One concern per PR`:

```markdown
- A changeset describes anything a user would notice (`npx changeset`)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/release.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md CONTRIBUTING.md .changeset .github/workflows/release.yml tests/release.test.ts
git commit -m "Version the harness at 0.1.0 with changesets

The harness had no version worth publishing and no changelog, so nobody could
tell what a given copy contained. Changesets fits the repository's prose commit
messages, where semantic-release and release-please would require Conventional
Commits. Publishing stays off: it waits on a licence decision, and on the npm
name, which belongs to another publisher.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Ship the package: bin, exports, files and types

**Files:**
- Modify: `package.json` (description, repository, exports, files, prepack)
- Modify: `tsconfig.build.json` (declaration output)
- Modify: `.github/workflows/ci.yml` (publish dry-run step)
- Test: `tests/packaging.test.ts`

**Interfaces:**
- Consumes: `version` `0.1.0` and `CHANGELOG.md` from Task 1.
- Produces: the published entry points `delivery-service` → `dist/index.js` and `delivery-service/testing` → `dist/testing.js`, with `dist/index.d.ts` and `dist/testing.d.ts` beside them. Task 4's guide snippets import by those names and resolve through this `exports` map.

- [ ] **Step 1: Write the failing test**

Create `tests/packaging.test.ts`:

```ts
// Slice 5: the harness is installed like any other tool. This packs the package
// the way `npm publish` would, installs the tarball into an empty folder, and
// runs the installed command, so the boundary that reaches a user is exercised
// rather than described. `--ignore-scripts` on the pack is deliberate: `prepack`
// rebuilds `dist/`, and other test files are running the compiled command at the
// same time.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
  version: string;
  bin: Record<string, string>;
  exports: Record<string, { types: string; default: string }>;
};

const INSTALL_TIMEOUT = 300_000;
let tarball: string;
let packed: string[];

/** What `npm publish` would send, without running `prepack`: the `dist/` the suite already built. */
function packFiles(): string[] {
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: REPO_ROOT, encoding: "utf-8" }),
  ) as [{ files: { path: string }[] }];
  return report.files.map((file) => file.path);
}

beforeAll(() => {
  const destination = mkdtempSync(join(tmpdir(), "delivery-pack-"));
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as [{ filename: string }];
  tarball = join(destination, report.filename);
  packed = packFiles();
}, INSTALL_TIMEOUT);

describe("the package", () => {
  it("exposes the delivery command, the library and the testing API", () => {
    expect(pkg.bin).toEqual({ delivery: "./dist/cli/main.js" });
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
    expect(pkg.exports["./testing"]).toEqual({ types: "./dist/testing.d.ts", default: "./dist/testing.js" });
  });

  it("ships its built output, its readme and its changelog, and nothing else", () => {
    const extras = packed.filter((path) => !path.startsWith("dist/"));
    expect(extras.sort()).toEqual(["CHANGELOG.md", "README.md", "package.json"]);
    for (const file of ["dist/cli/main.js", "dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/testing.d.ts"]) {
      expect(packed).toContain(file);
    }
  });

  it("installs from a packed copy into an empty folder and gives a working delivery command", () => {
    const folder = mkdtempSync(join(tmpdir(), "delivery-install-"));
    execFileSync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund", tarball], {
      cwd: folder,
      encoding: "utf-8",
    });
    const { stdout, status } = spawnSync(join(folder, "node_modules", ".bin", "delivery"), ["--version"], {
      encoding: "utf-8",
    });
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  }, INSTALL_TIMEOUT);

  it("runs through npx without being installed first", () => {
    const folder = mkdtempSync(join(tmpdir(), "delivery-npx-"));
    const stdout = execFileSync("npx", ["--yes", "--prefer-offline", "--package", tarball, "delivery", "--version"], {
      cwd: folder,
      encoding: "utf-8",
    });
    expect(stdout.trim()).toBe(pkg.version);
  }, INSTALL_TIMEOUT);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && npx vitest run tests/packaging.test.ts`
Expected: FAIL — there is no `exports` map, the pack contains the whole repository (roughly 338 files), and there are no `.d.ts` files.

- [ ] **Step 3: Declare the package boundary**

In `package.json`, add these keys after `"bin"` (leave `name`, `version`, `type`, `bin`, `engines` and the dependency blocks as they are):

```json
  "description": "A deterministically gated agent delivery harness, with a delivery command",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jorjives/delivery-service.git"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "default": "./dist/testing.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "CHANGELOG.md"
  ],
```

and add one script beside the existing `build`, so a packed or published copy is never built from a stale `dist/`:

```json
    "prepack": "npm run build",
```

- [ ] **Step 4: Emit type declarations**

In `tsconfig.build.json`, add `"declaration": true` to `compilerOptions`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

No `declarationMap`: the map would point at `src/`, which the package does not ship.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build && npx vitest run tests/packaging.test.ts`
Expected: PASS (4 tests). The two install tests each take a few seconds.

- [ ] **Step 6: Add the publish dry-run to CI**

In `.github/workflows/ci.yml`, add a final step to the `check` job, after `npm test`:

```yaml
      # The third release check: what `npm publish` would send, without sending it.
      # It contacts the registry, so `make verify` leaves it out and CI carries it.
      - run: npm publish --dry-run
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.build.json .github/workflows/ci.yml tests/packaging.test.ts
git commit -m "Make the package installable: bin, exports, files and types

The package shipped no entry points and no allow-list, so an install got the
whole repository and no way to import the library. The pack is now exercised the
way a user meets it: packed, installed into an empty folder, and run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: A getting-started guide, executed as a test

**Files:**
- Create: `docs/getting-started.md`
- Create: `tests/getting-started-guide.test.ts`
- Modify: `README.md`
- Modify: `examples/sample-project/README.md`

**Interfaces:**
- Consumes: the packed tarball shape and `delivery --version` printing `0.1.0` (Tasks 1 and 2); `runDelivery` and `REPO_ROOT` from `tests/helpers.ts`; `TEST_MOCK_SCRIPT` from `src/cli/agent-session.js`; `writeMockScript` and `MockScript` from `src/testing.js`.
- Produces: `docs/getting-started.md`, which Task 4's guides point at for the install step.

- [ ] **Step 1: Write the failing test**

Create `tests/getting-started-guide.test.ts`:

```ts
// Slice 5: a newcomer gets from nothing to a finished run by following one
// guide. This runs the guide's own commands and checks that what it says you
// will see is what the command prints, so the guide cannot drift from the tool.
//
// The install step is run exactly as written, save for `--prefix`, which keeps a
// test off the machine's global folder. The steps after it run the compiled
// command from this checkout rather than the installed copy: the agent is routed
// to the vendored scripted agent, which is a dev dependency and so is absent from
// an installed copy (design, Testing). The file they run is the same
// `dist/cli/main.js` the install contains.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { writeMockScript, type MockScript } from "../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { REPO_ROOT, runDelivery, sectionOf } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/getting-started.md"), "utf-8");
const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
const INSTALL_TIMEOUT = 300_000;
const RUN_TIMEOUT = 120_000;

/** A ```text block: what the guide says you will see. */
function outputBlock(section: string): string[] {
  const match = /```text\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) throw new Error(`no \`\`\`text block in:\n${section}`);
  return match[1].split("\n").filter(Boolean);
}

/** One documented line as a pattern: the run id and the timestamp differ every run. */
function documented(line: string): RegExp {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("<run-id>", "\\S+").replaceAll("<when>", ".+")}$`, "m");
}

/** The guide's own task text, so the test asks for exactly what the guide tells a reader to ask for. */
function taskInGuide(): string {
  const match = /delivery run --task "([^"]+)"/.exec(guide);
  if (!match?.[1]) throw new Error("the guide has no `delivery run --task \"...\"` command");
  return match[1];
}

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();

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
  project = join(mkdtempSync(join(tmpdir(), "getting-started-")), "sample-project");
  cpSync(join(REPO_ROOT, "examples", "sample-project"), project, { recursive: true });
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "user.email", "harness@example.invalid"]);
  git(project, ["config", "user.name", "Harness"]);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-q", "-m", "Start the sample project"]);

  const scriptPath = join(mkdtempSync(join(tmpdir(), "getting-started-script-")), "mock.json");
  await writeMockScript(scriptPath, completes);
  env = { ...process.env, [TEST_MOCK_SCRIPT]: scriptPath, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "gs-state-")) };

  const run = runDelivery(["run", "--task", taskInGuide()], { cwd: project, env });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(EXIT.ok);
  stdout = run.stdout;
}, RUN_TIMEOUT);

describe("the getting-started guide", () => {
  it("installs the packed command and prints the version it says it will", () => {
    const install = sectionOf(guide, "## 1. Install the command", "## 2.");
    expect(install).toContain("npm pack");
    expect(install).toContain("npm install -g ./delivery-service-" + version + ".tgz");
    expect(install).toContain("delivery --version");
    expect(outputBlock(install)).toContain(version);

    const destination = mkdtempSync(join(tmpdir(), "gs-global-"));
    const [report] = JSON.parse(
      execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      }),
    ) as [{ filename: string }];
    execFileSync("npm", ["install", "-g", "--prefix", destination, join(destination, report.filename)], {
      encoding: "utf-8",
    });
    const printed = spawnSync(join(destination, "bin", "delivery"), ["--version"], { encoding: "utf-8" });
    expect(printed.stdout.trim()).toBe(version);
  }, INSTALL_TIMEOUT);

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
    const section = sectionOf(guide, "## 4. Read what happened, later", "## Where to go next");
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
    const next = sectionOf(guide, "## Where to go next");
    for (const doc of ["writing-a-gate.md", "writing-a-closer.md", "testing-your-pipeline.md"]) {
      expect(next).toContain(doc);
    }
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts`
Expected: FAIL — `docs/getting-started.md` does not exist (`ENOENT`).

- [ ] **Step 3: Write the guide**

Create `docs/getting-started.md`. The output blocks below are verbatim from a real run against the sample project; `<run-id>` and `<when>` are the only parts that change between runs.

````markdown
# Getting started

This guide takes you from nothing to a finished run: you install the `delivery`
command, point it at a small sample project, and watch an agent do a task your
own tests check. It takes about ten minutes, and you do not need to read any
harness source to follow it.

## What you need

- Node.js 22 or later, and `git`.
- Claude Code, signed in. Check with `claude auth status`; if it says you are not
  signed in, run `claude auth login`, or set `ANTHROPIC_API_KEY`.
- A copy of the harness checkout, which is where you pack the command from.

## 1. Install the command

The harness is not on the public npm registry yet: its first publication waits on
a licence decision. Until then you install it from a copy you pack yourself, which
is what the rest of this guide assumes.

In the harness checkout:

```bash
npm install
npm pack
```

That writes `delivery-service-0.1.0.tgz` in the checkout. Install it:

```bash
npm install -g ./delivery-service-0.1.0.tgz
```

Check that the command is there:

```bash
delivery --version
```

```text
0.1.0
```

If you would rather not install anything, run it straight from the packed file:

```bash
npx --package ./delivery-service-0.1.0.tgz delivery --version
```

## 2. Get a project to try it on

The harness ships a sample project: one function, one test, and a `test` script,
which is all a run needs. Copy it somewhere outside the checkout and make it a
git repository:

```bash
cp -r examples/sample-project ~/sample-project
cd ~/sample-project
git init -b main
git add -A
git commit -m "Start the sample project"
```

## 3. Run your first task

Say what you want in plain English:

```bash
delivery run --task "add a function that greets a name, with a test"
```

The agent works on its own copy of your project, `npm test` decides whether the
change is good, and the work is committed to a new branch. You will see:

```text
Starting run <run-id>: add a function that greets a name, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that greets a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
```

Your `main` branch is untouched. Read what the agent did with
`git log -p surface/<run-id>`, and merge it yourself if you like it.

If the run stops before it finishes, because you closed the terminal or pressed
Ctrl-C, run `delivery run` again in the same folder: it picks the run up where it
left off rather than starting over.

## 4. Read what happened, later

You do not have to watch a run. In the same folder, at any time afterwards:

```bash
delivery status
```

```text
Run <run-id>, started <when>: add a function that greets a name, with a test
Done: the change for "add a function that greets a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
It finished <when>.
main was not changed. To look at the work: git log surface/<run-id>
```

`delivery status` only ever reads, so it is safe while a run is still going. If a
run stopped because it needs a decision from you, that decision is the first thing
it prints, with the evidence behind it underneath.

## Where to go next

- Settings that belong to a project, such as the check, the closing action and the
  attempt limits, live in a `delivery.config.json` beside your code: see the
  [readme](../README.md).
- [Writing a gate](writing-a-gate.md): use a check other than `npm test`, or write
  your own.
- [Writing a closer](writing-a-closer.md): merge the work back, open a pull
  request, or deliver it your own way.
- [Testing your delivery pipeline](testing-your-pipeline.md): test your gate,
  closer and role configurations against a scripted agent.
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Point the readmes at the guide**

In `README.md`, replace the sentence in the "Run a task from the command line" section:

```markdown
You need Node 22 or later, git, and a signed-in Claude Code (`claude auth login`, or set
`ANTHROPIC_API_KEY`). The command checks the sign-in before it starts. Until the package is
published, build and link the command from this checkout with `npm run build && npm link`.
```

with:

```markdown
You need Node 22 or later, git, and a signed-in Claude Code (`claude auth login`, or set
`ANTHROPIC_API_KEY`). The command checks the sign-in before it starts. To install the command,
follow [Getting started](docs/getting-started.md): it packs this checkout and installs the
result, because the package is not on the public registry until a licence is chosen.
```

In the same file, replace the "Quick start" block:

```markdown
## Quick start

```bash
npm install
npm test
```
```

with:

```markdown
## Quick start

New here? [Getting started](docs/getting-started.md) takes you from installing the command to a
finished run against the sample project.

Working on the harness itself:

```bash
npm install
npm test
```
```

and add the guide to the "Documentation" list, as its first entry:

```markdown
- [Getting started](docs/getting-started.md): install the command and finish your first run
```

In `examples/sample-project/README.md`, replace step 3:

```markdown
3. If `delivery` is not on your `PATH` yet, run `npm run build && npm link` in the harness
   checkout.
```

with:

```markdown
3. If `delivery` is not on your `PATH` yet, install it as
   [Getting started](../../docs/getting-started.md) describes.
```

- [ ] **Step 6: Run the test again to verify the readme edits kept it passing**

Run: `npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add docs/getting-started.md tests/getting-started-guide.test.ts README.md examples/sample-project/README.md
git commit -m "Add a getting-started guide and run it as a test

A newcomer had no single path from nothing to a finished run, and the readmes
still told people to link the command from a checkout. The guide's own commands
and its output blocks are executed against the built command and the sample
project, so it fails the moment the tool stops matching what it promises.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Point the existing guides at the package

**Files:**
- Modify: `docs/testing-your-pipeline.md`, `docs/configuring-a-role.md`, `docs/writing-a-gate.md`, `docs/writing-a-closer.md`
- Modify: `tests/testing-your-pipeline-guide.test.ts` (snippets resolve the package by name)
- Modify: `tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts:71` (the import line it asserts)

**Interfaces:**
- Consumes: the `exports` map from Task 2 (`delivery-service` and `delivery-service/testing`) and `docs/getting-started.md` from Task 3.
- Produces: no code interface. After this task no guide says the harness is unpublished, and every guide snippet imports from the package name.

- [ ] **Step 1: Make the pipeline guide's test resolve the package by name**

This is the failing test for the task: it stops accepting `./src/` imports and starts resolving `delivery-service` the way a reader's install does, through a `node_modules` entry pointing at this checkout, so the `exports` map is what the snippets go through.

In `tests/testing-your-pipeline-guide.test.ts`, replace the scratch-directory setup and `stage`:

```ts
// A reader saves each snippet at the repository root, so it imports "./src/...".
// Staged outside the checkout instead, those imports point back at it. The package.json
// makes the scratch files ES modules, as the repository's own package.json does for a
// reader's; the tsconfig type-checks them with the repository's own compiler options.
const scratch = mkdtempSync(join(tmpdir(), "pipeline-guide-"));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
```

with:

```ts
// A reader installs the package and imports it by name, so the snippets are staged
// in a scratch folder where `delivery-service` resolves to this checkout through its
// own `exports` map: the same two entry points an installed copy offers, `dist/` and
// all. The package.json makes the scratch files ES modules, as a reader's would; the
// tsconfig type-checks them with the repository's own compiler options.
const scratch = mkdtempSync(join(tmpdir(), "pipeline-guide-"));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
mkdirSync(join(scratch, "node_modules"));
symlinkSync(REPO_ROOT, join(scratch, "node_modules", "delivery-service"), "dir");
if (!existsSync(join(REPO_ROOT, "dist", "index.d.ts"))) {
  throw new Error("dist is missing or has no types: run `npm run build` (npm test does this for you)");
}
```

and replace `stage`:

```ts
function stage(name: string): string {
  const source = snippet(name);
  if (!source.includes('from "./src/')) throw new Error(`${name} does not import the harness from "./src/"`);
  const path = join(scratch, name);
  writeFileSync(path, source.replaceAll('from "./src/', `from "${REPO_ROOT}/src/`));
  return path;
}
```

with:

```ts
function stage(name: string): string {
  const source = snippet(name);
  if (!source.includes('from "delivery-service')) {
    throw new Error(`${name} does not import the harness from "delivery-service"`);
  }
  const path = join(scratch, name);
  writeFileSync(path, source); // staged verbatim: the scratch folder resolves the package by name
  return path;
}
```

Add `mkdirSync` and `symlinkSync` to the existing `node:fs` import (`existsSync` is already imported).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: FAIL — "fake-agent.ts does not import the harness from "delivery-service"", because the guide still imports `./src/testing.js`.

- [ ] **Step 3: Repoint the testing guide**

In `docs/testing-your-pipeline.md`, replace this paragraph:

```markdown
Everything below is imported from the harness's two entry points, from the
repository root: `./src/index.js`, and `./src/testing.js` for the testing API
(the harness is not published as a package yet). Run the snippets with
`npx tsx`.
```

with:

```markdown
Everything below is imported from the harness's two entry points:
`delivery-service`, and `delivery-service/testing` for the testing API. Run the
snippets with `npx tsx`.
```

Replace the "What you need" list's second entry:

```markdown
- A clone of the harness with `npm install` run in it. The scripted agent,
  `claude-mock`, is vendored in `vendor/claude-mock` and installed with
  everything else.
```

with:

```markdown
- The harness installed, as [Getting started](getting-started.md) describes. The
  scripted agent, `claude-mock`, is vendored in the harness checkout and
  installed with everything else there, so the sections that use it need that
  checkout: `fakeAgentPort` works from an installed copy alone.
```

Then change every import line in the guide's snippets:

- `from "./src/index.js"` becomes `from "delivery-service"`
- `from "./src/testing.js"` becomes `from "delivery-service/testing"`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: PASS. The snippets run and type-check against `delivery-service` resolved through the scratch folder.

- [ ] **Step 5: Repoint the other three guides**

In `docs/configuring-a-role.md`, `docs/writing-a-gate.md` and `docs/writing-a-closer.md`, replace the sentence each of them carries:

```markdown
`./src/index.js` from the repository root (the harness is not published as a
package yet). Run the snippets with `npx tsx`.
```

The replacement keeps each guide's own lead-in and ends:

```markdown
`delivery-service`, the package's main import. Install it as
[Getting started](getting-started.md) describes, and run the snippets with `npx tsx`.
```

Then in all three, change every snippet import:

- `from "./src/index.js"` becomes `from "delivery-service"`
- `from "./src/testing.js"` becomes `from "delivery-service/testing"`

Confirm nothing is left behind:

```bash
grep -rn 'not published\|\./src/index\.js\|\./src/testing\.js' docs/*.md
```

Expected: no matches.

- [ ] **Step 6: Update the assertion that pins the role guide's import line**

In `tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts`, replace line 71:

```ts
    expect(guide).toContain('import { WorkerEnvelope, type RoleConfig } from "./src/index.js"');
```

with:

```ts
    expect(guide).toContain('import { WorkerEnvelope, type RoleConfig } from "delivery-service"');
```

- [ ] **Step 7: Run the affected tests to verify they pass**

Run: `npx vitest run tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts tests/testing-your-pipeline-guide.test.ts tests/writing-a-closer-guide.test.ts tests/gate-interface/6-write-a-gate-from-the-guide-alone.test.ts tests/agent-mock/5-test-your-own-pipeline-by-following-one-guide.test.ts`
Expected: PASS. The closer and gate guide tests extract `.mjs` blocks, which import nothing from the harness, so they are unaffected; run them to confirm that.

- [ ] **Step 8: Commit**

```bash
git add docs/testing-your-pipeline.md docs/configuring-a-role.md docs/writing-a-gate.md docs/writing-a-closer.md tests/testing-your-pipeline-guide.test.ts tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts
git commit -m "Import the harness by package name in every guide

The guides told readers the harness was not published and had them import paths
inside a clone, which stopped being true the moment the package shipped entry
points. The pipeline guide's snippets now resolve the package by name through its
own exports map, so a broken export fails the guide test rather than a reader.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the reviewer

- **The npm name is taken.** `delivery-service` on npmjs.com belongs to another publisher, so the first real publish needs a scope or another name. The publish step is off for the licence decision anyway; both gates are named together in the release workflow's comment.
- **Keep a Changelog form** is read as changesets' own output: a title, one `## <version>` section per release newest first, changes grouped by bump size. Writing a second changelog generator to match the letter of the phrase would hand-roll what the Build note says to buy.
- **What the install test does not cover.** An installed copy cannot run the scripted agent, because `claude-mock` is a dev dependency (design, Non-goals; COULD 15 is the public rehearsal mode that would change this). So the install checks run `delivery --version`, and the getting-started guide's run steps drive the same compiled `dist/cli/main.js` from this checkout.
