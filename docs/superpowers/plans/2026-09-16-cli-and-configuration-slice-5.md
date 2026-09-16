# CLI and Configuration — Slice 5: Install the Harness Like Any Other Tool and Follow the Guide

> **Status:** ✅ Complete — 2026-09-16 — `7bdfff8`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Turn the harness into a package a newcomer installs and drives from one guide: a versioned, publish-ready `delivery-service` with a `delivery` binary, a changelog, and a `docs/getting-started.md` that is executed as a test.

**Architecture:** No new runtime code. The work is the package boundary (`bin`, `exports`, `files`, declaration output), the release machinery (changesets, a changelog, a release workflow whose publish step stays off), and documentation that is proven by running it. Two kinds of test carry this: `tests/packaging.test.ts` and `tests/getting-started-guide.test.ts` prove the boundary and the guide's text and run steps offline, against `dist/` and `npm pack --dry-run` alone; `tests/packaging.ci.test.ts` and `tests/getting-started-guide-install.ci.test.ts` actually pack, install and run the tarball, which needs the registry or a warm npm cache, so their `describe` blocks are gated on `DELIVERY_PACK_TESTS`, an environment variable set on nothing but the CI workflow's own `npm test` step, and are skipped, not run, under a plain local `npm test`/`make verify` (design, Testing: "Publish readiness").

**Tech Stack:** TypeScript compiler (the only build tool), npm (`pack`, `publish --dry-run`), `@changesets/cli`, vitest, GitHub Actions, the vendored `claude-mock`.

## Global Constraints

