import { cleanGitEnv } from "./src/git-env.js";

// Git exports GIT_DIR and friends to hooks, and this repo's pre-push hook runs the
// tests. Any test that spawns git without `cleanGitEnv()` would then act on the
// repository being pushed rather than its own scratch one, so every worker starts
// with them removed, the same environment CI gives it.
const kept = cleanGitEnv();
for (const key of Object.keys(process.env)) {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- process.env must be edited in place; children read it
  if (!(key in kept)) delete process.env[key];
}
