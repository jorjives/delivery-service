import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKLOG_DIR, parseItem, setFields } from "./backlog.js";
import { git } from "./git-exec.js";
import type { HeldItem } from "./follow-ups.js";
import { isEnoent } from "./journal.js";
import { checkFilesOf, treeOf } from "./repair-changes.js";
import type { Assertion, GateRef } from "./schema.js";
import { GuardName } from "./schema.js";
import { checkItem, describeCheck, FILE_LIMIT } from "./item-check.js";
import { z } from "zod";

// Re-export GuardName for consumers who import from guards
export { GuardName } from "./schema.js";

/**
 * A path pattern, matched by git with glob magic: `**` crosses folders, `*`
 * does not. Written without git's own `:(...)` prefixes, which the harness adds
 * itself, so a pack can only add to what is guarded, never take paths out.
 */
export const GuardGlob = z.string().min(1).refine((glob) => !glob.startsWith(":"), "must be a path pattern such as **/*.test.*, without git's own prefixes");

/** What a fix may not touch: existing tests, the files that decide how tests run, and markers that switch a test off. */
export const GuardLists = z.object({ testGlobs: z.array(z.string()), protectedGlobs: z.array(z.string()), skipMarkers: z.array(z.string()) });
export type GuardLists = z.infer<typeof GuardLists>;

/** The lists as one fix is judged by them: `testsCategory` lets its fix change an existing test, never delete one. */
export const Guards = GuardLists.extend({ testsCategory: z.boolean() });
export type Guards = z.infer<typeof Guards>;

/** The harness's own lists, which every pack's additions extend. */
export const DEFAULT_GUARDS: GuardLists = {
  testGlobs: ["**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/*_spec.*", "**/test_*.py", "**/test/**", "**/tests/**", "**/__tests__/**", "**/spec/**"],
  protectedGlobs: [
    "**/vitest.config.*", "**/vitest.workspace.*", "**/jest.config.*", "**/karma.conf.*", "**/playwright.config.*", "**/cypress.config.*",
    "**/.mocharc*", "**/ava.config.*", "**/pytest.ini", "**/tox.ini", "**/noxfile.py", "**/conftest.py", "**/phpunit.xml*",
    ".github/workflows/**", ".gitlab-ci.yml", ".circleci/**", ".travis.yml", "azure-pipelines.yml", "Jenkinsfile", ".buildkite/**",
    "Makefile", "makefile", "GNUmakefile",
    // ponytail: test settings kept inside a general manifest (pyproject.toml [tool.pytest], setup.cfg [tool:pytest], Cargo.toml) are not guarded, as guarding the whole file would refuse every dependency change; package.json alone is read key by key (`testCommandAt`). A pack can add such a file to protectedGlobs.
    "**/.gitignore", // the ignore rules decide which files the guards below can see on a tracked path; ignored files are also checked directly (`ignoredAssertions`)
  ],
  skipMarkers: [".skip(", ".only(", "xit(", "xdescribe(", "xtest(", "@Ignore", "@Disabled", "pytest.mark.skip", "pytest.mark.xfail", "unittest.skip", "t.Skip(", "#[ignore]"],
};


/**
 * The guards every run is judged by unless its task says otherwise: those that catch weakening and never block
 * honest work. `tests-unchanged` is not among them, because test-first work and refactoring change existing tests.
 */
export const DEFAULT_ON: readonly GuardName[] = ["tests-untouched", "check-untouched", "no-skips", "ignored", "backlog"];
export const BACKLOG_GUARD = "guard:backlog";
export const BACKLOG_ONLY_GUARD = "guard:backlog-only";

/** The guards one run is judged by: what they look at, and which of them are on. */
export interface ActiveGuards {
  lists: GuardLists;
  on: readonly GuardName[];
}

/** Whether an assertion id belongs to a guard that is on. The ignored-file guard has one id per file. */
const judged = (on: readonly GuardName[], id: string): boolean => on.some((name) => id === `guard:${name}` || id.startsWith(`guard:${name}:`));

const merged = (defaults: string[], added: string[] = []): string[] => [...new Set([...defaults, ...added])];