- The package is `delivery-service`; the binary is `delivery` (design, Packaging).
- ESM only, `"type": "module"`, `engines.node >= 22`, unchanged.
- **Buy-vs-build (Build note):** versioning and the changelog are `changesets`, not `semantic-release` or `release-please` (the repository's commit messages are prose, not Conventional Commits). The TypeScript compiler stays the only build tool: no bundler, no `tsup`/`tshy`.
- **Operability / DX (Operational note):** three release checks exist and run unattended: the getting-started guide executed as a test against the built command and the sample project, an install from a locally packed copy with the installed command run, and a publish dry-run. A release job versions the package and writes the changelog from changeset entries on merges to `main`; its publish step stays disabled and no licence field is added until a human chooses a licence. Contributors gain a changeset step.
- **`npm test` (and `make verify`, which runs it) stays registry-free.** Every `delivery run` in a test routes the agent to the vendored `claude-mock` through `DELIVERY_TEST_MOCK_SCRIPT`, needing no network, no API key and no sign-in. The pack-and-install checks are the one thing that would break this: packing the tarball and installing it into an empty folder resolves the three runtime dependencies (`@anthropic-ai/claude-agent-sdk`, `commander`, `zod`) from the registry or the npm cache. The design puts those checks in CI, not the local gate (design, Testing: "Publish readiness"; Operability: "CI ... additionally builds the package, exercises an install from a local pack, and runs a publish dry-run"), so this plan wraps each in `describe.skipIf(!process.env.DELIVERY_PACK_TESTS)`: skipped under a bare local `npm test`, run as part of the same `npm test` command in CI, which sets `DELIVERY_PACK_TESTS=1` on that one step (Task 2 Step 7). The gate is this project's own variable rather than the ambient `CI`, which many runners and agent harnesses set: `make verify` is autoloop's unattended gate, and a promise that it stays registry-free must not depend on what the surrounding tool happens to export. A contributor who wants to run one locally sets `DELIVERY_PACK_TESTS=1` themselves. See Task 2 Step 1 and Task 3 Step 1.
- Outward-facing copy (guides, changelog, README) is British English and contains no em-dash; existing guide tests assert `not.toContain("—")` and the new ones do the same.
- `package.json` carries no `license` field and the repository has no `LICENSE` file when this slice ends.

### Facts established before planning (do not re-derive)

- `npm publish --dry-run` at version `0.1.0` **succeeds** (exit 0) with only a "requires you to be logged in" warning. At `0.0.1` it fails, because `delivery-service@0.0.1` already exists on npmjs.com.
- **The npm name `delivery-service` belongs to someone else** (`artem.skyscanner`, a 208-byte stub published over a year ago). The first real publish will therefore need a scope or another name. This is a second human gate beside the licence, recorded in the release workflow's comment in Task 1. Do not rename the package in this slice.
- `tsc -p tsconfig.build.json --declaration` emits cleanly today: declaration output adds no type errors.
- `npm pack` then `npm install <tgz>` into an empty folder takes about 4 seconds with a warm npm cache, and the installed `delivery --version` runs. `npx --package <tgz> delivery --version` works; `npx <tgz>` does not (npx treats the path as a script and fails with "Permission denied").
- **A global install (`npm install -g`) puts `delivery` on `PATH`; it does nothing for `import "delivery-service"`.** A bare specifier resolves through a project's own `node_modules`, which only a local install (`npm install <path-to-tgz>` inside that project, no `-g`) creates. Every guide that has a reader import the package (`testing-your-pipeline.md`, `configuring-a-role.md`, `writing-a-gate.md`, `writing-a-closer.md`) therefore needs the local install taught somewhere a reader following it will see, not just the global one. This plan teaches both in `docs/getting-started.md` (Task 3) and asserts both from the guide test.
- The exact output of a successful run and of `delivery status` against the sample project is captured verbatim in Task 3; use it rather than inventing phrasing.

## Scaffolding Impact

- `CONTRIBUTING.md` (how to describe a change in a changeset; the release checks; what stays offline) → updated in Task 1
- `.github/workflows/release.yml` (new: changesets version job, publish disabled) → created in Task 1
- `.github/workflows/ci.yml` (the publish dry-run step, and `DELIVERY_PACK_TESTS=1` on the existing `npm test` step, which is what arms the `*.ci.test.ts` checks; they need no step of their own) → updated in Task 2
- `README.md` (drops "Until the package is published, build and link…", points at the getting-started guide) → updated in Task 3
- `examples/sample-project/README.md` (step 3 tells the reader to `npm run build && npm link`) → updated in Task 3
- `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md` (drop "not published as a package yet", import from the package name, point at the local install in `docs/getting-started.md`) → updated in Task 4
- `.gitignore` (`*.tgz`: the getting-started guide tells a reader to `npm pack` inside the checkout, and the new tests pack too) → updated in Task 2
- `Makefile` — deliberately unchanged: `npm test` (and `make verify`, which runs it) stays registry-free. The two checks that pack and install a real tarball (Tasks 2 and 3) live in files named `*.ci.test.ts`; each wraps its `describe` in `describe.skipIf(!process.env.DELIVERY_PACK_TESTS)`, so a bare local run skips it and CI's `npm test` runs it because that one workflow step sets `DELIVERY_PACK_TESTS=1`. `CONTRIBUTING.md`'s claim that the local check is offline stays true, whatever `CI` happens to be set to.

---

## Task 1: Version the harness with changesets and write the changelog ✅ DONE (deliver-slice)

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
      # Needs "Allow GitHub Actions to create and approve pull requests" enabled in
      # the repository's Actions settings; without it the action fails when it tries
      # to open the version pull request. That setting is the only thing this job
      # needs beyond the default GITHUB_TOKEN while publishing stays off.
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

Publishing is off until a licence is chosen. Three further release checks exist:
packing the package and installing it into an empty folder, running that
install's `delivery --version`, and `npm publish --dry-run`. The first two live
in `tests/packaging.ci.test.ts` and `tests/getting-started-guide-install.ci.test.ts`,
each gated on the `DELIVERY_PACK_TESTS` environment variable, because installing
a real tarball resolves the package's runtime dependencies from the registry or
the npm cache: a bare local `npm test` skips them and stays offline; CI runs
them, because its `npm test` step sets `DELIVERY_PACK_TESTS=1`. Run one yourself
with `DELIVERY_PACK_TESTS=1 npx vitest run <file>`. The dry run is a separate
CI-only step, since `make verify` would otherwise reach the registry.
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

## Task 2: Ship the package: bin, exports, files and types ✅ DONE (deliver-slice)

**Files:**
- Modify: `package.json` (description, repository, exports, files, prepack)
- Modify: `tsconfig.build.json` (declaration output)
- Modify: `.gitignore` (add `*.tgz`)
- Modify: `.github/workflows/ci.yml` (publish dry-run step, and `DELIVERY_PACK_TESTS=1` on the existing `npm test` step, which is what makes that step also run `tests/packaging.ci.test.ts`)
- Test: `tests/packaging.test.ts` (offline: the boundary, checked with `npm pack --dry-run`)
- Test: `tests/packaging.ci.test.ts` (real pack and install, gated on `DELIVERY_PACK_TESTS`; skipped under a plain local run)

**Interfaces:**
- Consumes: `version` `0.1.0` and `CHANGELOG.md` from Task 1.
- Produces: the published entry points `delivery-service` → `dist/index.js` and `delivery-service/testing` → `dist/testing.js`, with `dist/index.d.ts` and `dist/testing.d.ts` beside them. Task 4's guide snippets import by those names and resolve through this `exports` map. Also produces the `describe.skipIf(!process.env.DELIVERY_PACK_TESTS)` gating pattern that Task 3 reuses for its own registry-touching file.

- [ ] **Step 1: Write the failing tests**

Two files: what the package boundary looks like (and that CI arms the gated checks),
checked offline with `npm pack --dry-run`
(which lists what would be sent without contacting the registry or writing a tarball); and
whether a packed tarball actually installs and runs, which needs the registry or a warm npm
cache to resolve the three runtime dependencies and so must not run in a plain local `npm
test`/`make verify` (design, Testing: "Publish readiness" is a CI check, not a local one).
The second file's `describe` is wrapped in `describe.skipIf(!process.env.DELIVERY_PACK_TESTS)`: vitest's own
conditional-skip helper, so this needs no new config or npm script. Step 7 sets
`DELIVERY_PACK_TESTS=1` on CI's `npm test` step, so the same `npm test` command runs the check
in CI and skips it everywhere else; a contributor who wants to run it locally sets
`DELIVERY_PACK_TESTS=1` themselves. Gating on this project's own variable rather than the
ambient `CI` keeps `make verify` registry-free in any harness that exports `CI`, which the
Global Constraints promise but `CI` alone cannot deliver.

Create `tests/packaging.test.ts`:

```ts
// Slice 5: the package boundary, checked without touching the network. `npm pack
// --dry-run` reports exactly what `npm publish` would send without contacting the
// registry or writing a tarball, so this runs in the default suite. Whether a
// packed tarball actually installs and runs is tests/packaging.ci.test.ts
// (CI only, via DELIVERY_PACK_TESTS): that needs the registry or a warm npm cache.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
  bin: Record<string, string>;
  exports: Record<string, { types: string; default: string }>;
};

