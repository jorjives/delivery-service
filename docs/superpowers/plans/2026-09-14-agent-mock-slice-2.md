# Agent Mock — Slice 2: The Scripted Agent Is There After a Plain Install

> **Status:** ✅ Complete — 2026-09-14 — `6730b5e`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-13-agent-mock-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-13-agent-mock-design.md`

**Goal:** Vendor the estate's `claude-mock` into `vendor/claude-mock` so `npm install` provides it, add `mockSessionEnvironment({ scriptPath, journalPath })` to the public testing barrel as the one way to point a session at it, and move every scripted-agent test and demo onto that helper so none of them skips or refuses on a fresh clone or in CI.

**Architecture:** `vendor/claude-mock/` holds the sibling project's source unchanged plus a committed, prebuilt `dist/`. `package.json` declares it as `"@jorj/claude-mock": "file:vendor/claude-mock"` and a new `.npmrc` sets `install-links=true`, so npm *copies* it into `node_modules/@jorj/claude-mock` (and links its `bin` to `node_modules/.bin/claude-mock`) instead of symlinking it. `src/mock-session.ts` resolves that installed command by absolute path (or throws `MockNotInstalled` naming the path and the fix) and builds a `SessionEnvironment` carrying the script and journal locations and no credentials. It is published through `src/testing.ts`. Tests and demos then drop their `isOnPath("claude-mock")` gates, and `src/on-path.ts` is deleted as dead code.

**Tech Stack:** Node ≥ 22, npm ≥ 10 (`install-links`), TypeScript 6 (strict, Node16 ESM), vitest, ESLint flat config, `tsx` for demos, git.

## Global Constraints

- **Buy-vs-build (Build note):** reuse the estate's `claude-mock`, vendored **unchanged**. Its script format, matching rule, effects and journal are not modified, and no new fake agent is written. Do not edit any file under `vendor/claude-mock/` except by re-running the vendoring commands in Task 1.
- **Why `install-links=true` (verified empirically while planning):** with npm's default a `file:` directory dependency is symlinked, and npm then installs the linked package's **devDependencies** (151 packages: TypeScript 5, Vitest 4, a second `@anthropic-ai/claude-agent-sdk`) beside the harness's own. With `install-links=true` npm packs a copy and adds exactly one package. Do not "fix" this by editing the vendored `package.json`.
- **Package key:** use the package's real name, `@jorj/claude-mock`, as the devDependency key (the spec's table wrote `"claude-mock"`; the vendored `package.json` is named `@jorj/claude-mock`, and an alias key would be a needless mismatch). The command it installs is still `claude-mock`.
- **One new devDependency, no new runtime dependency.** No other package may change in `package-lock.json`.
- **Operability / DX (Operational note):** CI (`.github/workflows/ci.yml`), `Makefile` and `.githooks/pre-push` gain **no new step**: `npm ci` now installs the mock, so suites that used to skip run there. This repository owns keeping the vendored copy in step with the sibling project (`vendor/README.md` records the upstream commit and the update commands). Licence position: as the spec's Security section states (both projects share one author; decided explicitly if the harness is open-sourced).
- **One helper, no bare command:** after this slice no file under `src/`, `demos/`, `tests/` or `docs/configuring-a-role.md` names `"claude-mock"` as `pathToClaudeCodeExecutable`, calls `isOnPath`, or gates on `mockMissing` / "claude-mock is not on PATH". `tests/scripted-agent-reachability.test.ts` (Task 5) enforces it.
- **Public surface:** `src/testing.ts` exports exactly `fakeAgentPort` and `mockSessionEnvironment` as values (plus the `RoleHandlers` and `MockSessionPaths` types). `MockNotInstalled` and `resolveMockExecutable` are not exported from the barrel. `src/index.ts` does not change.
- **Messages name the fix, not the mechanism** (house rule, `docs/configuring-a-role.md`). No em-dashes in outward-facing copy (error messages, demo output, `CONTRIBUTING.md`, guides).
- **Imports:** tests and demos take `mockSessionEnvironment` from the public entry point (`./testing.js`, `../src/testing.js`), as they already do `fakeAgentPort`.
- **Every tracked `.ts` file outside `vendor/` must be inside `tsconfig.json`'s `include`** (`tests/typecheck-coverage.test.ts`). The vendored TypeScript is compiled by its own project, not ours, and is excluded from that check and from ESLint (Task 1).
- **Observable behaviour preserved:** migrated demos print the same output (modulo temp paths); migrated tests keep their names and assertions, except that the "or explains plainly that claude-mock is required" branch is removed.
- **Commands:** run everything from the worktree root. Never `cd` into another checkout of this repository. The sibling project is read with `git -C "$CLAUDE_MOCK_SRC" …` only; it is never written to.

## Scaffolding Impact

- **Proactive, install story:** `package.json` devDependency `@jorj/claude-mock`, `package-lock.json`, new `.npmrc` (`install-links=true`), `.gitignore` negation `!vendor/claude-mock/dist/` (the root `dist/` rule would otherwise hide the prebuilt output) → Task 1.
- **Proactive, verification config:** `eslint.config.js` ignores `vendor/`; `tests/typecheck-coverage.test.ts` excludes `vendor/` from the tracked-file list → Task 1.
- **Proactive, provenance and update procedure:** new `vendor/README.md` (upstream commit, what was copied and why, how to update) → Task 1.
- **Reactive, contributor docs:** `CONTRIBUTING.md` says claude-mock is "not vendored here", installed with `npm link`, and that its tests skip without it → rewritten in Task 2.
- **Reactive, mechanism spec:** `docs/agent-interface.md` §Relationship to the mock says "sibling project, not vendored … Vendoring it is Item 7's" → rewritten in Task 2.
- **Reactive, source comments:** `src/agent-invoke.test.ts`'s header comment ("installed with `npm link`, not vendored here, so this tier skips") → Task 3.
- **Reactive, demo and UAT-test headers:** "Requires `claude-mock` on PATH … not vendored in this repo" in the three agent-invocation demos and their UAT tests → Task 4; in the three triage demos and their UAT tests → Task 5.
- **Reactive, adopter guide:** `docs/configuring-a-role.md` "Trying it offline" (says `npm link`, shows `pathToClaudeCodeExecutable: "claude-mock"`) and "Your first triage invocation" (same snippet), plus its verbatim mirror in `tests/triage-and-router/3-…test.ts` → Task 5. (The full testing guide is Slice 5's; this slice only makes the existing sections true.)
- **Regression guard:** `tests/scripted-agent-reachability.test.ts` → Task 5.
- **Dead code:** `src/on-path.ts` has no users once the gates are gone → deleted in Task 5.
- **Unchanged, checked:** `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push`, `README.md` (says only `npm install`), `src/index.ts`. The estate skill `understanding-claude-mock` lives outside this repository and is not touched.

---

### Task 1: Vendor claude-mock so `npm install` provides it ✅ DONE (deliver-slice)

**Files:**
- Create: `vendor/claude-mock/` (copied: `package.json`, `package-lock.json`, `README.md`, `tsconfig.json`, `vitest.config.ts`, `src/cli.ts`, `src/mock.ts`, `test/sdk.test.ts`; built: `dist/cli.js`, `dist/mock.js`, `dist/cli.js.map`, `dist/mock.js.map`)
- Create: `vendor/README.md`
- Create: `.npmrc`
- Create: `tests/vendored-claude-mock.test.ts`
- Modify: `.gitignore`, `package.json`, `package-lock.json`, `eslint.config.js`, `tests/typecheck-coverage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: after `npm install` / `npm ci`, an executable at `<repo root>/node_modules/.bin/claude-mock` (a symlink to `node_modules/@jorj/claude-mock/dist/cli.js`, itself a copy of `vendor/claude-mock/dist/cli.js`). Task 2 resolves exactly that path.