/** The defaults followed by a pack's additions, each once. */
export function guardListsFor(additions: GuardLists | undefined): GuardLists {
  return {
    testGlobs: merged(DEFAULT_GUARDS.testGlobs, additions?.testGlobs),
    protectedGlobs: merged(DEFAULT_GUARDS.protectedGlobs, additions?.protectedGlobs),
    skipMarkers: merged(DEFAULT_GUARDS.skipMarkers, additions?.skipMarkers),
  };
}

export const TESTS_GUARD = "guard:tests-untouched"; // a test deleted, renamed or type-changed
export const EDIT_GUARD = "guard:tests-unchanged"; // an existing test modified
export const CHECK_GUARD = "guard:check-untouched";
export const SKIP_GUARD = "guard:no-skips";
const IGNORED_GUARD = "guard:ignored:";
export const ignoredId = (path: string): string => `${IGNORED_GUARD}${path}`;
export const isGuard = (id: string): boolean => id.startsWith("guard:");

/**
 * Whether a gate round's newly failed ids say the fix needed an existing test
 * changed and nothing else was wrong with it: the one deterministic signal
 * behind "needs a change to one of your tests". A deletion, a skip, a settings
 * change or an ignored file is a cheat, never a need.
 */
export const needsTestChange = (round: readonly string[]): boolean => round.includes(EDIT_GUARD) && round.filter(isGuard).every((id) => id === EDIT_GUARD);

/** Folders of other people's code, which an ignore rule rightly hides: never judged as the project's own tests or settings. ponytail: only the common ones; add a folder here if a project's tooling writes guarded paths into another. */
const DEPENDENCY_DIRS = ["node_modules", ".venv", "venv"];
/** The most patch text read to look for skip markers; past it the change is refused as too large to check, never passed. */
const PATCH_LIMIT = 64 * 1024 * 1024;
/** The package.json scripts npm runs for a test command, and the test runners' own settings kept there. */
const TEST_SCRIPT = /^(pre|post)?test(:|$)/;
const TEST_SETTINGS = ["jest", "mocha", "ava"] as const;

const glob = (pattern: string): string => `:(glob)${pattern}`;
const PUT_BACK = "Existing tests may not be removed, changed or skipped, and how tests run may not change. Put them back and fix the problem in the code.";
const assertion = (id: string, failures: string[], what: string, advice = PUT_BACK): Assertion =>
  failures.length === 0 ? { id, outcome: "PASS", detail: `no ${what}` } : { id, outcome: "FAIL", detail: `Refused: this fix ${what}: ${failures.join(", ")}. ${advice}` };

/** Each path the change touched among `patterns`, with git's one-letter status (A added, D deleted, M modified, T type changed). */
async function touched(cwd: string, base: string, tree: string, patterns: string[]): Promise<{ status: string; path: string }[]> {
  if (patterns.length === 0) return [];
  const fields = (await git(cwd, ["diff-tree", "-r", "--no-renames", "--name-status", "-z", base, tree, "--", ...patterns], { raw: true })).split("\0").filter(Boolean);
  const pairs: { status: string; path: string }[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) pairs.push({ status: fields[index] ?? "", path: fields[index + 1] ?? "" });
  return pairs;
}

/** Whether the only change to `path` is the harness marking its item resolved: that commit stays on a task's branch when its landing is retried, and is not the worker's doing. */
async function isResolution(cwd: string, base: string, tree: string, path: string): Promise<boolean> {
  const blob = (ref: string) => git(cwd, ["cat-file", "blob", `${ref}:${path}`], { raw: true, maxBuffer: FILE_LIMIT });
  const [before, after] = await Promise.all([blob(base), blob(tree)]);
  return setFields(before, { status: "resolved" }) === after;
}

/**
 * What a change did to the backlog: the new items it added, each read from `tree`, and what it may not do (an
 * existing item edited or removed, or a new file that is not a valid item). Shared by the backlog guard and the
 * after agent pass, so a follow-up is judged the same wherever it comes from.
 */