/** What `npm publish` would send, without sending it or running `prepack`: the `dist/` the suite already built. */
function packFiles(): string[] {
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: REPO_ROOT, encoding: "utf-8" }),
  ) as [{ files: { path: string }[] }];
  return report.files.map((file) => file.path);
}

describe("the package", () => {
  it("exposes the delivery command, the library and the testing API", () => {
    expect(pkg.bin).toEqual({ delivery: "./dist/cli/main.js" });
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
    expect(pkg.exports["./testing"]).toEqual({ types: "./dist/testing.d.ts", default: "./dist/testing.js" });
  });

  it("ships its built output, its readme and its changelog, and nothing else", () => {
    const packed = packFiles();
    const extras = packed.filter((path) => !path.startsWith("dist/"));
    expect(extras.sort()).toEqual(["CHANGELOG.md", "README.md", "package.json"]);
    for (const file of ["dist/cli/main.js", "dist/index.js", "dist/index.d.ts", "dist/testing.js", "dist/testing.d.ts"]) {
      expect(packed).toContain(file);
    }
  });

  // A check nothing arms runs nowhere. The skip is deliberate locally, so the only
  // thing standing between "skipped here" and "never runs at all" is this line in the
  // workflow: assert it, rather than trusting a comment two files away.
  it("arms the pack-and-install checks on CI's own test step", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf-8");
    expect(workflow).toMatch(/- run: npm test\n\s+env:\n\s+DELIVERY_PACK_TESTS: "1"/);
  });
});
```

Create `tests/packaging.ci.test.ts`:

```ts
// Slice 5: packs the package the way `npm publish` would, installs the tarball
// into an empty folder, and runs the installed command, so the boundary that
// reaches a user is exercised rather than described. This resolves the
// package's three runtime dependencies from the registry or the npm cache,
// which is why the whole suite is gated on `DELIVERY_PACK_TESTS`: skipped under a
// plain local `npm test`/`make verify`, and run as part of the same `npm test` in
// CI, whose workflow step sets `DELIVERY_PACK_TESTS=1`. This project's own variable,
// not the ambient `CI`, so an agent harness that exports `CI` around `make verify`
// does not silently arm a registry-touching check.
// tests/packaging.test.ts covers the same shape offline.
// `--ignore-scripts` on the pack is deliberate: `prepack` rebuilds `dist/`, and
// other test files are running the compiled command at the same time.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };

const INSTALL_TIMEOUT = 300_000;
let tarball: string;

// Scratch folders hold a tarball and a whole node_modules tree apiece: cleared, as
// tests/testing-your-pipeline-guide.test.ts clears its own.
const scratches: string[] = [];
const scratch = (prefix: string): string => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  scratches.push(path);
  return path;
};
afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

beforeAll(() => {
  const destination = scratch("delivery-pack-");
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as [{ filename: string }];
  tarball = join(destination, report.filename);
}, INSTALL_TIMEOUT);

describe.skipIf(!process.env.DELIVERY_PACK_TESTS)("the packed tarball", () => {
  it("installs into an empty folder and gives a working delivery command", () => {
    const folder = scratch("delivery-install-");
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
    const folder = scratch("delivery-npx-");
    const stdout = execFileSync("npx", ["--yes", "--prefer-offline", "--package", tarball, "delivery", "--version"], {
      cwd: folder,
      encoding: "utf-8",
    });
    expect(stdout.trim()).toBe(pkg.version);
  }, INSTALL_TIMEOUT);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx vitest run tests/packaging.test.ts && DELIVERY_PACK_TESTS=1 npx vitest run tests/packaging.ci.test.ts`
Expected: FAIL both ways — there is no `exports` map, the pack contains the whole repository (roughly 338 files), and there are no `.d.ts` files. Without `DELIVERY_PACK_TESTS` the second file reports 0 tests run (both skipped), which is expected: it is not yet meant to fail that way.

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

- [ ] **Step 5: Keep a packed tarball out of `git status`**

The getting-started guide (Task 3) tells a reader to run `npm pack` in the checkout, which
writes `delivery-service-<version>.tgz` beside `package.json`. Add a line to `.gitignore`,
next to `dist/`:

```gitignore
*.tgz
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && npx vitest run tests/packaging.test.ts`
Expected: PASS (3 tests) — the offline checks, which are what `npm test`/`make verify` now
run. The third one fails until Step 7 edits the workflow, so do Step 7 before re-running it.

Run: `DELIVERY_PACK_TESTS=1 npx vitest run tests/packaging.ci.test.ts`
Expected: PASS (2 tests) — the pack-and-install check, forced on locally the way CI runs it. The two install tests each take a few seconds.

Run: `npx vitest run tests/packaging.ci.test.ts` (no `DELIVERY_PACK_TESTS` set)
Expected: PASS with both tests skipped — confirms the gate, not just that the checks work.

- [ ] **Step 7: Arm the pack-and-install checks in CI, and add the publish dry-run**

In `.github/workflows/ci.yml`, replace the `check` job's `- run: npm test` step with the
same command plus the variable that arms the registry-touching checks, and add the publish
dry-run after it:

```yaml
      # The same `npm test` as everywhere else, plus the two release checks that
      # pack and install a real tarball. They are skipped without this variable,
      # which is set here and nowhere else, so `make verify` stays registry-free
      # whatever `CI` is set to around it.
      - run: npm test
        env:
          DELIVERY_PACK_TESTS: "1"
      # The third release check: what `npm publish` would send, without sending it.
      # It contacts the registry, so `make verify` leaves it out and CI carries it.
      - run: npm publish --dry-run
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.build.json .gitignore .github/workflows/ci.yml tests/packaging.test.ts tests/packaging.ci.test.ts
git commit -m "Make the package installable: bin, exports, files and types

The package shipped no entry points and no allow-list, so an install got the
whole repository and no way to import the library. The pack is now exercised the
way a user meets it: packed, installed into an empty folder, and run. The
install check needs the registry, so it runs only when DELIVERY_PACK_TESTS is
set, which CI does and a local npm test does not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: A getting-started guide, executed as a test ✅ DONE (deliver-slice)

**Files:**
- Create: `docs/getting-started.md`
- Create: `tests/getting-started-guide.test.ts` (offline: the guide's text and its run/status steps against the compiled CLI)
- Create: `tests/getting-started-guide-install.ci.test.ts` (real pack and install, both global and project-local, gated on `DELIVERY_PACK_TESTS` as Task 2 Step 1 established)
- Modify: `README.md`
- Modify: `examples/sample-project/README.md`

**Interfaces:**
- Consumes: the packed tarball shape and `delivery --version` printing `0.1.0` (Tasks 1 and 2); `runDelivery` and `REPO_ROOT` from `tests/helpers.ts`; `TEST_MOCK_SCRIPT` from `src/cli/agent-session.js`; `writeMockScript` and `MockScript` from `src/testing.js`.
- Produces: `docs/getting-started.md`, which Task 4's guides point at for both the global command install and the project-local library install (blocking finding 1: a global install alone does not make `import "delivery-service"` resolve in a reader's own project, so the guide teaches both and the install test asserts both).

- [ ] **Step 1: Write the failing tests**

Two files, on the same offline/registry split as Task 2: `tests/getting-started-guide.test.ts`
checks the guide's text and runs its "run your first task" and "read what happened" steps
against the compiled CLI in this checkout, all offline; `tests/getting-started-guide-install.ci.test.ts`
actually packs and installs the tarball, both globally (so `delivery` lands on `PATH`) and into
a second, ordinary project folder (so `import "delivery-service"` resolves there the way a
reader's own project needs), which resolves the package's runtime dependencies from the
registry or the npm cache. Its `describe` is gated on `DELIVERY_PACK_TESTS` exactly as
`tests/packaging.ci.test.ts` is.

Create `tests/getting-started-guide.test.ts`:

```ts
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

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { writeMockScript, type MockScript } from "../src/testing.js";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { REPO_ROOT, runDelivery, sectionOf } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/getting-started.md"), "utf-8");
const RUN_TIMEOUT = 120_000;

// A whole sample project: cleared, as tests/testing-your-pipeline-guide.test.ts clears its own.
const scratches: string[] = [];
const scratch = (prefix: string): string => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  scratches.push(path);
  return path;
};
afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

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

Create `tests/getting-started-guide-install.ci.test.ts`:

```ts
// Slice 5, gated on DELIVERY_PACK_TESTS exactly as tests/packaging.ci.test.ts is: actually packs the
// package and installs it two ways, because the guide teaches two different things.
// A global install (`npm install -g`) puts `delivery` on PATH, which is all Section 1 of the guide
// itself needs. It resolves nothing for a bare `import "delivery-service"` in a
// reader's own project: that needs a second, project-local install of the same
// tarball (no `-g`), which is what makes the other guides' snippets (Task 4) work.
// Both need the registry or a warm npm cache for the package's three runtime
// dependencies, so this stays out of a plain local `npm test`/`make verify`.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, sectionOf } from "./helpers.js";

// Reading the guide, not just the tarball, ties this file to Task 3: it fails with
// ENOENT until docs/getting-started.md exists, the same way the offline guide test does.
const guide = readFileSync(join(REPO_ROOT, "docs/getting-started.md"), "utf-8");
const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
const INSTALL_TIMEOUT = 300_000;
let tarball: string;

const scratches: string[] = [];
const scratch = (prefix: string): string => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  scratches.push(path);
  return path;
};
afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
});