- [ ] **Step 1: Write the failing test**

Create `tests/vendored-claude-mock.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { REPO_ROOT } from "./helpers.js";

const VENDORED = join(REPO_ROOT, "vendor/claude-mock");
const INSTALLED = join(REPO_ROOT, "node_modules/@jorj/claude-mock");
const BUILT = ["cli.js", "mock.js"];

/** What the prebuilt scripted agent may import: file and process plumbing, nothing that talks to a network. */
const ALLOWED_IMPORTS = new Set(["node:crypto", "node:fs", "node:path", "node:readline", "./mock.js"]);

describe("the vendored scripted agent", () => {
  it("is installed by npm install as a copy of vendor/claude-mock", () => {
    // A copy, not a symlink: a linked file: dependency makes npm install the vendored
    // project's own devDependencies (TypeScript 5, Vitest 4, a second Agent SDK) beside
    // ours. .npmrc's install-links=true is what keeps it a copy.
    expect(lstatSync(INSTALLED).isSymbolicLink()).toBe(false);
    expect(realpathSync(join(REPO_ROOT, "node_modules/.bin/claude-mock"))).toBe(join(INSTALLED, "dist/cli.js"));
    for (const file of BUILT) {
      expect(readFileSync(join(INSTALLED, "dist", file), "utf-8")).toBe(readFileSync(join(VENDORED, "dist", file), "utf-8"));
    }
  });

  it("commits its prebuilt entry point as an executable, so installing needs no build step", () => {
    const staged = execFileSync("git", ["ls-files", "-s", "--", "vendor/claude-mock/dist"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: cleanGitEnv(),
    });
    expect(staged).toMatch(/^100755 \S+ 0\tvendor\/claude-mock\/dist\/cli\.js$/m);
    expect(staged).toMatch(/\tvendor\/claude-mock\/dist\/mock\.js$/m);
  });

  it("has no dependencies and no way to reach a network", () => {
    const pkg = JSON.parse(readFileSync(join(VENDORED, "package.json"), "utf-8")) as { dependencies?: unknown };
    expect(pkg.dependencies).toBeUndefined();
    for (const file of BUILT) {
      const source = readFileSync(join(VENDORED, "dist", file), "utf-8");
      const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((specifier) => !ALLOWED_IMPORTS.has(specifier ?? ""))).toEqual([]);
      expect(source).not.toMatch(/\bimport\(|\brequire\(|\bfetch\(/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vendored-claude-mock.test.ts`
Expected: FAIL, all three tests, with `ENOENT` on `node_modules/@jorj/claude-mock` / `vendor/claude-mock/package.json` and an empty `git ls-files` match.

- [ ] **Step 3: Copy the sibling project's source and build its `dist/` from that source**

`CLAUDE_MOCK_SRC` is the sibling project's checkout (on the author's machine `$HOME/dev/tools/claude-mock`). The build runs in a throwaway directory so neither the sibling project nor this repository gains a `node_modules` from it.

```bash
CLAUDE_MOCK_SRC="${CLAUDE_MOCK_SRC:-$HOME/dev/tools/claude-mock}"
UPSTREAM_SHA=$(git -C "$CLAUDE_MOCK_SRC" rev-parse HEAD)
mkdir -p vendor/claude-mock
git -C "$CLAUDE_MOCK_SRC" archive "$UPSTREAM_SHA" -- package.json package-lock.json README.md tsconfig.json vitest.config.ts src test \
  | tar -x -C vendor/claude-mock
BUILD=$(mktemp -d)
cp -R vendor/claude-mock/. "$BUILD"
npm --prefix "$BUILD" ci --no-audit --no-fund
npm --prefix "$BUILD" run build
mkdir -p vendor/claude-mock/dist
cp -p "$BUILD"/dist/cli.js "$BUILD"/dist/mock.js "$BUILD"/dist/cli.js.map "$BUILD"/dist/mock.js.map vendor/claude-mock/dist/
rm -rf "$BUILD"
ls -l vendor/claude-mock/dist/cli.js
echo "upstream: $UPSTREAM_SHA"
```

Expected: `vendor/claude-mock/dist/cli.js` is executable (`-rwx…`, the build's `chmod +x`). Note the printed SHA for `vendor/README.md` (at planning time it was `8dea7997178ffb6eab79eb291a10e335e3f317a6`; record whatever the command prints). Deliberately **not** copied: `.gitignore` (it ignores `dist/`, which would hide the committed build), `.serena/` (editor state), `CLAUDE.md` and `skills/` (agent instructions for working on that project, which would leak into this repository's agent context).

- [ ] **Step 4: Let git track the prebuilt output**

Append to `.gitignore` (after the existing `dist/` line):

```gitignore
# The vendored scripted agent ships prebuilt so installing needs no build step (vendor/README.md).
!vendor/claude-mock/dist/
```

Run: `git check-ignore -v vendor/claude-mock/dist/cli.js; echo "exit=$?"`
Expected: no output and `exit=1` (not ignored).

Then stage the vendored copy: `git add vendor/claude-mock`
Run: `git ls-files -s vendor/claude-mock/dist/cli.js`
Expected: a line starting `100755`.

- [ ] **Step 5: Install it as a copied devDependency**

Create `.npmrc`:

```ini
# Copy file: dependencies into node_modules instead of symlinking them. A linked
# vendor/claude-mock would also install its own devDependencies (TypeScript 5,
# Vitest 4, a second Agent SDK) beside the harness's. See vendor/README.md.
install-links=true
```

Run: `npm install --save-dev --no-audit --no-fund @jorj/claude-mock@file:vendor/claude-mock`
Expected: `added 1 package`. `package.json` `devDependencies` gains `"@jorj/claude-mock": "file:vendor/claude-mock"`.