export async function addedBacklogItems(cwd: string, base: string, tree: string, resolving?: string): Promise<{ items: HeldItem[]; findings: string[] }> {
  const items: HeldItem[] = [];
  const findings: string[] = [];
  for (const { status, path } of await touched(cwd, base, tree, [glob(`${BACKLOG_DIR}/**`)])) {
    if (status === "M" && path === `${BACKLOG_DIR}/${resolving}` && (await isResolution(cwd, base, tree, path))) continue;
    if (status === "M" || status === "T") findings.push(`${path} changed`);
    else if (status === "D") findings.push(`${path} removed`);
    else if (status === "A") {
      const file = path.slice(BACKLOG_DIR.length + 1);
      const text = await git(cwd, ["cat-file", "blob", `${tree}:${path}`], { raw: true, maxBuffer: FILE_LIMIT });
      const parsed = parseItem(file, text);
      if (parsed.ok) items.push({ file, text });
      else findings.push(`${path} (${parsed.reason})`);
    }
  }
  return { items, findings };
}

/**
 * What a change did besides adding ideas: any path outside the backlog, a new item that is not an idea with a
 * severity and a check, and an idea whose check does not find its problem in the tree as the agent left it (files
 * git ignores are not in it).
 * Edits to existing items, and new files that are not items at all, are the backlog guard's to report.
 */
async function notIdeas(cwd: string, base: string, tree: string): Promise<string[]> {
  const findings: string[] = [];
  for (const { status, path } of await touched(cwd, base, tree, ["."])) {
    if (!path.startsWith(`${BACKLOG_DIR}/`)) {
      findings.push(`${path} changed`);
      continue;
    }
    if (status !== "A") continue;
    const parsed = parseItem(path.slice(BACKLOG_DIR.length + 1), await git(cwd, ["cat-file", "blob", `${tree}:${path}`], { raw: true, maxBuffer: FILE_LIMIT }));
    if (!parsed.ok) continue;
    const { item } = parsed;
    if (item.status !== "idea") findings.push(`${path} is not an idea (its status is ${item.status})`);
    else if (item.severity === undefined) findings.push(`${path} has no severity`);
    else if (item.check === undefined) findings.push(`${path} has no check`);
    else {
      const result = await checkItem(item.check, { repoPath: cwd, commit: tree }, item.file);
      if (result === "resolved") findings.push(`${path}: its check does not find the problem in the project (${describeCheck(item.check).replace("is still", "is not")})`);
      else if (result !== "present") findings.push(`${path}: its check could not run (${result.error})`);
    }
  }
  return findings;
}

/** How a revision's package.json says tests run: its test scripts and its test runners' settings. Empty when it has none or cannot be read. */
async function testCommandAt(cwd: string, rev: string): Promise<string> {
  let text: string;
  try {
    text = await git(cwd, ["cat-file", "blob", `${rev}:package.json`], { raw: true, maxBuffer: FILE_LIMIT });
  } catch {
    return "";
  }
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    const scripts = typeof pkg.scripts === "object" && pkg.scripts !== null ? Object.entries(pkg.scripts).filter(([name]) => TEST_SCRIPT.test(name)).sort(([a], [b]) => a.localeCompare(b)) : [];
    return JSON.stringify([scripts, TEST_SETTINGS.map((key) => pkg[key] ?? null)]);
  } catch {
    return text; // not JSON: any change to it is a change
  }
}

/** Each test file with an added line holding a skip marker, as "file (marker)"; or the reason the change could not be read. Scoped to `testGlobs`: a marker outside a test file is not a test switched off. */
async function addedSkips(cwd: string, base: string, tree: string, markers: string[], testGlobs: string[]): Promise<string[]> {
  const testPaths = new Set((await touched(cwd, base, tree, testGlobs.map(glob))).map(({ path }) => path));
  if (testPaths.size === 0) return [];
  let patch: string;
  try {
    patch = await git(cwd, ["diff-tree", "-r", "-p", "-U0", "--text", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-color", base, tree], { raw: true, maxBuffer: PATCH_LIMIT });
  } catch (err) {
    if ((err as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return ["the change is too large to check for skipped tests"];
    throw err;
  }
  const found = new Set<string>();
  let file = "";
  let inTest = false;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) inHunk = false;
    else if (!inHunk && line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      inTest = testPaths.has(file);
    } else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && inTest && line.startsWith("+")) for (const marker of markers) if (line.includes(marker)) found.add(`${file} (${marker})`);
  }
  return [...found];
}

/**
 * Each file git is told not to read from disk (assume-unchanged, skip-worktree),
 * as "file (hidden from git)". The private index starts from the working copy's
 * own, so such a file's change or deletion never reaches the tree: an agent
 * could mark a test and delete it unseen. Same rule as `oddFileIn`
 * (`finding-check.ts`). ponytail: a sparse checkout marks files skip-worktree
 * legitimately and would be refused; the harness's own worktrees are never sparse.
 */
async function hiddenFiles(cwd: string): Promise<string[]> {
  const listed = await git(cwd, ["ls-files", "-z", "-v"], { raw: true });
  return listed
    .split("\0")
    .filter((entry) => entry !== "" && (entry.charAt(0) === "S" || entry.charAt(0) !== entry.charAt(0).toUpperCase()))
    .map((entry) => `${entry.slice(2)} (hidden from git)`);
}

/** Each git-ignored file in the working copy among `patterns`, dependency folders excepted. */
async function ignoredAmong(worktreePath: string, patterns: string[]): Promise<string[]> {
  if (patterns.length === 0) return [];
  const exclusions = DEPENDENCY_DIRS.map((dir) => `:(glob,exclude)**/${dir}/**`);
  const listed = await git(worktreePath, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...patterns.map(glob), ...exclusions], { raw: true });
  return listed.split("\0").filter(Boolean);
}

