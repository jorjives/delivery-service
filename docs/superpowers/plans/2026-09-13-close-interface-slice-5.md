# Close Interface — Slice 5: Accepted Work Opens a Pull Request

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-11-close-interface-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-11-close-interface-design.md`

**Goal:** Add the `open-pr` built-in closer, so a project that names `{ type: "open-pr" }` gets accepted work committed, its surface branch pushed to `origin`, and a GitHub pull request opened against the pinned base branch via the operator's own `gh` sign-in, with the PR address as the closing report, a repeat close reusing the open PR, and every GitHub access problem reported as a specific, fixable `ERROR`.

**Architecture:** One new closer file, `src/open-pr-closer.ts`, built on the existing `closerFromAcceptedHandler` (so escalated/aborted teardown and the never-throw guarantee are inherited, not re-implemented), `ensureCommitted`/`tryGit` from `git-exec.ts`, and `load` from `case-file.ts` for the task content that names the PR. `gh` is spawned with `execFile` argv arrays and `cleanGitEnv()`, never a shell; its failures are classified from the process's own signals (spawn `ENOENT`, gh's documented exit code 4, and its stderr) into `ERROR` (tool missing, sign-in needed, permission, network) or `FAIL` (a content refusal of `gh pr create`), with any token-shaped text redacted. Tests and the demo swap the executable: a new test-support module, `src/gh-stand-in.ts`, writes a small Node script named `gh` into a temp directory, beside `src/temp-repo.ts`, which gains `addLocalOrigin` (a bare local repo as `origin`).

**Tech Stack:** TypeScript (ESM, `node:` builtins only), zod, vitest, system `git`; the GitHub CLI `gh` in production only.

## Global Constraints

- **Buy-vs-build (Build note + spec table):** PR creation and detection use the `gh` CLI with the operator's own sign-in (`gh auth login` or ambient `GH_TOKEN`/`GITHUB_TOKEN`). No GitHub API client library (`@octokit/*`), no new npm dependency. Git stays on the codebase's own `src/git-exec.ts` helpers.
- **No credentials anywhere the harness writes.** No token is accepted on `CloserRef` or `CloseContext`, stored in the case file, or written into a `detail`. Any subprocess text quoted into a `detail` passes through the redaction in Task 2.
- **No shell, ever.** Every `git` and `gh` call is `execFile(cmd, [...argv], { cwd, env: cleanGitEnv() })`. Value flags taking task-derived text are passed in `--flag=value` form, so a title beginning with `--` can never be read as a separate flag.
- **Test double (Build note):** swap the executable, as the codebase already does for `claude-mock`. The closer factory takes `ghCommand` (default `"gh"`) purely so unit tests can point at the stand-in; `resolveCloser` stays `(ref, repoPath)` and finds `gh` on `PATH`, so the surface-level test and the demo put the stand-in's directory first on `PATH`.
- **Operability / DX (Operational note):** only projects that select `open-pr` need `gh` installed and signed in. Tests and demo need only `git` and `node`: no network, no GitHub account, nothing skipped. The demo says so. On success the worktree is left in place (a PR under review may take follow-up commits).
- **Closer selection is data; `resolveCloser` stays total.** `{ type: "open-pr" }`, exhaustive `switch` on `type`.
- **`detail` is plain, factual prose** naming the cause and the fix, never a raw error dump. The one exception the spec mandates: a successful first open's `detail` is exactly the PR URL.
- **A closer never throws at the driver** (inherited from `closerFromAcceptedHandler`).
- **Deliberate omission:** the spec's `titleTemplate`/`bodyTemplate` fields are not added to `CloserRef` in this slice. No acceptance criterion needs them, the spec does not define a placeholder syntax, and adding an optional field later is backward-compatible. The defaults name the surface and the task, as the spec requires.
- **No em-dashes in outward-facing copy** (guide text, report `detail`s, demo output).

## Scaffolding Impact

- `docs/writing-a-closer.md` "Choosing a closer" lists the built-ins by name; it must list `open-pr` and its `gh`/`origin` precondition → Task 3; its demo pointer → Task 4.
- `tests/writing-a-closer-guide.test.ts` pins what the guide covers → extended in Task 3 (`open-pr`, `gh auth login`) and Task 4 (`npm run demo:close-slice-5`).
- `src/ports.ts` `noopCloser` doc-comment names "the shipped closers" by file → Task 3.
- `src/index.ts` public exports → `createOpenPrCloser` added in Task 3.
- `package.json` `demo:close-slice-5` → Task 4, with the demo.
- New test support (`src/gh-stand-in.ts`, `addLocalOrigin`) → Task 1. It needs only `node`, so CI (`.github/workflows/ci.yml`) and `make verify` are unchanged; `tests/typecheck-coverage.test.ts` already forces every new tracked `.ts` into the programme.
- README links the guide only; no change.

---

### Task 1: The open-pr closer's happy path, repeat and teardown

**Files:**
- Create: `src/gh-stand-in.ts`, `src/open-pr-closer.ts`, `src/open-pr-closer.test.ts`
- Modify: `src/temp-repo.ts` (add `addLocalOrigin`)

**Interfaces:**
- Consumes: `closerFromAcceptedHandler(closeAccepted)` and `closeError(detail)` from `src/closer-support.js`; `ensureCommitted(worktreePath, message)` and `tryGit(cwd, args)` from `src/git-exec.js`; `cleanGitEnv()` from `src/git-env.js`; `load(dir)` and `create(dir, header, budgets)` from `src/case-file.js`; `provisionWorktree(dir, repoPath, worktreePath, surfaceId)` and `initTempRepo(prefix, files)` in tests.
- Produces:
  - `createOpenPrCloser(options?: { ghCommand?: string }): CloserPort`
  - `addLocalOrigin(repo: string): string` (returns the bare origin's path; `main` already pushed)
  - `createGhStandIn(): GhStandIn` where `GhStandIn = { command: string; binDir: string; setMode(mode: GhStandInMode): void; refuseCreate(message: string): void; pullRequests(): StandInPullRequest[] }`, `GhStandInMode = "signed-in" | "signed-out" | "expired" | "forbidden" | "offline"`, `StandInPullRequest = { url: string; head: string; base: string; title: string; body: string }`. PR URLs are `https://github.com/example/project/pull/<n>`, numbered from 1.

- [ ] **Step 1: Add the test support**

Append to `src/temp-repo.ts` (every import it needs is already at the top of the file):

```typescript
/**
 * Test and demo support: give `repo` a bare repository on this machine as its
 * `origin`, with `main` pushed, so a closer can push without any network.
 * Returns the bare repository's path, for asserting on what arrived there.
 */