beforeAll(() => {
  const destination = scratch("gs-pack-");
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as [{ filename: string }];
  tarball = join(destination, report.filename);
}, INSTALL_TIMEOUT);

describe.skipIf(!process.env.DELIVERY_PACK_TESTS)("packing and installing the guide's way", () => {
  it("the guide's install section names both installs, and each one works", () => {
    const install = sectionOf(guide, "## 1. Install the command", "## 2.");
    expect(install).toMatch(/npm install(?! -g)[^\n]*delivery-service-\*\.tgz/);
  });

  it("global install (Section 1 of the guide): delivery lands on PATH", () => {
    const destination = scratch("gs-global-");
    execFileSync(
      "npm",
      ["install", "-g", "--prefix", destination, "--prefer-offline", "--no-audit", "--no-fund", tarball],
      { cwd: destination, encoding: "utf-8" },
    );
    const printed = spawnSync(join(destination, "bin", "delivery"), ["--version"], { encoding: "utf-8" });
    expect(printed.stdout.trim()).toBe(version);
  }, INSTALL_TIMEOUT);

  it("project-local install (also Section 1): import \"delivery-service\" resolves", () => {
    const project = scratch("gs-local-");
    execFileSync("npm", ["init", "-y"], { cwd: project, encoding: "utf-8" });
    execFileSync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund", tarball], {
      cwd: project,
      encoding: "utf-8",
    });
    // --input-type=module makes this ESM regardless of the scratch package.json's own
    // type, exactly as a reader's own ESM project would import it.
    const resolved = execFileSync(
      "node",
      ["--input-type=module", "-e", "import('delivery-service').then(() => console.log('resolved'))"],
      { cwd: project, encoding: "utf-8" },
    );
    expect(resolved.trim()).toBe("resolved");
  }, INSTALL_TIMEOUT);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts`
Expected: FAIL — `docs/getting-started.md` does not exist (`ENOENT`).

Run: `DELIVERY_PACK_TESTS=1 npx vitest run tests/getting-started-guide-install.ci.test.ts`
Expected: FAIL — `docs/getting-started.md` does not exist yet, so reading it at module load
throws `ENOENT` before `describe.skipIf` even runs, same as the offline test above. (The
`DELIVERY_PACK_TESTS` gate only decides whether the *tests inside* the `describe` run; the module-level
`readFileSync` above it always runs, exactly as the version lookup in
`tests/packaging.ci.test.ts` does. Step 4 confirms the gate itself, once the guide exists.)

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

That writes `delivery-service-<version>.tgz` in the checkout. Install it:

```bash
npm install -g ./delivery-service-*.tgz
```

Check that the command is there. It prints the version you just packed:

```bash
delivery --version
```

If you would rather not install anything, run it straight from the packed file:

```bash
npx --package ./delivery-service-*.tgz delivery --version
```

### Importing the library in your own project

The install above puts `delivery` on your `PATH`, which is all the rest of this guide
needs. The other guides linked at the end ([writing a gate](writing-a-gate.md), for
example) have you `import` the library or the testing API in a project of your own instead.
A global install does not do that: a bare `import "delivery-service"` resolves through a
project's own `node_modules`, so install the same packed file there too, without `-g`:

```bash
npm install /path/to/your/harness-checkout/delivery-service-*.tgz
```

Now `import { ... } from "delivery-service"` resolves in that project.

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS (6 tests) — offline, so this is what `npm test`/`make verify` runs.

Run: `DELIVERY_PACK_TESTS=1 npx vitest run tests/getting-started-guide-install.ci.test.ts`
Expected: PASS (3 tests).

Run: `npx vitest run tests/getting-started-guide-install.ci.test.ts` (no `DELIVERY_PACK_TESTS` set)
Expected: PASS with every test skipped — confirms the gate now that the guide exists to be
read.

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

- [ ] **Step 6: Run the tests again to verify the readme edits kept them passing**

Run: `npx vitest run tests/getting-started-guide.test.ts`
Expected: PASS (6 tests).

Run: `DELIVERY_PACK_TESTS=1 npx vitest run tests/getting-started-guide-install.ci.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add docs/getting-started.md tests/getting-started-guide.test.ts tests/getting-started-guide-install.ci.test.ts README.md examples/sample-project/README.md
git commit -m "Add a getting-started guide and run it as a test