Run: `git diff --stat package-lock.json` and `git diff package-lock.json`
Expected: only additions for `@jorj/claude-mock` (the root `devDependencies` entry and a `node_modules/@jorj/claude-mock` entry with `"resolved": "file:vendor/claude-mock"`, no `"link": true`). If any other package's version or integrity changed, run `git checkout package-lock.json` and repeat the install with `npm install --save-dev --no-audit --no-fund --prefer-dedupe @jorj/claude-mock@file:vendor/claude-mock`.

- [ ] **Step 6: Run the vendored-agent test to verify it passes**

Run: `npx vitest run tests/vendored-claude-mock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Keep our lint and type-check coverage off the vendored project**

Run: `npx vitest run tests/typecheck-coverage.test.ts`
Expected: FAIL for `vendor/claude-mock/src/cli.ts`, `vendor/claude-mock/src/mock.ts`, `vendor/claude-mock/test/sdk.test.ts`, `vendor/claude-mock/vitest.config.ts` ("is type-checked by tsconfig.json").

In `tests/typecheck-coverage.test.ts`, replace the `tracked` declaration and its comment with:

```ts
// `npm run lint`'s tsc step only guards what the tsconfig includes. When demos
// and tests sit outside it they compile nowhere, so a signature change can go
// green with broken call sites behind it. Vendored projects are compiled by
// their own tsconfig and toolchain (vendor/README.md), not ours.
const tracked = execFileSync("git", ["ls-files", "--", "*.ts", ":(exclude)vendor/"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
  env: cleanGitEnv(),
})
  .split("\n")
  .filter(Boolean);
```

In `eslint.config.js`, change the final ignores block to:

```js
  {
    ignores: ["dist/", "node_modules/", "vendor/"],
  }
```

Run: `npx vitest run tests/typecheck-coverage.test.ts`
Expected: PASS, and no `vendor/` entries in the test names.

Run: `npx eslint vendor/claude-mock/src/cli.ts`
Expected: exit 0 with the warning "File ignored because of a matching ignore pattern".

- [ ] **Step 8: Record provenance and the update procedure**

Create `vendor/README.md` (replace `<UPSTREAM_SHA>` with the SHA Step 3 printed):

````markdown
# Vendored projects

## claude-mock

`claude-mock/` is the estate's scripted fake `claude` CLI, copied **unchanged** from its
sibling project so that a plain `npm install` provides it. The sibling project is
`"private": true` and published nowhere, so there is nothing to install it from otherwise.

- **Upstream commit:** `<UPSTREAM_SHA>`
- **Copied:** `package.json`, `package-lock.json`, `README.md`, `tsconfig.json`,
  `vitest.config.ts`, `src/`, `test/`.
- **Built, and committed:** `dist/cli.js`, `dist/mock.js` and their source maps, compiled
  from the `src/` beside them with the project's own locked toolchain, so installing needs
  no build step and the output audits against the source.
- **Not copied:** `.gitignore` (it ignores `dist/`), `.serena/` (editor state), `CLAUDE.md`
  and `skills/` (agent instructions for working on that project).

### How the harness reaches it

`package.json` declares `"@jorj/claude-mock": "file:vendor/claude-mock"` as a
devDependency. `.npmrc` sets `install-links=true`, so npm copies it into
`node_modules/@jorj/claude-mock` and links its command to `node_modules/.bin/claude-mock`.
Without that setting npm symlinks the directory and also installs claude-mock's own
devDependencies (TypeScript 5, Vitest 4, a second Agent SDK) beside the harness's.

Tests and demos never name the command: they call `mockSessionEnvironment` from
`src/testing.ts`, which resolves the installed copy by absolute path.

The vendored TypeScript is not linted or type-checked by this repository
(`eslint.config.js`, `tests/typecheck-coverage.test.ts`); it belongs to its own project.

### Updating it

This repository owns keeping the copy in step with the sibling project. The script format,
matching rule, effects and journal are never edited here: change them upstream, then
re-vendor. From the repository root, with `CLAUDE_MOCK_SRC` pointing at the sibling checkout:

```bash
UPSTREAM_SHA=$(git -C "$CLAUDE_MOCK_SRC" rev-parse HEAD)
rm -rf vendor/claude-mock && mkdir -p vendor/claude-mock
git -C "$CLAUDE_MOCK_SRC" archive "$UPSTREAM_SHA" -- package.json package-lock.json README.md tsconfig.json vitest.config.ts src test \
  | tar -x -C vendor/claude-mock