export function addLocalOrigin(repo: string): string {
  const origin = mkdtempSync(join(tmpdir(), "origin-"));
  const git = (cwd: string, args: string[]): void => {
    execFileSync("git", args, { cwd, stdio: "pipe", env: cleanGitEnv() });
  };
  git(origin, ["init", "--bare", "-b", "main"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["push", "origin", "main"]);
  return origin;
}
```

Create `src/gh-stand-in.ts`:

```typescript
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test and demo support: a stand-in for the GitHub CLI, so the open-pr closer
 * can be exercised with no network and no GitHub account. It is the same
 * swap-the-executable approach claude-mock takes for the agent: a real
 * executable named `gh`, honouring the argv and output of the two commands the
 * closer uses (`gh pr list --json url`, `gh pr create`), with its failure
 * messages and exit codes copied from gh 2.94 itself.
 */

export type GhStandInMode = "signed-in" | "signed-out" | "expired" | "forbidden" | "offline";

export interface StandInPullRequest {
  url: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface GhStandIn {
  /** Absolute path of the stand-in executable, named `gh`. */
  command: string;
  /** The directory holding it, to put first on PATH. */
  binDir: string;
  setMode(mode: GhStandInMode): void;
  /** Make every later `gh pr create` fail with this message, as GitHub refusing the pull request would. */
  refuseCreate(message: string): void;
  pullRequests(): StandInPullRequest[];
}

interface StandInState {
  mode: GhStandInMode;
  refusal: string | null;
  pullRequests: StandInPullRequest[];
}

// CommonJS, because an extensionless file outside any package is loaded as
// CommonJS. No template interpolation or backticks inside: String.raw keeps
// every character verbatim.
const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const statePath = path.join(__dirname, "state.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

function fail(message, code) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

// gh's flag parsing: "--name=value", or "--name value" where the next argument
// is the value whatever it looks like.
function flagsOf(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else flags[arg.slice(2)] = args[++i];
  }
  return flags;
}

if (state.mode === "signed-out") {
  fail("To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.", 4);
}
if (state.mode === "expired") {
  fail("HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com", 1);
}
if (state.mode === "offline") {
  fail("error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com", 1);
}

const [group, command, ...rest] = process.argv.slice(2);
const flags = flagsOf(rest);

if (group === "pr" && command === "list") {
  const open = state.pullRequests.filter((pr) => pr.head === flags.head);
  process.stdout.write(JSON.stringify(open.map((pr) => ({ url: pr.url }))) + "\n");
  process.exit(0);
}

if (group === "pr" && command === "create") {
  if (state.mode === "forbidden") {
    fail("pull request create failed: GraphQL: operator does not have the correct permissions to execute 'CreatePullRequest' (createPullRequest)", 1);
  }
  if (state.refusal) fail(state.refusal, 1);
  const url = "https://github.com/example/project/pull/" + (state.pullRequests.length + 1);
  state.pullRequests.push({ url, head: flags.head, base: flags.base, title: flags.title, body: flags.body });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(url + "\n");
  process.exit(0);
}

fail("gh stand-in: unsupported command: " + process.argv.slice(2).join(" "), 1);
`;

export function createGhStandIn(): GhStandIn {
  const binDir = mkdtempSync(join(tmpdir(), "gh-stand-in-"));
  const command = join(binDir, "gh");
  const statePath = join(binDir, "state.json");
  const read = (): StandInState => JSON.parse(readFileSync(statePath, "utf-8")) as StandInState;
  const write = (state: StandInState): void => {
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  };

  writeFileSync(command, SCRIPT, { mode: 0o755 });
  write({ mode: "signed-in", refusal: null, pullRequests: [] });

  return {
    command,
    binDir,
    setMode: (mode) => write({ ...read(), mode }),
    refuseCreate: (message) => write({ ...read(), refusal: message }),
    pullRequests: () => read().pullRequests,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/open-pr-closer.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenPrCloser } from "./open-pr-closer.js";
import { create } from "./case-file.js";
import { provisionWorktree } from "./provision.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import { createGhStandIn, type GhStandIn } from "./gh-stand-in.js";
import { cleanGitEnv } from "./git-env.js";
import type { CloseContext } from "./ports.js";
import type { BudgetSet, GateRef, TaskDef } from "./schema.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "true", parseMode: "exitcode" };
const accepted = { kind: "accepted" } as const;
const BRANCH = "surface/surface-71";
const FIRST_PR = "https://github.com/example/project/pull/1";

async function caseDir(taskDef: TaskDef): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "open-pr-case-"));
  await create(dir, { surfaceId: "surface-71", taskDef, gateRef }, budgets);
  return dir;
}

describe("the open-pr closer", () => {
  let repo: string;
  let origin: string;
  let tree: string;
  let ctx: CloseContext;
  let standIn: GhStandIn;

  const closer = () => createOpenPrCloser({ ghCommand: standIn.command });

  beforeEach(async () => {
    const dir = await caseDir({ goal: "add the feature" });
    repo = initTempRepo("open-pr-repo-", { "seed.txt": "hello\n" });
    origin = addLocalOrigin(repo);
    tree = join(await mkdtemp(join(tmpdir(), "open-pr-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-71");
    ctx = { dir, repoPath: repo, worktreePath: tree, branch: BRANCH, baseBranch };
    standIn = createGhStandIn();
  });

  it("commits the work, pushes the branch and opens a pull request against the base branch", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await closer().close(ctx, accepted);

    expect(report.status).toBe("DONE");
    expect(git(origin, ["show", `${BRANCH}:feature.txt`])).toBe("the work");
    expect(standIn.pullRequests()).toEqual([expect.objectContaining({ head: BRANCH, base: "main" })]);
  });

  it("reports the pull request's address as the closing report", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await closer().close(ctx, accepted);

    expect(report.detail).toBe(FIRST_PR);
  });

  it("names the surface and the task in the pull request", async () => {
    await closer().close(ctx, accepted);

    const [pr] = standIn.pullRequests();
    expect(pr?.title).toBe("add the feature (surface-71)");
    expect(pr?.body).toContain("surface-71");
    expect(pr?.body).toContain('"goal": "add the feature"');
  });

  it("leaves the worktree in place for follow-up commits", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    await closer().close(ctx, accepted);

    expect(existsSync(tree)).toBe(true);
  });

  it("reports the already-open pull request on a repeat close, and opens no second one", async () => {
    writeFileSync(join(tree, "feature.txt"), "the work\n");
    await closer().close(ctx, accepted);

    const repeat = await closer().close(ctx, accepted);

    expect(repeat.status).toBe("DONE");
    expect(repeat.detail.startsWith(FIRST_PR)).toBe(true);
    expect(repeat.detail).toMatch(/no new pull request was opened/i);
    expect(standIn.pullRequests()).toHaveLength(1);
  });

  it("passes task content to gh as data that cannot be read as commands or flags", async () => {
    const hostile = "--base=evil $(touch pwned) `touch pwned`; touch pwned";
    const hostileCtx = { ...ctx, dir: await caseDir({ goal: hostile }) };

    const report = await closer().close(hostileCtx, accepted);

    expect(report.status).toBe("DONE");
    const [pr] = standIn.pullRequests();
    expect(pr?.title).toBe(`${hostile} (surface-71)`);
    expect(pr?.base).toBe("main");
    expect(pr?.body).toContain(hostile);
    expect(existsSync(join(repo, "pwned"))).toBe(false);
    expect(existsSync(join(tree, "pwned"))).toBe(false);
  });

  it.each(["escalated", "aborted"] as const)(
    "tears down a surface that %s: worktree removed, branch kept, nothing pushed or opened",
    async (kind) => {
      const report = await closer().close(ctx, { kind });

      expect(report.status).toBe("DONE");
      expect(existsSync(tree)).toBe(false);
      expect(git(repo, ["branch", "--list", BRANCH])).toContain(BRANCH);
      expect(git(origin, ["branch", "--list", BRANCH])).toBe("");
      expect(standIn.pullRequests()).toEqual([]);
    },
  );

  it("reports an ERROR naming origin when the repository has no origin remote", async () => {
    git(repo, ["remote", "remove", "origin"]);

    const report = await closer().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/origin/);
    expect(standIn.pullRequests()).toEqual([]);
  });

  it("reports an ERROR naming the branch when the push is rejected", async () => {
    git(repo, ["remote", "set-url", "origin", join(tmpdir(), "no-such-origin-for-open-pr")]);

    const report = await closer().close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/could not push/i);
    expect(report.detail).toContain(BRANCH);
  });

  it("reports an ERROR when the surface pinned no base branch", async () => {
    const report = await closer().close({ ...ctx, baseBranch: "" }, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toMatch(/base branch/i);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/open-pr-closer.test.ts`
Expected: FAIL, cannot resolve `./open-pr-closer.js`.

- [ ] **Step 4: Implement the closer**

Create `src/open-pr-closer.ts`:

```typescript
import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { load } from "./case-file.js";
import { closeError, closerFromAcceptedHandler } from "./closer-support.js";
import { cleanGitEnv } from "./git-env.js";
import { ensureCommitted, tryGit } from "./git-exec.js";
import type { CloseContext, CloseReport, CloserPort } from "./ports.js";
import type { TaskDef } from "./schema.js";

const execFile = promisify(execFileCb);

const OpenPullRequests = z.array(z.object({ url: z.string() }));

/**
 * Title and body for the pull request. The title is the first line of the
 * task's first text field, so a reviewer sees what was asked for; the body
 * carries the whole task definition. Both reach gh as single argv entries.
 */
function describePullRequest(surfaceId: string, taskDef: TaskDef, ctx: CloseContext): { title: string; body: string } {
  const summary = Object.values(taskDef)
    .find((value): value is string => typeof value === "string")
    ?.split("\n")[0]
    ?.trim();
  const title = summary ? `${summary.slice(0, 100)} (${surfaceId})` : `Accepted work from ${ctx.branch}`;
  const body = [
    `The delivery harness accepted this work for surface ${surfaceId} and opened this pull request from ${ctx.branch} into ${ctx.baseBranch}.`,
    "",
    "Task definition:",
    "",
    "```json",
    JSON.stringify(taskDef, null, 2),
    "```",
  ].join("\n");
  return { title, body };
}