/**
 * What in an ignored test file would switch tests off: the skip markers it holds,
 * or why it cannot be read to tell. A file holding a NUL byte is compiled or
 * cached output (a `.pyc`, a `.class`) and is not read; a dangling link is
 * nothing a test runner can read either.
 * ponytail: a hand-made binary cache (a `.pyc` written to replace a test's
 * code) is not caught; judge `__pycache__` against its source if that turns up.
 */
async function hiddenSkipsIn(worktreePath: string, path: string, markers: string[]): Promise<string[]> {
  const file = join(worktreePath, path);
  let size: number;
  try {
    const found = await stat(file);
    if (!found.isFile()) return ["it is not a plain file, so it cannot be read"];
    size = found.size;
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  if (size > FILE_LIMIT) return ["it is too large to read"];
  const bytes = await readFile(file);
  if (bytes.includes(0)) return [];
  const text = bytes.toString("utf-8");
  return markers.filter((marker) => text.includes(marker));
}

/**
 * The git-ignored files that would change what the tests do, unseen by every
 * other guard because `treeOf` leaves untracked ignored files out while the
 * project's test command reads the disk. Judged as a new tracked file would be, so build and
 * cache output is never judged a cheat: a file under the protected paths (a
 * test-runner config or `conftest.py` that git ignores) is refused, as a new
 * setting is; a file under the test paths is refused only when it holds a skip
 * marker (a hidden `describe.only`) or cannot be read to tell, as a new test with
 * an added marker is. A compiled `dist/clamp.test.js` or a `__pycache__` file a
 * new test's run writes is allowed, as the new test itself is. Git itself says
 * what is ignored (through `.gitignore`, `.git/info/exclude` in the common git
 * dir, the user's global excludes, or a pattern the project already held), so
 * every way of hiding a file is covered. One id per file lets the gate's
 * `baseline` record the ones already there, so only a new one is a new failure.
 * ponytail: a file already refused at baseline and then rewritten is not seen; hash it into the id if that matters.
 * ponytail: build output holding a copy of an already-skipped test (`dist/old.test.js` from a tracked test with a legitimate `.skip(`) is refused when the agent, not the project's check, built it; the refusal says to delete such output, so the agent's next attempt passes.
 */
export async function ignoredAssertions(worktreePath: string, guards: ActiveGuards): Promise<Assertion[]> {
  if (!guards.on.includes("ignored")) return [];
  const refused = (path: string, why: string): Assertion => ({
    id: ignoredId(path),
    outcome: "FAIL",
    detail: `Refused: this work leaves ${path} where git ignores it, but the tests still read it from disk, and ${why}. Test settings, and tests that switch others off, may not be hidden from git: remove it (if your build or test run wrote it, delete that output), or fix the problem in the code.`,
  });
  const settings = await ignoredAmong(worktreePath, guards.lists.protectedGlobs);
  const found = settings.map((path) => refused(path, "it decides how the tests run"));
  for (const path of await ignoredAmong(worktreePath, guards.lists.testGlobs)) {
    if (settings.includes(path)) continue;
    const skips = await hiddenSkipsIn(worktreePath, path, guards.lists.skipMarkers);
    if (skips.length > 0) found.push(refused(path, `it switches tests off or cannot be checked: ${skips.join(", ")}`));
  }
  return found;
}

/** What a gate repair was accepted as changing: each setting's label, and a fingerprint of how it stood when the repair ended. */
export type AcceptedSettings = Record<string, string>;

/**
 * Each setting that differs between `base` and `tree` (a revision or a tree id), with a fingerprint of how it stands
 * in `tree`: the blob a protected or check file has there ("deleted" when it is gone), or the test command itself.
 * Files hidden from git are not here: nothing excuses those.
 */
export async function settingsChanged(worktreePath: string, base: string, tree: string, lists: GuardLists, verify: GateRef | null): Promise<Map<string, string>> {
  const runs = (verify === null ? [] : checkFilesOf(verify, { repoPath: worktreePath, worktreePath })).map((path) => `:(literal)${path}`);
  const found = new Map<string, string>();
  for (const { path } of await touched(worktreePath, base, tree, [...lists.protectedGlobs.map(glob), ...runs])) {
    found.set(path, await git(worktreePath, ["rev-parse", "--verify", "-q", `${tree}:${path}`]).catch(() => "deleted"));
  }
  const [before, after] = await Promise.all([testCommandAt(worktreePath, base), testCommandAt(worktreePath, tree)]);
  if (before !== after) found.set("package.json (how tests are run)", after);
  return found;
}

/**
 * Whether the work in `worktreePath` touched the tests that judge it: every
 * file in the working copy, committed or not, compared by git with where the
 * work started from `base`; and every ignored file that would change
 * what the tests do (`ignoredAssertions`), which the comparison cannot see.
 * Independent of how the project's tests report, so it holds for a project
 * whose tests say only pass or fail. Each is absent at baseline, so a FAIL is a
 * new failure.
 * ponytail: package.json is read at the top of the project only; a workspace's own package.json is guarded only through `protectedGlobs`.
 * `base` is the commit the work started from, pinned when its working copy was made, so moving HEAD back cannot hide a deleted test.
 */
export async function guardAssertions(worktreePath: string, base: string, guards: ActiveGuards, verify: GateRef | null, accepted: AcceptedSettings = {}, resolving?: string): Promise<Assertion[]> {
  const { lists, on } = guards;
  const tree = await treeOf(worktreePath);
  const tests = await touched(worktreePath, base, tree, lists.testGlobs.map(glob));
  const removed = tests.filter(({ status }) => status !== "A" && status !== "M").map(({ path }) => `${path} deleted`);
  const edited = tests.filter(({ status }) => status === "M").map(({ path }) => `${path} changed`);
  const changed = await settingsChanged(worktreePath, base, tree, lists, verify);
  // A setting a gate repair was accepted as changing, and which still stands as that repair left it, is not the worker's doing.
  const settings = [...(await hiddenFiles(worktreePath)), ...[...changed].filter(([label, print]) => accepted[label] !== print).map(([label]) => label)];
  const all = [
    assertion(TESTS_GUARD, removed, "removed existing tests"),
    assertion(EDIT_GUARD, edited, "changed existing tests", `${PUT_BACK} If only a change to an existing test would fix the problem, stop and say so.`),
    assertion(CHECK_GUARD, settings, "changed how the tests are run"),
    assertion(SKIP_GUARD, await addedSkips(worktreePath, base, tree, lists.skipMarkers, lists.testGlobs), "skipped tests"),
    assertion(BACKLOG_GUARD, (await addedBacklogItems(worktreePath, base, tree, resolving)).findings, "changed the backlog in a way it may not",
      "Existing backlog items may not be edited or removed; add a new item file for a follow-up, in the item format (see docs/project-configuration.md)."),
    ...(await ignoredAssertions(worktreePath, guards)),
    ...(on.includes("backlog-only")
      ? [assertion(BACKLOG_ONLY_GUARD, await notIdeas(worktreePath, base, tree), "changed something other than adding ideas to the backlog",
          "A review only adds ideas: new backlog item files with status: idea, a severity, and a check that finds the problem in the project as it stands. Put back every other change, and correct or remove an idea its check cannot find.")]
      : []),
  ];
  return all.filter((found) => judged(on, found.id));
}