BUILD=$(mktemp -d) && cp -R vendor/claude-mock/. "$BUILD"
npm --prefix "$BUILD" ci --no-audit --no-fund && npm --prefix "$BUILD" run build
mkdir -p vendor/claude-mock/dist
cp -p "$BUILD"/dist/*.js "$BUILD"/dist/*.js.map vendor/claude-mock/dist/ && rm -rf "$BUILD"
npm ci
npm test
```

Then update the upstream commit above. `npm ci` (not `npm install`) is what refreshes the
copy in `node_modules`, because the package version does not change between syncs.

### Licence

claude-mock has no licence field and this repository has no `LICENSE` yet. Both projects
share one author, so vendoring raises no third-party rights question. The copy inherits
whatever licence this repository adopts; licensing it for redistribution is a decision to
make explicitly if the harness is open-sourced.
````

- [ ] **Step 9: Commit**

```bash
git add vendor .npmrc .gitignore package.json package-lock.json eslint.config.js tests/typecheck-coverage.test.ts tests/vendored-claude-mock.test.ts
git commit -m "Vendor claude-mock so npm install provides the scripted agent

Mock-backed suites were gated on a machine-local npm link and silently ran
nothing in CI or a fresh clone. The sibling project is copied unchanged with
its prebuilt dist committed; install-links keeps npm from also installing its
devDependencies beside ours.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `mockSessionEnvironment`, the one way to point a session at the mock ✅ DONE (deliver-slice)

**Files:**
- Create: `src/mock-session.ts`, `src/mock-session.test.ts`
- Modify: `src/errors.ts` (append `MockNotInstalled`), `src/testing.ts`, `src/agent-port-double.test.ts:76-84`, `CONTRIBUTING.md:20-23`, `docs/agent-interface.md:234-236`

**Interfaces:**
- Consumes: `node_modules/.bin/claude-mock` from Task 1; `SessionEnvironment` from `src/agent-invoke.ts` (`{ pathToClaudeCodeExecutable?: string; env?: Record<string, string | undefined> }`).
- Produces:
  - `export interface MockSessionPaths { scriptPath: string; journalPath: string }` (`src/mock-session.ts`, type re-exported from `src/testing.ts`)
  - `export function mockSessionEnvironment(paths: MockSessionPaths): SessionEnvironment` (`src/mock-session.ts`, re-exported from `src/testing.ts`)
  - `export function resolveMockExecutable(path?: string): string` (`src/mock-session.ts` only; not in the barrel)
  - `export class MockNotInstalled extends Error { readonly code: "MOCK_NOT_INSTALLED"; readonly path: string }` (`src/errors.ts`; not added to `src/index.ts`)

- [ ] **Step 1: Write the failing tests**

Create `src/mock-session.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { create } from "./case-file.js";
import { invoke } from "./agent-invoke.js";
import { workerRoleConfig } from "./role-config.js";
import { MockNotInstalled } from "./errors.js";
import { resolveMockExecutable } from "./mock-session.js";
import { mockSessionEnvironment } from "./testing.js";
import type { BudgetSet } from "./schema.js";

const REPO_ROOT = join(import.meta.dirname, "..");

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const paths = { scriptPath: "/tmp/run/mock.json", journalPath: "/tmp/run/journal.jsonl" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockSessionEnvironment", () => {
  it("points the session at the claude-mock npm install provides, by absolute path, never via PATH", () => {
    const session = mockSessionEnvironment(paths);
    expect(session.pathToClaudeCodeExecutable).toBe(join(REPO_ROOT, "node_modules/.bin/claude-mock"));
    expect(isAbsolute(session.pathToClaudeCodeExecutable ?? "")).toBe(true);
  });

  it("hands claude-mock its script and journal locations", () => {
    const { env } = mockSessionEnvironment(paths);
    expect(env?.CLAUDE_MOCK_SCRIPT).toBe(paths.scriptPath);
    expect(env?.CLAUDE_MOCK_JOURNAL).toBe(paths.journalPath);
  });

  it("keeps the caller's environment but carries no credentials into the session", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-reach-the-session");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "must-not-reach-the-session");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "must-not-reach-the-session");
    const { env } = mockSessionEnvironment(paths);
    expect(env?.PATH).toBe(process.env.PATH);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });
});

describe("when claude-mock cannot be found", () => {
  it("fails with a sentence naming where it looked and that npm install provides it", () => {
    const missing = join(tmpdir(), "no-such-checkout", "node_modules", ".bin", "claude-mock");
    expect(() => resolveMockExecutable(missing)).toThrow(MockNotInstalled);
    expect(() => resolveMockExecutable(missing)).toThrow(
      `claude-mock was not found at ${missing}. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.`,
    );
  });
});

describe("a session driven through the helper", () => {
  it("runs a real invocation to a typed result with no API key and records the turn in the journal", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-reach-the-session");
    const dir = await mkdtemp(join(tmpdir(), "mock-session-case-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "mock-session-tree-"));
    const scriptPath = join(dir, "mock.json");
    const journalPath = join(dir, "journal.jsonl");
    await create(
      dir,
      { surfaceId: "s-1", taskDef: { intent: "add a greeting" }, gateRef: { type: "command", command: "cat report.tap", parseMode: "tap" } },
      budgets,
    );
    await writeFile(scriptPath, JSON.stringify([{ json: { status: "completed", rationale: "added the greeting" } }]), "utf-8");

    const terminus = await invoke(
      workerRoleConfig,
      { worktreePath, dir, sessionKey: "worker-1-0" },
      mockSessionEnvironment({ scriptPath, journalPath }),
    );

    expect(terminus).toEqual({ status: "completed", rationale: "added the greeting" });
    const events = (await readFile(journalPath, "utf-8"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { event: string; prompt?: string });
    expect(events.find((e) => e.event === "matched")?.prompt).toContain("add a greeting");
  });
});
```

In `src/agent-port-double.test.ts`, replace the `describe("the public testing entry point", …)` block with:

```ts
describe("the public testing entry point", () => {
  it("publishes the testing API and nothing else", () => {
    expect(Object.keys(testing).sort()).toEqual(["fakeAgentPort", "mockSessionEnvironment"]);
  });

  it("leaves the main entry point unchanged", () => {
    expect(Object.keys(index)).not.toContain("fakeAgentPort");
    expect(Object.keys(index)).not.toContain("mockSessionEnvironment");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/mock-session.test.ts src/agent-port-double.test.ts`
Expected: FAIL. `src/mock-session.test.ts` fails to load (`Cannot find module './mock-session.js'` / `MockNotInstalled` not exported); the barrel test fails with `["fakeAgentPort"]` not equal to `["fakeAgentPort", "mockSessionEnvironment"]`.

- [ ] **Step 3: Write the implementation**

Append to `src/errors.ts`:

```ts
export class MockNotInstalled extends Error {
  readonly code = "MOCK_NOT_INSTALLED" as const;
  constructor(readonly path: string) {
    super(
      `claude-mock was not found at ${path}. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.`,
    );
    this.name = "MockNotInstalled";
  }
}
```

Create `src/mock-session.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionEnvironment } from "./agent-invoke.js";
import { MockNotInstalled } from "./errors.js";

/** Where `npm install` puts the vendored claude-mock's command (vendor/README.md). */
const INSTALLED_MOCK = join(import.meta.dirname, "..", "node_modules", ".bin", "claude-mock");

/**
 * Credentials a scripted session never needs. Leaving them out means a
 * mock-backed test proves it runs without a key, even on a machine that has one.
 */
const CREDENTIALS = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]);

/** Where a scripted session reads its expectations and writes its journal. */
export interface MockSessionPaths {
  /** The expectations claude-mock replays, each consumed by the first prompt it matches. */
  scriptPath: string;
  /** Where claude-mock appends one JSON line per turn: the prompt sent, and what it consumed. */
  journalPath: string;
}

/** The installed claude-mock's absolute path, or a named error saying where it looked and how to get it. */
export function resolveMockExecutable(path = INSTALLED_MOCK): string {
  if (!existsSync(path)) throw new MockNotInstalled(path);
  return path;
}

/**
 * A session pointed at the vendored claude-mock instead of the real `claude`
 * CLI, for `invoke` or `createAgentPort`. The command is resolved by absolute
 * path from this checkout's `node_modules`, so nothing depends on `PATH` or on
 * a machine-local link. The session makes no network call and carries no
 * credentials.
 */
export function mockSessionEnvironment({ scriptPath, journalPath }: MockSessionPaths): SessionEnvironment {
  const pathToClaudeCodeExecutable = resolveMockExecutable();
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.has(name)));
  return {
    pathToClaudeCodeExecutable,
    env: { ...inherited, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath },
  };
}
```

Replace the export lines of `src/testing.ts` (keep its doc comment) with:

```ts
export { fakeAgentPort } from "./agent-port-double.js";
export type { RoleHandlers } from "./agent-port-double.js";
export { mockSessionEnvironment } from "./mock-session.js";
export type { MockSessionPaths } from "./mock-session.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/mock-session.test.ts src/agent-port-double.test.ts`
Expected: PASS, no skipped tests.