/**
 * Open a GitHub pull request for the accepted work, for owners who want a
 * person to review before anything merges.
 *
 * Uses the GitHub CLI as whoever runs the harness: no token is taken, stored
 * or reported. The order is commit, push, detect, create. Pushing before the
 * detect step means a repeat close also delivers any follow-up commits to the
 * pull request that is already open; the detect step (an open pull request
 * for this branch) is what makes a replay report that one instead of opening
 * a second.
 *
 * On success the worktree is left in place: a pull request under review may
 * take follow-up commits. Stopped surfaces tear down like every built-in.
 *
 * `ghCommand` exists so tests can substitute a stand-in executable.
 */
export function createOpenPrCloser(options: { ghCommand?: string } = {}): CloserPort {
  const ghCommand = options.ghCommand ?? "gh";

  async function gh(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFile(ghCommand, args, { cwd, env: cleanGitEnv() });
    return stdout.trim();
  }

  async function closeAccepted(ctx: CloseContext): Promise<CloseReport> {
    if (ctx.baseBranch === "") {
      return closeError("This surface has no pinned base branch, so there is nothing to open a pull request against.");
    }

    if (existsSync(ctx.worktreePath)) {
      await ensureCommitted(ctx.worktreePath, `Accepted work from ${ctx.branch}`);
    }

    if (!(await tryGit(ctx.repoPath, ["remote", "get-url", "origin"]))) {
      return closeError(
        `The repository at ${ctx.repoPath} has no remote named origin, so ${ctx.branch} could not be pushed for a ` +
          `pull request. The work is committed on ${ctx.branch}. Add the GitHub repository as origin and close again.`,
      );
    }

    const refspec = `refs/heads/${ctx.branch}:refs/heads/${ctx.branch}`;
    if (!(await tryGit(ctx.repoPath, ["push", "--set-upstream", "origin", refspec]))) {
      return closeError(
        `git could not push ${ctx.branch} to origin, so no pull request was opened. The work is committed on ` +
          `${ctx.branch}. Check that the operator can push to origin from ${ctx.repoPath}, then close again.`,
      );
    }

    const listed = await gh(ctx.repoPath, ["pr", "list", `--head=${ctx.branch}`, "--state=open", "--json=url"]);
    const existing = OpenPullRequests.parse(JSON.parse(listed))[0];
    if (existing) {
      return {
        status: "DONE",
        detail:
          `${existing.url}: this pull request from ${ctx.branch} was already open, so no new pull request was opened. ` +
          `Any new commits on ${ctx.branch} were pushed to it.`,
      };
    }

    const { header } = await load(ctx.dir);
    const { title, body } = describePullRequest(header.surfaceId, header.taskDef, ctx);
    const created = await gh(ctx.repoPath, [
      "pr",
      "create",
      `--base=${ctx.baseBranch}`,
      `--head=${ctx.branch}`,
      `--title=${title}`,
      `--body=${body}`,
    ]);
    const url = created.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? created;
    return { status: "DONE", detail: url };
  }

  return closerFromAcceptedHandler(closeAccepted);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/open-pr-closer.test.ts`
Expected: PASS (11 tests, the `it.each` counting as two).

- [ ] **Step 6: Lint and type-check the new files**

Run: `npx eslint src/open-pr-closer.ts src/open-pr-closer.test.ts src/gh-stand-in.ts src/temp-repo.ts && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/open-pr-closer.ts src/open-pr-closer.test.ts src/gh-stand-in.ts src/temp-repo.ts
git commit -m "$(cat <<'EOF'
Add the open-pr closer's push, open and repeat path

Most owners want a person to review before anything merges. The closer
commits the accepted work, pushes the surface branch to origin and opens a
pull request against the pinned base branch through the operator's own gh
sign-in, so the harness never holds a token. An open pull request for the
branch is the detect step, so a repeat close reports it instead of opening
a second.

Tests swap the executable, as claude-mock does for the agent: a stand-in
gh script and a bare local origin, so nothing needs a network or account.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: GitHub access problems and refusals, named with their fix

**Files:**
- Modify: `src/open-pr-closer.ts` (add failure classification around both `gh` calls)
- Test: `src/open-pr-closer.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `createOpenPrCloser`, `createGhStandIn` (modes `signed-out`, `expired`, `forbidden`, `offline`; `refuseCreate(message)`) and the test fixture from Task 1; `closeError(detail)` from `src/closer-support.js`.
- Produces: no new exports. `createOpenPrCloser` now returns `ERROR` for a missing tool, sign-in needed, missing permission or no network, and `FAIL` for any other refusal of `gh pr create`, each with a fix-naming `detail` and token-shaped text redacted.

- [ ] **Step 1: Write the failing tests**

Append to `src/open-pr-closer.test.ts`, inside the existing `describe("the open-pr closer", ...)` block (it reuses `ctx`, `tree`, `standIn` and `closer`):

```typescript
  describe("when GitHub cannot be used", () => {
    beforeEach(() => {
      writeFileSync(join(tree, "feature.txt"), "the work\n");
    });

    it("names the missing GitHub tool and how to install it", async () => {
      const missing = createOpenPrCloser({ ghCommand: join(tmpdir(), "no-such-gh-for-open-pr") });

      const report = await missing.close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/not installed/i);
      expect(report.detail).toContain("https://cli.github.com");
    });

    it.each(["signed-out", "expired"] as const)("says GitHub sign-in is needed and how, when gh is %s", async (mode) => {
      standIn.setMode(mode);

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/GitHub sign-in is needed/);
      expect(report.detail).toContain("gh auth login");
      expect(standIn.pullRequests()).toEqual([]);
    });

    it("names missing permission and how to fix it", async () => {
      standIn.setMode("forbidden");

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/permission/i);
      expect(report.detail).toContain("gh auth refresh");
    });

    it("names an unreachable GitHub as a network problem", async () => {
      standIn.setMode("offline");

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toMatch(/could not reach GitHub/i);
    });

    it("reports a pull request refused for a content reason as a FAIL carrying the reason", async () => {
      standIn.refuseCreate(
        "pull request create failed: GraphQL: Pull requests into main are blocked by a branch protection rule (createPullRequest)",
      );

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("FAIL");
      expect(report.detail).toContain("blocked by a branch protection rule");
      expect(report.detail).toContain(BRANCH);
      expect(standIn.pullRequests()).toEqual([]);
    });

    it("never writes a token gh printed into the report", async () => {
      standIn.refuseCreate(
        "pull request create failed: ghp_abc123SECRET456 rejected at https://x-access-token:ghs_S3CR3Tvalue@github.com/example/project",
      );

      const report = await closer().close(ctx, accepted);

      expect(report.status).toBe("FAIL");
      expect(report.detail).not.toContain("ghp_abc123SECRET456");
      expect(report.detail).not.toContain("ghs_S3CR3Tvalue");
      expect(report.detail).toContain("[redacted]");
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/open-pr-closer.test.ts`
Expected: FAIL. Every new case gets the handler's generic `ERROR` "The close could not run: …" (so the "not installed", "sign-in is needed", "permission", "could not reach" and `FAIL` assertions fail), and the token test sees the raw token.

- [ ] **Step 3: Implement the classification**

In `src/open-pr-closer.ts`, add below `OpenPullRequests`:

```typescript
/** What a failed gh call left to go on. `code` is the exit code, or a spawn error such as "ENOENT". */
interface GhFailure {
  missing: boolean;
  exitCode: number | null;
  stderr: string;
}

function ghFailureOf(err: unknown): GhFailure {
  const { code, stderr } = err as { code?: unknown; stderr?: unknown };
  return {
    missing: code === "ENOENT",
    exitCode: typeof code === "number" ? code : null,
    stderr: typeof stderr === "string" ? stderr : "",
  };
}

// GitHub token prefixes, and credentials embedded in a URL.
const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)/g;
const URL_CREDENTIALS = /\/\/[^/\s@]+@/g;

/** gh's own first line of explanation, safe to quote: any token or credentialed URL is redacted. */
function reasonOf(failure: GhFailure): string {
  const line = failure.stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "gh gave no reason";
  return line.replace(TOKEN, "[redacted]").replace(URL_CREDENTIALS, "//[redacted]@");
}

/**
 * The GitHub access problems any gh call can hit, each an ERROR naming its
 * fix; null when the failure is something else. Recognised from gh's own
 * signals: a spawn ENOENT, its documented exit code 4 for "authentication
 * required", and the HTTP status it prints.
 */
function accessProblem(failure: GhFailure): CloseReport | null {
  if (failure.missing) {
    return closeError(
      "The GitHub command-line tool (gh) is not installed, or not on the PATH the harness runs with, so no pull " +
        "request could be opened. Install it from https://cli.github.com, run gh auth login, then close again.",
    );
  }
  if (failure.exitCode === 4 || /HTTP 401|Bad credentials|gh auth login/i.test(failure.stderr)) {
    return closeError(
      "GitHub sign-in is needed: gh is not signed in, or its sign-in has expired, so no pull request could be " +
        "opened. Run gh auth login as the person or account the harness runs as, then close again.",
    );
  }
  if (/HTTP 403|does not have the correct permissions|not accessible/i.test(failure.stderr)) {
    return closeError(
      "gh is signed in, but that GitHub account lacks permission to open pull requests on this repository. Run " +
        "gh auth refresh -s repo, or get write access to the repository, then close again.",
    );
  }
  if (/error connecting to|could not resolve host|timed? ?out/i.test(failure.stderr)) {
    return closeError("gh could not reach GitHub, so no pull request could be opened. Check the network and close again.");
  }
  return null;
}
```

Replace the `listed` line in `closeAccepted` with:

```typescript
    let listed: string;
    try {
      listed = await gh(ctx.repoPath, ["pr", "list", `--head=${ctx.branch}`, "--state=open", "--json=url"]);
    } catch (err) {
      const failure = ghFailureOf(err);
      return (
        accessProblem(failure) ??
        closeError(`gh could not check whether ${ctx.branch} already has an open pull request: ${reasonOf(failure)}.`)
      );
    }
```

Replace the `created` call with:

```typescript
    let created: string;
    try {
      created = await gh(ctx.repoPath, [
        "pr",
        "create",
        `--base=${ctx.baseBranch}`,
        `--head=${ctx.branch}`,
        `--title=${title}`,
        `--body=${body}`,
      ]);
    } catch (err) {
      const failure = ghFailureOf(err);
      // Anything that is not an access problem is GitHub declining this pull
      // request (branch protection, no commits between the branches): a
      // decision a person can make, so FAIL rather than ERROR.
      return (
        accessProblem(failure) ?? {
          status: "FAIL",
          detail:
            `GitHub refused to open a pull request from ${ctx.branch} into ${ctx.baseBranch}: ${reasonOf(failure)}. ` +
            `The work is committed and pushed on ${ctx.branch}. Resolve the refusal on GitHub, or choose a different ` +
            `close, then close again.`,
        }
      );
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/open-pr-closer.test.ts`
Expected: PASS, including every Task 1 test.

- [ ] **Step 5: Lint and type-check**

Run: `npx eslint src/open-pr-closer.ts src/open-pr-closer.test.ts && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/open-pr-closer.ts src/open-pr-closer.test.ts
git commit -m "$(cat <<'EOF'
Name each GitHub access problem the open-pr closer hits

A missing gh, an expired sign-in or a missing permission is a project setup
problem the on-call reader has to fix, so each is an ERROR naming the
specific cause and the command that fixes it, recognised from gh's own
signals rather than a generic "could not run". A pull request GitHub
declines for a content reason, such as branch protection, is a FAIL
carrying GitHub's reason, with any token-shaped text redacted so no
credential reaches the case file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Selectable by name, end to end through a surface

**Files:**
- Modify: `src/schema.ts` (`CloserRef` gains `open-pr`), `src/resolve-closer.ts` (new arm), `src/index.ts` (export), `src/ports.ts` (`noopCloser` comment), `docs/writing-a-closer.md` ("Choosing a closer"), `tests/writing-a-closer-guide.test.ts`
- Test: `src/schema.test.ts` (append), `src/surface-close.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `createOpenPrCloser()` from Task 1; `createGhStandIn()` and `addLocalOrigin(repo)` from Task 1; `run`, `create`, `load`, `resolveCloser`, `deterministicRouter` and the file's own `worker`, `budgets`, `gateRef`, `PASSING_TAP`, `BRANCH`, `git` in `src/surface-close.test.ts`.
- Produces: `CloserRef` includes `{ type: "open-pr" }`; `resolveCloser({ type: "open-pr" }, repoPath)` returns `createOpenPrCloser()` (gh from `PATH`); `createOpenPrCloser` exported from `src/index.ts`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("CloserRef", ...)` in `src/schema.test.ts`:

```typescript
  it("accepts the open-pr closer named with no parameters", () => {
    expect(CloserRef.parse({ type: "open-pr" })).toEqual({ type: "open-pr" });
  });
```

Append to `src/surface-close.test.ts` (add `afterEach` and `vi` to the `vitest` import, `delimiter` to a `node:path` import, and import `createGhStandIn` from `./gh-stand-in.js` and `addLocalOrigin` from `./temp-repo.js`):

```typescript
describe("an accepted surface closed by opening a pull request", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ends CLOSED with its branch pushed, a pull request against the base branch, and the address as its report", async () => {
    // Swap the executable: the stand-in named gh goes first on PATH, as the
    // real gh would be found on an operator's machine.
    const standIn = createGhStandIn();
    vi.stubEnv("PATH", `${standIn.binDir}${delimiter}${process.env.PATH ?? ""}`);
    const dir = await mkdtemp(join(tmpdir(), "surface-close-case-"));
    const repo = initTempRepo("surface-close-repo-", { "report.tap": PASSING_TAP });
    const origin = addLocalOrigin(repo);
    const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-close-tree-")), "wt") };
    const closerRef: CloserRef = { type: "open-pr" };
    await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef, closerRef }, budgets);
    const pinned = (await load(dir)).header.closerRef;
    if (!pinned) throw new Error("closerRef was not pinned");

    const result = await run(dir, location, {
      agent: worker,
      triage: deterministicRouter,
      closer: resolveCloser(pinned, repo),
    });

    expect(result.state).toBe("CLOSED");
    expect((await load(dir)).outcome?.reason).toBe("https://github.com/example/project/pull/1");
    expect(git(origin, ["show", `${BRANCH}:feature.txt`])).toBe("the feature");
    expect(standIn.pullRequests()).toEqual([expect.objectContaining({ head: BRANCH, base: "main" })]);
    expect(existsSync(location.worktreePath)).toBe(true);
  });
});
```

Extend the first `it` in `tests/writing-a-closer-guide.test.ts` with:

```typescript
    expect(guide).toContain('type: "open-pr"');
    expect(guide).toContain("gh auth login");
    expect(guide).toMatch(/origin/);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/schema.test.ts src/surface-close.test.ts tests/writing-a-closer-guide.test.ts`
Expected: FAIL. `CloserRef` rejects `open-pr`; the surface test fails at `create` (header validation) or reaches `ERROR` from `failedCloser`; the guide has no `type: "open-pr"`. (`gh auth login` already appears in the guide's FAIL/ERROR prose, so that one assertion passes; the `open-pr` one is the red.)

- [ ] **Step 3: Implement**

In `src/schema.ts`, add a variant to `CloserRef` after `commit-to-branch`:

```typescript
  // No parameters: the pull request targets the pinned base branch. The spec's
  // titleTemplate/bodyTemplate are deliberately absent until an owner needs
  // them; the defaults name the surface and the task.
  z.object({ type: z.literal("open-pr") }),
```

In `src/resolve-closer.ts`, import and add the arm:

```typescript
import { createOpenPrCloser } from "./open-pr-closer.js";
```

```typescript
    case "open-pr":
      return createOpenPrCloser();
```

In `src/index.ts`, beside the commit-to-branch export:

```typescript
export { createOpenPrCloser } from "./open-pr-closer.js";
```

In `src/ports.ts`, the `noopCloser` comment's last sentence becomes:

```typescript
 * so the worktree is left in place. The shipped closers are in
 * merge-back-closer.ts, commit-to-branch-closer.ts and open-pr-closer.ts.
```

In `docs/writing-a-closer.md`, in the "Choosing a closer" code block, after the `commit-to-branch` entry add:

```ts
// Built in: commit the work, push the surface's branch to origin, and open a GitHub pull request into the base branch.
{ type: "open-pr" }
```

and directly after that code block, before "Whoever runs the surface…", add:

```markdown
`open-pr` runs the GitHub command-line tool, `gh`, as whoever runs the harness,
so only projects that name it need `gh` installed and signed in: install it from
https://cli.github.com and run `gh auth login` first. The harness never takes or
stores a token. The repository's `origin` remote must be the GitHub repository.
The closing report is the pull request's address; closing again finds the pull
request already open and reports it rather than opening a second. The worktree is
left in place after the pull request opens, for follow-up commits. A missing
`gh`, an expired sign-in or a missing permission is reported as `"ERROR"` naming
the fix; a pull request GitHub declines, for example because of branch
protection, is `"FAIL"`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/schema.test.ts src/surface-close.test.ts src/resolve-closer.test.ts tests/writing-a-closer-guide.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and type-check**

Run: `npx eslint src/schema.ts src/resolve-closer.ts src/index.ts src/ports.ts src/surface-close.test.ts src/schema.test.ts tests/writing-a-closer-guide.test.ts && npx tsc --noEmit`
Expected: no output. The exhaustive `switch` in `resolveCloser` fails to compile if the arm is missing.

- [ ] **Step 6: Commit**

```bash
git add src/schema.ts src/schema.test.ts src/resolve-closer.ts src/index.ts src/ports.ts src/surface-close.test.ts docs/writing-a-closer.md tests/writing-a-closer-guide.test.ts
git commit -m "$(cat <<'EOF'
Let a project name the open-pr closer as data

A project owner selects a close by naming it, never by writing code, so
open-pr joins CloserRef and resolveCloser. The guide now lists it with its
one precondition, a signed-in gh and a GitHub origin, which only projects
that choose it need. A surface-level test proves an accepted surface ends
CLOSED with the pull request's address as its report, finding gh on PATH
exactly as an operator's machine would.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The pull-request demo

**Files:**
- Create: `demos/close-interface-slice-5-open-pr.ts`
- Modify: `package.json` (add `demo:close-slice-5` after `demo:close-slice-4`), `docs/writing-a-closer.md` (demo pointer), `tests/writing-a-closer-guide.test.ts`

**Interfaces:**
- Consumes: `create`, `load`, `readRef` from `../src/case-file.js`; `initTempRepo`, `addLocalOrigin` from `../src/temp-repo.js`; `createGhStandIn` from `../src/gh-stand-in.js`; `cleanGitEnv` from `../src/git-env.js`; `run` from `../src/surface.js`; `resolveCloser` from `../src/resolve-closer.js`; `branchName` from `../src/provision.js`; `deterministicRouter` from `../src/router.js`; `EscalationPacket` from `../src/triage-role-config.js`; types from `../src/ports.js` and `../src/schema.js`.
- Produces: a script run via `npx tsx`; nothing importable.

- [ ] **Step 1: Write the demo script**

Create `demos/close-interface-slice-5-open-pr.ts`:

```typescript
/**
 * UAT demo for Close Interface Slice 5: Accepted Work Opens a Pull Request.
 *
 * Accepts a surface with the open-pr closer named as data, prints its closing
 * report, closes it again to show the open pull request is reused, then runs a
 * second surface while the gh stand-in behaves as if GitHub sign-in has expired.
 *
 * Needs only `git` and `node`: a stand-in executable named gh is put first on
 * PATH, and origin is a bare repository on this machine, so there is no network
 * and no GitHub account involved.
 *
 * Usage: npm run demo:close-slice-5
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { create, load, readRef } from "../src/case-file.js";
import { addLocalOrigin, initTempRepo } from "../src/temp-repo.js";
import { createGhStandIn } from "../src/gh-stand-in.js";
import { cleanGitEnv } from "../src/git-env.js";
import { run } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { branchName } from "../src/provision.js";
import { deterministicRouter } from "../src/router.js";
import { EscalationPacket } from "../src/triage-role-config.js";
import type { AgentContext, AgentPort, RoleHandle, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const closerRef: CloserRef = { type: "open-pr" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** Stands in for a worker that finishes the job. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

async function startSurface(repo: string, surfaceId: string): Promise<{ dir: string; location: SurfaceLocation; ports: SurfacePorts }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close5-demo-case-"));
  const location: SurfaceLocation = {
    repoPath: repo,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close5-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId, taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  return { dir, location, ports: { agent: workingAgent, triage: deterministicRouter, closer: resolveCloser(pinned, repo) } };
}

async function main(): Promise<void> {
  const standIn = createGhStandIn();
  process.env.PATH = `${standIn.binDir}${path.delimiter}${process.env.PATH ?? ""}`;

  console.log("=== Close Interface Slice 5: accepted work opens a pull request ===\n");
  console.log(`The project names its closer as data: closerRef = ${JSON.stringify(closerRef)}\n`);
  console.log("This demo uses no network and no GitHub account. A stand-in executable named gh is put");
  console.log(`first on PATH (${standIn.command}), in place of the real GitHub command-line tool,`);
  console.log("and origin is a bare repository on this machine. A real project that selects this");
  console.log("closer needs gh installed and signed in (gh auth login); no other project does.\n");

  const repo = initTempRepo("close5-demo-repo-", { "report.tap": PASSING_TAP });
  const origin = addLocalOrigin(repo);

  // --- An accepted surface ---
  const first = await startSurface(repo, "surface-81");
  const firstResult = await run(first.dir, first.location, first.ports);
  const firstCase = await load(first.dir);
  const branch = branchName("surface-81");

  console.log("--- 1. The accepted surface's closing report ---");
  console.log(`The surface ran to: ${firstResult.state}`);
  console.log(`Closing report: ${firstCase.outcome?.reason}\n`);

  console.log("--- 2. What arrived ---");
  console.log(`${branch} on origin holds: ${git(origin, ["show", `${branch}:feature.txt`])}`);
  for (const pr of standIn.pullRequests()) {
    console.log(`Pull request ${pr.url}: ${pr.head} into ${pr.base}, titled "${pr.title}"`);
  }
  console.log(`Worktree still on disk, for follow-up commits: ${fs.existsSync(first.location.worktreePath)}\n`);

  // --- The same close, repeated ---
  const repeat = await first.ports.closer.close(
    {
      worktreePath: first.location.worktreePath,
      dir: first.dir,
      repoPath: repo,
      branch,
      baseBranch: firstCase.header.baseBranch ?? "",
    },
    { kind: "accepted" },
  );

  console.log("--- 3. Closing the same surface again ---");
  console.log(`Repeat close: ${repeat.status}: ${repeat.detail}`);
  console.log(`Pull requests the stand-in now holds: ${standIn.pullRequests().length}\n`);

  // --- A second surface, while GitHub sign-in has expired ---
  standIn.setMode("expired");
  const second = await startSurface(repo, "surface-82");
  const secondResult = await run(second.dir, second.location, second.ports);
  const secondCase = await load(second.dir);

  console.log("--- 4. A second surface, after GitHub sign-in has expired ---");
  console.log("The stand-in now answers every call the way gh does when its sign-in has expired.");
  let attempt = 0;
  for (const entry of secondCase.history) {
    if (entry.t === "close") {
      attempt += 1;
      const report = (await readRef(second.dir, entry.detailRef)) as { detail?: string };
      console.log(`Close attempt ${attempt}: ${entry.status}: ${report.detail ?? "(no detail)"}`);
    } else if (entry.t === "triage") {
      console.log(`  Triage: ${entry.verdict} (${entry.rationale})`);
    }
  }
  console.log(`The surface ran to: ${secondResult.state}`);
  const packet = EscalationPacket.parse(await readRef(second.dir, secondCase.outcome?.packetRef ?? ""));
  console.log(`Escalation evidence: ${packet.evidence}`);
  console.log(`Pull requests the stand-in holds: ${standIn.pullRequests().length} (none opened for surface-82)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Register the demo and point the guide at it**

In `package.json`, after the `demo:close-slice-4` line:

```json
    "demo:close-slice-5": "npx tsx demos/close-interface-slice-5-open-pr.ts",
```

In `docs/writing-a-closer.md`, append to the `open-pr` paragraph added in Task 3:

```markdown
To watch it open a pull request, reuse it on a repeat close, and report an
expired sign-in, against a stand-in for `gh` with no network: `npm run demo:close-slice-5`.
```

In `tests/writing-a-closer-guide.test.ts`, add to the first `it`:

```typescript
    expect(guide).toContain("npm run demo:close-slice-5");
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:close-slice-5`

Expected, checked against the slice's UAT:
- The opening text says a stand-in for gh is used, with no network and no GitHub account.
- Section 1: `CLOSED`, closing report `https://github.com/example/project/pull/1`.
- Section 2: `feature.txt` on `surface/surface-81` in origin, one pull request into `main`, worktree still on disk `true`.
- Section 3: `DONE`, detail starting with the same address and saying no new pull request was opened; stand-in holds `1`.
- Section 4: every close attempt `ERROR: GitHub sign-in is needed … gh auth login …`, triage `retry_close` rounds, the surface ends `ESCALATED`, the evidence is that same sentence, and the stand-in still holds `1`.

If the printed output contradicts any of those, fix the code, not the expectation.

- [ ] **Step 4: Run the targeted checks**

Run: `npx vitest run tests/writing-a-closer-guide.test.ts tests/typecheck-coverage.test.ts && npx eslint demos/close-interface-slice-5-open-pr.ts && npx tsc --noEmit`
Expected: PASS and no output.

- [ ] **Step 5: Commit**

```bash
git add demos/close-interface-slice-5-open-pr.ts package.json docs/writing-a-closer.md tests/writing-a-closer-guide.test.ts
git commit -m "$(cat <<'EOF'
Add the pull-request demo

The slice's reviewer needs to see the three things an owner will meet: the
pull request's address as the closing report, a repeat close reusing it,
and an expired GitHub sign-in reported with its fix. The script runs all
three against a stand-in gh and a local origin and says so, so it needs no
network or GitHub account.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **Read before you append.** `src/surface-close.test.ts` already defines `worker`, `budgets`, `gateRef`, `PASSING_TAP`, `BRANCH` (`surface/surface-7`) and `git`; reuse them. `src/temp-repo.ts` already imports `execFileSync`, `mkdtempSync`, `tmpdir`, `join` and `cleanGitEnv`.
- **`closerFromAcceptedHandler` already owns teardown and the never-throw guarantee.** Do not add a second `outcome.kind` switch or a top-level try/catch in `open-pr-closer.ts`.
- **Do not add `titleTemplate`/`bodyTemplate` or a `ghCommand` field to `CloserRef`.** The first is a deliberate omission (see Global Constraints); the second is test-only and must never be data.
- **Keep the stand-in's messages as they are.** The signed-out and expired texts and exit codes were captured from gh 2.94; the classifier is written against them.