A newcomer had no single path from nothing to a finished run, and the readmes
still told people to link the command from a checkout. The guide's own commands
and its output blocks are executed against the built command and the sample
project, so it fails the moment the tool stops matching what it promises. It now
also teaches the project-local install a reader needs before any of the other
guides' \`import \"delivery-service\"\` snippets will resolve, not just the global
install that puts \`delivery\` on PATH; the registry-touching half of that check
runs only when DELIVERY_PACK_TESTS is set, so a local npm test stays offline.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Point the existing guides at the package ✅ DONE (deliver-slice)

**Files:**
- Modify: `docs/testing-your-pipeline.md`, `docs/configuring-a-role.md`, `docs/writing-a-gate.md`, `docs/writing-a-closer.md`
- Modify: `tests/testing-your-pipeline-guide.test.ts` (snippets resolve the package by name; the "What you need" assertion, see Step 3)
- Modify: `tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts:71` (the import line it asserts)

**Interfaces:**
- Consumes: the `exports` map from Task 2 (`delivery-service` and `delivery-service/testing`) and `docs/getting-started.md` from Task 3, which by this point teaches both the global command install and the project-local library install these guides' snippets depend on.
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
// A link, not a copy: `exports` is what is being exercised. The existing afterAll's
// rmSync unlinks it rather than following it into the checkout, so leave that as it is.
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
- The harness installed in your project with `npm install`, as
  [Getting started](getting-started.md) describes. The scripted agent,
  `claude-mock`, is vendored in the harness checkout and installed with
  everything else there, so the sections that use it need that checkout:
  `fakeAgentPort` works from an installed copy alone.
```

