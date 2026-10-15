import { chmod, mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git-exec.js";
import { LANDING_BOUNDARY } from "./prompt-assembly.js";
import { stateHome } from "./run-location.js";

/**
 * Every hook git runs from a hooks folder (githooks(5)), except fsmonitor-watchman, which git runs only when
 * configured to, and proc-receive, which speaks a protocol. Pointing core.hooksPath at the harness's folder
 * replaces the project's, so each one chains back to the project's own.
 */
const HOOKS = [
  "applypatch-msg", "pre-applypatch", "post-applypatch", "pre-commit", "pre-merge-commit", "prepare-commit-msg", "commit-msg",
  "post-commit", "pre-rebase", "post-checkout", "post-merge", "pre-push", "pre-receive", "update", "post-receive", "post-update",
  "reference-transaction", "push-to-checkout", "pre-auto-gc", "post-rewrite", "sendemail-validate", "post-index-change",
] as const;

/** The hooks git gives input on standard input: read once, checked, and handed on to the project's own. */
const READS_INPUT = new Set<string>(["pre-push", "pre-receive", "post-receive", "reference-transaction", "post-rewrite"]);

const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
const REFUSE = `echo ${quoted(LANDING_BOUNDARY)} >&2; exit 1`;

/** The harness's own check in a hook: pre-push refuses every push; reference-transaction refuses any branch but the task's, and every tag. */
function ownCheck(hook: string, branch: string | null): string {
  if (hook === "pre-push") return `${REFUSE}\n`;
  if (hook !== "reference-transaction") return "";
  const own = branch === null ? "" : `    ${quoted(`refs/heads/${branch}`)}) ;;\n`;
  return (
    'if [ "$1" = prepared ]; then\n' +
    '  while read -r _old _new ref; do\n' +
    '    case "$ref" in\n' +
    own +
    `    refs/heads/*|refs/tags/*) ${REFUSE} ;;\n` +
    "    esac\n" +
    '  done < "$input"\n' +
    "fi\n"
  );
}

/** One hook: the harness's check, then the project's own hook of the same name, if it has one. */
function hookScript(hook: string, branch: string | null, project: string): string {
  const where =
    `project=${quoted(project)}\n` +
    // A relative core.hooksPath is relative to the working copy the hook runs in, as git itself reads it.
    'case "$project" in /*) ;; *) project="$(git rev-parse --show-toplevel)/$project" ;; esac\n';
  const head = `#!/bin/sh\n# Written by delivery for one run: where the agent's work ends, then the project's own hook.\n${where}`;
  if (!READS_INPUT.has(hook)) return `${head}if [ -x "$project/${hook}" ]; then exec "$project/${hook}" "$@"; fi\nexit 0\n`;
  return (
    `${head}input=$(mktemp) || exit 1\ntrap 'rm -f "$input"' EXIT\ncat > "$input"\n${ownCheck(hook, branch)}` +
    `if [ -x "$project/${hook}" ]; then "$project/${hook}" "$@" < "$input"; exit $?; fi\nexit 0\n`
  );
}

/** Where the project's own hooks are: its core.hooksPath as written, else the shared git folder's hooks. */
async function projectHooks(repoPath: string): Promise<string> {
  try {
    return await git(repoPath, ["config", "--type=path", "--get", "core.hooksPath"]);
  } catch {
    return join(await git(repoPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "hooks");
  }
}

/** Write the run's hooks folder. `branch` is the one branch the session may move; null for a detached copy, which may move none. */
export async function writeLandingHooks(repoPath: string, hooksDir: string, branch: string | null): Promise<void> {
  const project = await projectHooks(repoPath);
  await mkdir(hooksDir, { recursive: true });
  for (const hook of HOOKS) {
    const file = join(hooksDir, hook);
    await writeFile(file, hookScript(hook, branch, project));
    await chmod(file, 0o755);
  }
}

/**
 * The repository every refused push goes to. A real bare repository, because git connects to a remote before it
 * runs a client-side hook: it must exist to be reached, and its own `pre-receive` hook (git's local transport clears
 * `GIT_CONFIG_*`, so the harness's `core.hooksPath` does not reach it) then says the sentence and refuses, which
 * `--no-verify` cannot skip. Under the state folder, outside the fenced main checkout, because `receive-pack` writes
 * a quarantine into it before the hook runs. One for the machine, made idempotently, so concurrent runs share it.
 * ponytail: a state folder configured inside the main checkout is read-only under the fence; a push then fails with git's own error.
 */
export async function refusingRemote(env: NodeJS.ProcessEnv): Promise<string> {
  // The same folder the worktrees (`run-location.ts`) and the fence wrappers (`fence.ts`) live under.
  const root = join(stateHome(env), "delivery-service");
  const repo = join(root, "landing-refused.git");
  await mkdir(root, { recursive: true });
  await git(root, ["init", "--bare", "-q", "--", repo]);
  const hook = join(repo, "hooks", "pre-receive");
  const staged = `${hook}.${process.pid}`;
  await writeFile(staged, `#!/bin/sh\n# Written by delivery: nothing is ever pushed anywhere from an agent's session.\ncat > /dev/null\n${REFUSE}\n`);
  await chmod(staged, 0o755);
  await rename(staged, hook);
  return repo;
}

/**
 * The session's git settings: its hooks folder, and every named remote's push address replaced by the refusing
 * repository (which `--no-verify` cannot skip), written to a file beside the hooks. The environment includes that
 * file only for the project's own git folder and its linked worktrees' folders (`includeIf.gitdir:`), because
 * `GIT_CONFIG_*` reaches every process the session starts: any other repository it touches (a test suite's temp
 * repository, a clone) keeps its own hooks, branches and pushes. Added after any `GIT_CONFIG_*` settings already in
 * `base`. Only the session's own processes carry them: the operator's git, and every closer, are untouched.
 * ponytail: a remote added during the session, or an address typed out, has no refusing push address; the pre-push hook refuses it unless the push skips hooks.
 */
export async function landingEnv(repoPath: string, hooksDir: string, refusing: string, base: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  const file = join(hooksDir, "landing.gitconfig");
  // git writes the file, so a path or remote name needs no quoting of ours.
  await git(hooksDir, ["config", "--file", file, "core.hooksPath", hooksDir]);
  for (const remote of (await git(repoPath, ["remote"])).split("\n").filter(Boolean)) {
    await git(hooksDir, ["config", "--file", file, `remote.${remote}.pushurl`, refusing]);
  }
  // git matches includeIf.gitdir against the git folder and its real path; the pattern is a wildmatch glob.
  const common = (await realpath(await git(repoPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))).replace(/[[\]*?\\]/g, "\\$&");
  const settings: [string, string][] = [
    [`includeIf.gitdir:${common}.path`, file], // the main checkout
    [`includeIf.gitdir:${common}/worktrees/*.path`, file], // its linked worktrees; `*` does not cross `/`
  ];
  const from = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(from + settings.length) };
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${from + index}`] = key;
    env[`GIT_CONFIG_VALUE_${from + index}`] = value;
  });
  return env;
}

/** The landing boundary for one session: its hooks written, and the environment that points git at them. */
export async function landingBoundary({ repoPath, hooksDir, branch, base, env }: { repoPath: string; hooksDir: string; branch: string | null; base: NodeJS.ProcessEnv; env: NodeJS.ProcessEnv }): Promise<Record<string, string>> {
  await writeLandingHooks(repoPath, hooksDir, branch);
  return landingEnv(repoPath, hooksDir, await refusingRemote(env), base);
}
