# Vendored projects

## claude-mock

`claude-mock/` is the estate's scripted fake `claude` CLI, copied from its
sibling project, unchanged except for the local change recorded below, so that a plain `npm install` provides it. The sibling project is
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

The vendored TypeScript is not linted by this repository and is not part of its
`tsconfig.json` include (`eslint.config.js`, `tests/typecheck-coverage.test.ts`); it belongs
to its own project. One file is compiled here indirectly: `src/mock-script.test.ts` imports
the script types from `vendor/claude-mock/src/mock.ts` to prove `src/mock-script.ts` mirrors
them.

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

`src/mock-script.ts` mirrors the script and journal formats as plain types. After a sync,
`npm run lint` fails if the script types drifted; the journal events are written ad hoc in
`src/cli.ts`, so compare its `journal({...})` calls against `JournalEvent` by eye.

Then update the upstream commit above. `npm ci` (not `npm install`) is what refreshes the
copy in `node_modules`, because the package version does not change between syncs.

### Local change ahead of upstream

`costUsd` and `durationMs` on an expectation (`src/mock.ts`, `src/cli.ts`, `test/sdk.test.ts`,
and the rebuilt `dist/`) were added here for the harness's time-and-cost reporting, and are not
yet in the sibling project. Port them upstream, then re-vendor as above and update the upstream
commit; until then a re-vendor would drop them, and `src/mock-script.test.ts` would fail to compile.

### Licence

claude-mock has no licence field and this repository has no `LICENSE` yet. Both projects
share one author, so vendoring raises no third-party rights question. The copy inherits
whatever licence this repository adopts; licensing it for redistribution is a decision to
make explicitly if the harness is open-sourced.