Two things to check while editing this section, because both are asserted elsewhere:

1. `tests/testing-your-pipeline-guide.test.ts` asserts `expect(needs).toContain("npm install")`
   over exactly this section. The replacement above keeps the phrase; if you word it
   differently, update that assertion in the same commit rather than letting it fail.
2. The paragraph below the list still reads "Nothing else: no global setup, nothing to
   link or put on your `PATH`, no network and no API key." That was true when the
   snippets ran from a clone. Reword only the "nothing to link or put on your `PATH`"
   clause, so it does not contradict the install step immediately above it. The same
   assertion in `tests/testing-your-pipeline-guide.test.ts` pins three further phrases
   over this section, all still true and none of which may be dropped: `no global setup`
   (the install these snippets need is project-local, not global), `no network` and
   `no API key`.

Then change every import line in the guide's snippets:

- `from "./src/index.js"` becomes `from "delivery-service"`
- `from "./src/testing.js"` becomes `from "delivery-service/testing"`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: PASS. The snippets run and type-check against `delivery-service` resolved through the scratch folder.

- [ ] **Step 5: Repoint the other three guides**

All three of `docs/configuring-a-role.md`, `docs/writing-a-gate.md` and
`docs/writing-a-closer.md` carry the same three lines, verbatim:

```markdown
Everything below is imported from the harness's single entry point,
`./src/index.js` from the repository root (the harness is not published as a
package yet). Run the snippets with `npx tsx`.
```

Replace those three lines, in each of the three, with:

```markdown
Everything below is imported from the harness's single entry point,
`delivery-service`. Install it in your project as
[Getting started](getting-started.md) describes, then run the snippets with
`npx tsx`.
```

(`docs/configuring-a-role.md` also imports `./src/testing.js` in two snippets; those are
covered by the import rewrite below.)

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

