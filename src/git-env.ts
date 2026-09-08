/**
 * `cwd` alone is not enough to pin a spawned `git` process to a given
 * repository: any inherited `GIT_*` environment variable (`GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, ...) overrides repository discovery
 * regardless of `cwd`. Git itself sets these when invoking hooks — so a
 * `git`-spawning helper that only passes `cwd` silently targets the wrong
 * repository the moment it runs inside a hook (e.g. this repo's own
 * `pre-push`, which runs the test suite). Every `execFile`/`execFileSync`
 * call that means "operate on this `cwd`, not on whatever repo the parent
 * process is in" must pass this as its `env`.
 */
export function cleanGitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}