Run: `npx eslint src/mock-session.ts src/mock-session.test.ts src/errors.ts src/testing.ts && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Bring the contributor and mechanism docs up to date**

In `CONTRIBUTING.md`, replace the paragraph that begins "Some tests drive the real Claude Agent SDK against `claude-mock`" (lines 20-23) with:

```markdown
Some tests and demos drive the real Claude Agent SDK against `claude-mock`, a scripted fake
`claude` binary vendored in `vendor/claude-mock` (see `vendor/README.md`). `npm install`
provides it, so those tests always run, locally and in CI. Point a session at it with
`mockSessionEnvironment({ scriptPath, journalPath })` from `src/testing.ts`; never name the
`claude-mock` command or rely on `PATH`.
```

In `docs/agent-interface.md` §Relationship to the mock, replace the final paragraph (lines 234-236, "`claude-mock` is a **sibling project, not vendored into this repo**. … Vendoring it is Item 7's.") with:

```markdown
`claude-mock` is **vendored** in `vendor/claude-mock`: the sibling project's source,
unchanged, with its prebuilt `dist/` committed, installed by `npm install`
(`vendor/README.md` records the upstream commit and how to update the copy). Tests and demos
reach it through `mockSessionEnvironment` from `src/testing.ts`, which resolves the installed
copy by absolute path and hands it the script and journal locations, so nothing depends on
`PATH` and no mock-backed suite skips.
```

- [ ] **Step 6: Commit**

```bash
git add src/mock-session.ts src/mock-session.test.ts src/errors.ts src/testing.ts src/agent-port-double.test.ts CONTRIBUTING.md docs/agent-interface.md
git commit -m "Add mockSessionEnvironment to the testing entry point

Tests and demos each hand-built a session naming the claude-mock command,
which only worked where it was linked on PATH. One helper now resolves the
vendored copy by absolute path, carries the script and journal locations
and no credentials, and fails naming the path and the fix when missing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The harness's own unit suites stop skipping ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/agent-invoke.test.ts`, `src/surface.test.ts`

**Interfaces:**
- Consumes: `mockSessionEnvironment({ scriptPath, journalPath }): SessionEnvironment` from `./testing.js` (Task 2).
- Produces: nothing new.

This is a migration of existing tests: their assertions do not change, so the check is that the gate is present before and gone after, and the suites run with nothing skipped.

- [ ] **Step 1: Confirm the gates the task removes**

Run: `git grep -n -E 'isOnPath|hasMock|"claude-mock"' -- src/agent-invoke.test.ts src/surface.test.ts`
Expected: matches in both files (the `isOnPath` imports, `hasMock`, four `describe.skipIf(!hasMock)`, one `describe.skipIf(!isOnPath("claude-mock"))`, and the `"claude-mock"` literals).

- [ ] **Step 2: Migrate `src/agent-invoke.test.ts`**

1. Replace `import { isOnPath } from "./on-path.js";` with `import { mockSessionEnvironment } from "./testing.js";`.
2. Delete the doc comment and constant:
   ```ts
   /**
    * claude-mock is a sibling project installed with `npm link`, not vendored
    * here, so this tier skips rather than fails when it is absent.
    */
   const hasMock = isOnPath("claude-mock");
   ```
3. Add `let journalPath: string;` after `let scriptPath: string;`, and in `beforeEach` after `scriptPath = join(dir, "mock.json");` add `journalPath = join(dir, "journal.jsonl");`.
4. Replace the `useMock` function with:
   ```ts
   /** Point the SDK at the vendored mock instead of the real CLI. */
   function useMock() {
     return mockSessionEnvironment({ scriptPath, journalPath });
   }
   ```
5. Replace every `describe.skipIf(!hasMock)(` with `describe(` (four occurrences).
6. In "sends the identical request twice from the same starting case file", replace
   ```ts
   const journalPath = join(dir, "journal.jsonl");
   await script([{ json: { status: "completed", rationale: "either run" } }]);
   const sdk = {
     pathToClaudeCodeExecutable: "claude-mock",
     env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath },
   };
   ```
   with
   ```ts
   await script([{ json: { status: "completed", rationale: "either run" } }]);
   const sdk = useMock();
   ```