Why `tests/agent-mock/5-...` keeps passing without an edit, though it stages the pipeline
guide's snippets **at the repository root** and runs them verbatim: a package may import
itself by its own name once `package.json` has an `exports` map, so from a file inside this
checkout `delivery-service` resolves through that map to `dist/index.js`. Verified in this
repository's Node and `tsx`. That test is a recorded UAT regression, so leave it alone; if
it fails, the cause is a missing or wrong `exports` entry from Task 2, or an unbuilt
`dist/`, not the test.

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

## Resolved during review

Two findings from critical review changed the design below; recorded here so the resolution
isn't lost in the task detail.

1. **A global install does not make `import "delivery-service"` resolve.** The original draft
   pointed all four guides at `docs/getting-started.md` for the install that makes their
   snippets work, but that guide taught only `npm install -g ./delivery-service-*.tgz`, which
   puts the `delivery` command on `PATH` and does nothing for a bare specifier in a reader's
   own project. Fix: `docs/getting-started.md` (Task 3, Step 3) now also teaches a
   project-local install (`npm install /path/to/.../delivery-service-*.tgz`, no `-g`) in a new
   "Importing the library in your own project" subsection of Section 1, and both the offline
   guide test and a CI-only install test (`tests/getting-started-guide-install.ci.test.ts`)
   assert it, the second one actually running the install and confirming `import
   "delivery-service"` resolves from a fresh project. The four guides Task 4 repoints were
   already pointing at this section for their install instructions, so they needed no further
   change once the guide itself was fixed.

2. **`npm test` would have stopped being registry-free.** The original Tasks 2 and 3 put real
   `npm install`/`npx` calls against a packed tarball straight into `tests/packaging.test.ts`
   and `tests/getting-started-guide.test.ts`, which `npm test`/`make verify` run; each call
   resolves the package's three runtime dependencies from the registry or the npm cache,
   contradicting both the Global Constraints' offline-tests claim and the CONTRIBUTING
   paragraph Task 1 drafts. The design puts these checks in CI, not the local gate (design,
   Testing: "Publish readiness"). Fix: the registry-touching assertions moved to their own
   files, `tests/packaging.ci.test.ts` and `tests/getting-started-guide-install.ci.test.ts`,
   each wrapped in `describe.skipIf(!process.env.DELIVERY_PACK_TESTS)`. A plain local `npm test`/`make verify`
   skips them and stays offline; CI runs them as part of the same `npm test` step, which sets
   `DELIVERY_PACK_TESTS=1`. `tests/packaging.test.ts` and
   `tests/getting-started-guide.test.ts` keep the offline-safe half of each original test
   (the boundary shape, the guide's text and its run/status steps).

## Notes for the reviewer

- **The npm name is taken.** `delivery-service` on npmjs.com belongs to another publisher, so the first real publish needs a scope or another name. The publish step is off for the licence decision anyway; both gates are named together in the release workflow's comment.
- **Keep a Changelog form** is read as changesets' own output: a title, one `## <version>` section per release newest first, changes grouped by bump size. Writing a second changelog generator to match the letter of the phrase would hand-roll what the Build note says to buy.
- **What the install tests do not cover.** An installed copy cannot run the scripted agent, because `claude-mock` is a dev dependency (design, Non-goals; COULD 15 is the public rehearsal mode that would change this). So the install checks run `delivery --version` and, for the project-local install, confirm the bare import resolves; the getting-started guide's run steps drive the same compiled `dist/cli/main.js` from this checkout.
- **Why an env-var skip rather than a vitest `include`/`exclude` split, and why not `CI`.** `describe.skipIf(!process.env.DELIVERY_PACK_TESTS)` is a plain vitest feature and needs no config change or new npm script; one `env:` line on the existing CI `npm test` step arms it, with no new workflow step. The gate is this project's own variable rather than the ambient `CI` because `CI` is set by many runners and agent harnesses, including ones that may run `make verify`: gating on it would quietly make the unattended gate resolve packages from the registry, which the Global Constraints forbid. A contributor forces one locally with `DELIVERY_PACK_TESTS=1 npx vitest run <file>`.
