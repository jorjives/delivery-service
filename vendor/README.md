# Vendored projects

## claude-mock

`claude-mock/` is the estate's scripted fake `claude` CLI, copied **unchanged** from its
sibling project so that a plain `npm install` provides it. The sibling project is
`"private": true` and published nowhere, so there is nothing to install it from otherwise.

- **Upstream commit:** `8dea7997178ffb6eab79eb291a10e335e3f317a6`
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