7. In `describe("the session options the primitive builds", …)`, which never spawns anything, replace the three `"claude-mock"` literals (the `options()` helper's session, the cast session in "takes only the executable and its environment from the caller", and its `toBe` assertion) with `"/path/to/claude"`.

- [ ] **Step 3: Migrate `src/surface.test.ts`**

1. Delete `import { isOnPath } from "./on-path.js";`.
2. Change `import { fakeAgentPort } from "./testing.js";` to `import { fakeAgentPort, mockSessionEnvironment } from "./testing.js";`.
3. Replace `describe.skipIf(!isOnPath("claude-mock"))("triage by agent through the real invocation seam", () => {` with `describe("triage by agent through the real invocation seam", () => {`.
4. In that test, replace the `createAgentPort` second argument
   ```ts
   { pathToClaudeCodeExecutable: "claude-mock", env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath } },
   ```
   with
   ```ts
   mockSessionEnvironment({ scriptPath, journalPath }),
   ```

- [ ] **Step 4: Verify the gates are gone and the suites run in full**

Run: `git grep -n -E 'isOnPath|hasMock|"claude-mock"' -- src/agent-invoke.test.ts src/surface.test.ts; echo "exit=$?"`
Expected: no output, `exit=1`.

Run: `npx vitest run src/agent-invoke.test.ts src/surface.test.ts`
Expected: PASS, and the summary line shows no `skipped` count.

Run: `npx eslint src/agent-invoke.test.ts src/surface.test.ts && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/agent-invoke.test.ts src/surface.test.ts
git commit -m "Run the scripted-session unit tiers unconditionally

They skipped whenever claude-mock was not on PATH, so CI never ran them.
Sessions now come from mockSessionEnvironment, which the install provides.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The agent-invocation demos and their UAT tests run on a fresh clone ✅ DONE (deliver-slice)

**Files:**
- Modify: `demos/agent-invocation-slice-1-worker-invocation.ts`, `demos/agent-invocation-slice-2-tool-authority.ts`, `demos/agent-invocation-slice-3-gate-maintenance.ts`
- Modify: `tests/agent-invocation-primitive/1-wire-a-worker-to-a-real-invocation-and-get-back-a-typed-result.test.ts`, `tests/agent-invocation-primitive/2-a-role-cannot-act-outside-what-it-was-given-permission-to-touch.test.ts`, `tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts`

**Interfaces:**
- Consumes: `mockSessionEnvironment({ scriptPath, journalPath })` from `../src/testing.js` (Task 2).
- Produces: nothing new.

Migration of existing demos and their recorded UAT tests: demo output and test assertions do not change, only the refusal branch goes.

- [ ] **Step 1: Confirm the gates the task removes**

Run: `git grep -n -E 'isOnPath|requireMock|mockMissing|"claude-mock"|not vendored' -- demos/agent-invocation-slice-1-worker-invocation.ts demos/agent-invocation-slice-2-tool-authority.ts demos/agent-invocation-slice-3-gate-maintenance.ts tests/agent-invocation-primitive`
Expected: matches in all six files.

- [ ] **Step 2: Migrate the three demos**

In **each** of the three demos:

1. Replace `import { isOnPath } from "../src/on-path.js";` with `import { mockSessionEnvironment } from "../src/testing.js";`.
2. Delete the whole `function requireMock(): void { … }` and the `requireMock();` line at the top of `main()`.

Then, per demo:

**`demos/agent-invocation-slice-1-worker-invocation.ts`**
- Header: replace
  ```
   * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
   * repo: install it with `npm link` from its own checkout. No live API call is
   * made, and no API key is needed.
  ```
  with
  ```
   * Runs against `claude-mock`, vendored in `vendor/claude-mock` and installed by
   * `npm install`: no other setup. No live API call is made, and no API key is
   * needed.
  ```
- After `const scriptPath = path.join(dir, "mock.json");` add `const journalPath = path.join(dir, "journal.jsonl");`.
- Replace
  ```ts
    const terminus = await invoke(workerRoleConfig, ctx, {
      pathToClaudeCodeExecutable: "claude-mock",
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
    });
  ```
  with
  ```ts
    const terminus = await invoke(workerRoleConfig, ctx, mockSessionEnvironment({ scriptPath, journalPath }));
  ```

**`demos/agent-invocation-slice-2-tool-authority.ts`**
- Header: replace
  ```
   * Requires `claude-mock` on PATH for section 4. It is a sibling project, not
   * vendored in this repo: install it with `npm link` from its own checkout. No
   * live API call is made, and no API key is needed.
  ```
  with
  ```
   * Section 4 runs against `claude-mock`, vendored in `vendor/claude-mock` and
   * installed by `npm install`: no other setup. No live API call is made, and no
   * API key is needed.
  ```
- After `const scriptPath = path.join(dir, "mock.json");` add `const journalPath = path.join(dir, "journal.jsonl");`.
- Replace
  ```ts
  const clean = await invoke(readOnlyWorker, ctx, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  });
  ```
  with
  ```ts
  const clean = await invoke(readOnlyWorker, ctx, mockSessionEnvironment({ scriptPath, journalPath }));
  ```

**`demos/agent-invocation-slice-3-gate-maintenance.ts`**
- Header: replace
  ```
   * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
   * repo: install it with `npm link` from its own checkout. No live API call is
   * made, and no API key is needed.
  ```
  with
  ```
   * Runs against `claude-mock`, vendored in `vendor/claude-mock` and installed by
   * `npm install`: no other setup. No live API call is made, and no API key is
   * needed.
  ```
- Replace
  ```ts
  const repaired = await invoke(gateMaintenanceRoleConfig, ctx, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  });
  ```
  with
  ```ts
  const repaired = await invoke(
    gateMaintenanceRoleConfig,
    ctx,
    mockSessionEnvironment({ scriptPath, journalPath: path.join(run, "journal.jsonl") }),
  );
  ```

- [ ] **Step 3: Migrate the three UAT tests**

In **each** of the three test files:

1. Delete the line `const mockMissing = stdout.includes("claude-mock is not on PATH");` (and a blank line left doubled by it).
2. Replace the first test
   ```ts
     it("demo script runs to completion, or explains plainly that claude-mock is required", () => {
       if (mockMissing) {
         expect(status).not.toBe(0);
         expect(stdout).toContain("claude-mock is not on PATH");
         return;
       }
       expect(status).toBe(0);
     });
   ```
   with
   ```ts
     it("demo script runs to completion", () => {
       expect(status).toBe(0);
     });
   ```
3. Replace every `it.skipIf(mockMissing)(` with `it(`.

Header comments, per file:

- `1-wire-a-worker-…test.ts`: replace
  ```
  // Requires `claude-mock` (a sibling project, not vendored here) on PATH. When it is absent the
  // demo prints an explanatory message and exits non-zero rather than crashing; this test asserts
  // on that message in that case instead of failing opaquely.
  ```
  with
  ```
  // Runs against claude-mock, vendored in vendor/claude-mock and installed by `npm install`, so it
  // never skips.
  ```
- `2-a-role-cannot-act-…test.ts`: replace
  ```
  // Requires `claude-mock` (a sibling project, not vendored here) on PATH — needed only for the
  // demo's section 4 (a real invocation through the guard). When it is absent the demo prints an
  // explanatory message and exits non-zero rather than crashing; this test asserts on that message
  // in that case instead of failing opaquely.
  ```
  with
  ```
  // The demo's section 4 (a real invocation through the guard) runs against claude-mock, vendored in
  // vendor/claude-mock and installed by `npm install`, so this test never skips.
  ```
- `3-configure-a-second-role-…test.ts`: replace
  ```
  // Requires `claude-mock` (a sibling project, not vendored here) on PATH for the demo's clean-
  // completion scenario. When it is absent the demo prints an explanatory message and exits non-zero
  // rather than crashing; this test asserts on that message in that case instead of failing opaquely.
  ```
  with
  ```
  // The demo's clean-completion scenario runs against claude-mock, vendored in vendor/claude-mock and
  // installed by `npm install`, so this test never skips.
  ```

- [ ] **Step 4: Verify the gates are gone and the suites run in full**

Run: `git grep -n -E 'isOnPath|requireMock|mockMissing|"claude-mock"|not vendored' -- demos/agent-invocation-slice-1-worker-invocation.ts demos/agent-invocation-slice-2-tool-authority.ts demos/agent-invocation-slice-3-gate-maintenance.ts tests/agent-invocation-primitive; echo "exit=$?"`
Expected: no output, `exit=1`.

Run: `npm run demo:agent-slice-1`
Expected: exit 0; prints `Result: completed — added the greeting endpoint and its handler`, the escalate result and the did-not-complete result (no "claude-mock is not on PATH").

Run: `npx vitest run tests/agent-invocation-primitive`
Expected: PASS, and the summary line shows no `skipped` count.

Run: `npx eslint demos/agent-invocation-slice-*.ts tests/agent-invocation-primitive && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demos/agent-invocation-slice-1-worker-invocation.ts demos/agent-invocation-slice-2-tool-authority.ts demos/agent-invocation-slice-3-gate-maintenance.ts tests/agent-invocation-primitive
git commit -m "Run the agent-invocation demos without a linked claude-mock

They refused to run, and their UAT tests skipped, unless claude-mock was on
PATH. They now take their session from mockSessionEnvironment, so a fresh
clone and CI exercise them in full.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The triage demos, their UAT tests and the role guide; guard against regression ✅ DONE (deliver-slice)

**Files:**
- Create: `tests/scripted-agent-reachability.test.ts`
- Modify: `demos/triage-slice-1-informed-retry.ts`, `demos/triage-slice-2-escalation-packets.ts`, `demos/triage-slice-3-last-attempt.ts`
- Modify: `tests/triage-and-router/1-a-stuck-workers-retry-is-informed-by-triage-not-re-dispatched-blind.test.ts`, `tests/triage-and-router/2-every-escalation-hands-a-human-a-decision-not-internal-state.test.ts`, `tests/triage-and-router/3-triage-judges-the-last-attempt-and-rechecks-broken-gates-for-free.test.ts`
- Modify: `docs/configuring-a-role.md` ("Trying it offline", "Your first triage invocation")
- Delete: `src/on-path.ts`

**Interfaces:**
- Consumes: `mockSessionEnvironment({ scriptPath, journalPath })` from `../src/testing.js` (Task 2).
- Produces: `tests/scripted-agent-reachability.test.ts`, the standing guard for the slice's "no test names the executable or relies on PATH" criterion.

- [x] **Step 1: Tidy first: drop the skipped placeholders whose pointers the headers already carry**

The three triage UAT tests hold nine `it.skip(…, () => {})` placeholders that test nothing: each only names where an AC is covered, and each file's header comment already states the same pointer. They make the suite summary report skipped scripted-agent tests, which this slice's UAT says it must not.

In `tests/triage-and-router/1-…test.ts` delete the four `it.skip(` blocks (the authority-escalation, read-only-tools, prompt-determinism and crash-mid-triage placeholders). In `tests/triage-and-router/2-…test.ts` delete the one `it.skip(` block (failed close can end only in …). In `tests/triage-and-router/3-…test.ts` delete the four `it.skip(` blocks (close failure with one slot, spent population budget, no triage agent wired in, both budgets spent). Leave the header comments exactly as they are: they are now the only record of those pointers.

Run: `git grep -n "it.skip(" -- tests src; echo "exit=$?"`
Expected: no output, `exit=1`.

Run: `npx vitest run tests/triage-and-router`
Expected: PASS (on a machine with claude-mock on PATH; otherwise the pre-existing `skipIf` tests still skip, which Step 4 removes).

```bash
git add tests/triage-and-router
git commit -m "Remove skipped AC placeholders from the triage UAT tests

Each it.skip only pointed at where an AC is covered, a pointer the file's
header already carries, and they made the suite report skipped
scripted-agent tests where nothing was being skipped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [x] **Step 2: Write the failing guard test**

Create `tests/scripted-agent-reachability.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { REPO_ROOT } from "./helpers.js";

// Tests, demos and the role guide reach claude-mock only through mockSessionEnvironment,
// which resolves the copy `npm install` provides. Naming the bare command, or skipping
// when it is not on PATH, brings back the machine-local setup vendoring removed: such a
// suite silently runs nothing in CI or on a fresh clone.
const SCOPE = ["src", "demos", "tests", "docs/configuring-a-role.md", ":(exclude)tests/scripted-agent-reachability.test.ts"];

function filesMatching(pattern: string): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-E", pattern, "--", ...SCOPE], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: cleanGitEnv(),
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []; // git grep found nothing
    throw err;
  }
}

describe("reaching the scripted agent", () => {
  it("no test, demo or guide names claude-mock as the executable to run", () => {
    expect(filesMatching('pathToClaudeCodeExecutable: "claude-mock"')).toEqual([]);
  });

  it("no test or demo skips or refuses when claude-mock is not on PATH", () => {
    expect(filesMatching("isOnPath|mockMissing|claude-mock is not on PATH")).toEqual([]);
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/scripted-agent-reachability.test.ts`
Expected: FAIL.
- First test lists `demos/triage-slice-1-informed-retry.ts`, `demos/triage-slice-2-escalation-packets.ts`, `demos/triage-slice-3-last-attempt.ts`, `docs/configuring-a-role.md`, `tests/triage-and-router/3-triage-judges-the-last-attempt-and-rechecks-broken-gates-for-free.test.ts`.
- Second test lists the three triage demos, the three `tests/triage-and-router/*.test.ts` files and `src/on-path.ts`.

(If any Task 3 or Task 4 file appears, that task is incomplete: fix it there.)

- [x] **Step 4: Migrate the three triage demos**

In **each** of the three triage demos:

1. Replace `import { isOnPath } from "../src/on-path.js";` with `import { mockSessionEnvironment } from "../src/testing.js";`.
2. Delete the whole `function requireMock(): void { … }` and the `requireMock();` line at the top of `main()`.
3. In the header, replace
   ```
    * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
    * repo: install it with `npm link` from its own checkout. No live API call is
    * made, and no API key is needed. `claude-mock` does not enforce a role's tool
   ```
   with
   ```
    * Runs against `claude-mock`, vendored in `vendor/claude-mock` and installed by
    * `npm install`: no other setup. No live API call is made, and no API key is
    * needed. `claude-mock` does not enforce a role's tool
   ```
   (the sentence continues unchanged on the following lines).

Then, per demo:

**`demos/triage-slice-1-informed-retry.ts`**: replace the `mockSession` function with

```ts
function mockSession(scratch: string, script: unknown[]) {
  const scriptPath = path.join(scratch, "mock.json");
  const journalPath = path.join(scratch, "journal.jsonl");
  fs.writeFileSync(scriptPath, JSON.stringify(script), "utf-8");
  return { journalPath, session: mockSessionEnvironment({ scriptPath, journalPath }) };
}
```

**`demos/triage-slice-2-escalation-packets.ts`**: replace the `mockSession` function with

```ts
function mockSession(scratch: string, script: unknown[]) {
  const scriptPath = path.join(scratch, "mock.json");
  fs.writeFileSync(scriptPath, JSON.stringify(script), "utf-8");
  return mockSessionEnvironment({ scriptPath, journalPath: path.join(scratch, "journal.jsonl") });
}
```

**`demos/triage-slice-3-last-attempt.ts`**: in `runSurface`, replace

```ts
  const inner = createAgentPort(configs, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journal },
  });
```

with

```ts
  const inner = createAgentPort(configs, mockSessionEnvironment({ scriptPath, journalPath: journal }));
```

- [x] **Step 5: Migrate the three triage UAT tests**

In **each** of the three test files:

1. Delete `const mockMissing = stdout.includes("claude-mock is not on PATH");`.
2. Replace the first test (`"demo script runs to completion, or explains plainly that claude-mock is required"`, with its `if (mockMissing) { … }` branch) with
   ```ts
     it("demo script runs to completion", () => {
       expect(status).toBe(0);
     });
   ```
3. Replace every `it.skipIf(mockMissing)(` with `it(`.
4. In the header, replace
   ```
   // Requires `claude-mock` (a sibling project, not vendored here) on PATH. When it is absent
   // the demo prints an explanatory message and exits non-zero rather than crashing; this test
   // asserts on that message in that case instead of failing opaquely.
   ```
   with
   ```
   // Runs against claude-mock, vendored in vendor/claude-mock and installed by `npm install`, so
   // it never skips.
   ```

Additionally, in `tests/triage-and-router/3-…test.ts`:

1. Delete `import { isOnPath } from "../../src/on-path.js";`.
2. In the "AC: following only the guide's Triage chapter …" test, delete
   ```ts
         if (!isOnPath("claude-mock")) {
           expect(stdout).toContain("claude-mock is not on PATH"); // consistent with the demo's own gate
           return;
         }
   ```
3. In the generated `first-triage.ts` lines, replace
   ```ts
             `import { create, invoke, triageRoleConfig } from ${JSON.stringify(join(REPO_ROOT, "src/index.js"))};`,
   ```
   with
   ```ts
             `import { create, invoke, triageRoleConfig } from ${JSON.stringify(join(REPO_ROOT, "src/index.js"))};`,
             `import { mockSessionEnvironment } from ${JSON.stringify(join(REPO_ROOT, "src/testing.js"))};`,
   ```
   and replace
   ```ts
             "  {",
             '    pathToClaudeCodeExecutable: "claude-mock",',
             `    env: { ...process.env, CLAUDE_MOCK_SCRIPT: ${JSON.stringify(mockScript)} },`,
             "  },",
   ```
   with
   ```ts
             `  mockSessionEnvironment({ scriptPath: ${JSON.stringify(mockScript)}, journalPath: ${JSON.stringify(join(scratch, "journal.jsonl"))} }),`,
   ```
   (the surrounding `"const verdict = await invoke(",`, `"  triageRoleConfig,",`, `'  { worktreePath, dir, sessionKey: "triage-0" },',` and `");",` lines stay).

- [x] **Step 6: Make the role guide's offline sections true**

In `docs/configuring-a-role.md`, "## Trying it offline": replace the opening paragraph and the first `ts` block

````markdown
`claude-mock` is a scripted stand-in for the `claude` command. It is a separate
project, not included here: install it with `npm link` from its own checkout so
that `claude-mock` works from your shell. Then pass a third argument to `invoke`:

```ts
const ctx = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
const result = await invoke(gateMaintenanceRoleConfig, ctx, {
  pathToClaudeCodeExecutable: "claude-mock",
  env: { ...process.env, CLAUDE_MOCK_SCRIPT: "/tmp/my-run/mock.json" },
});
```
````

with

````markdown
`claude-mock` is a scripted stand-in for the `claude` command. It is vendored in
`vendor/claude-mock` and installed by `npm install`, so there is nothing else to set
up. `mockSessionEnvironment` points a session at it, with the script it replays and
the journal it writes; pass that as the third argument to `invoke`:

```ts
import { mockSessionEnvironment } from "./src/testing.js";

const ctx = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
const result = await invoke(
  gateMaintenanceRoleConfig,
  ctx,
  mockSessionEnvironment({ scriptPath: "/tmp/my-run/mock.json", journalPath: "/tmp/my-run/journal.jsonl" }),
);
```

The session makes no network call and needs no API key.
````

In "### Your first triage invocation", in the `first-triage.ts` block, replace

```ts
import { create, invoke, triageRoleConfig } from "./src/index.js";
```

with

```ts
import { create, invoke, triageRoleConfig } from "./src/index.js";
import { mockSessionEnvironment } from "./src/testing.js";
```

and replace

```ts
  {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: "/tmp/my-triage/mock.json" },
  },
```

with

```ts
  mockSessionEnvironment({ scriptPath: "/tmp/my-triage/mock.json", journalPath: "/tmp/my-triage/journal.jsonl" }),
```

- [x] **Step 7: Delete the dead PATH probe**

Run: `git grep -n "on-path" -- src demos tests; echo "exit=$?"`
Expected: no output and `exit=1`: nothing imports it any more (Tasks 3 and 4 and Steps 4-5 removed every import).

Run: `git rm src/on-path.ts`

- [x] **Step 8: Run the guard and the migrated suites to verify they pass**

Run: `npx vitest run tests/scripted-agent-reachability.test.ts`
Expected: PASS (2 tests).

Run: `npm run demo:triage-slice-1`
Expected: exit 0; sections 1-6 print, ending "Surface finished: CLOSED" in section 4, with no "claude-mock is not on PATH".

Run: `npx vitest run tests/triage-and-router`
Expected: PASS, and the summary line shows no `skipped` count.

Run: `npx eslint demos/triage-slice-*.ts tests/triage-and-router tests/scripted-agent-reachability.test.ts && npx tsc --noEmit`
Expected: exit 0.

- [x] **Step 9: Commit**

```bash
git add tests/scripted-agent-reachability.test.ts demos/triage-slice-1-informed-retry.ts demos/triage-slice-2-escalation-packets.ts demos/triage-slice-3-last-attempt.ts tests/triage-and-router docs/configuring-a-role.md
git commit -m "Run the triage demos and role guide against the vendored mock

The triage demos refused, their UAT tests skipped, and the guide told
adopters to npm link claude-mock. All now use mockSessionEnvironment, the
unused PATH probe is removed, and a guard test fails if a test, demo or the
guide names the bare command or gates on PATH again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Verify the slice as a fresh clone would see it

**Files:** none (verification only; no commit).

**Interfaces:**
- Consumes: everything Tasks 1-5 committed.
- Produces: nothing.

Each task ran only its own subset. This task runs the slice's UAT the way CI and a fresh clone do: from a clean install of the committed tree, with the whole lint and test run. It stays inside this worktree: a clean `node_modules` from `npm ci` off committed files is the in-place equivalent of a fresh clone.

- [ ] **Step 1: Confirm everything the install needs is committed**

Run: `git status --porcelain; git ls-files .npmrc vendor/claude-mock/dist/cli.js vendor/README.md`
Expected: no `git status` output; all three paths listed.

- [ ] **Step 2: Reinstall from the lockfile, as CI and `make verify` do**

Run: `rm -rf node_modules && npm ci --no-audit --no-fund`
Expected: exit 0; `node_modules/@jorj/claude-mock` is a directory, not a symlink (`test ! -L node_modules/@jorj/claude-mock && echo copy` prints `copy`).

Run: `git status --porcelain`
Expected: no output (the install rewrote nothing tracked, including `package-lock.json`).

- [ ] **Step 3: Run the UAT's demo and the whole suite**

Run: `npm run demo:agent-slice-1`
Expected: exit 0; prints the typed `completed` result, with no "claude-mock is not on PATH".

Run: `npm run lint && npm test`
Expected: both exit 0; the vitest summary shows no `skipped` or `todo` count.
