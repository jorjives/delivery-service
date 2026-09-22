# Contributing

## Setup

```bash
git clone <repo-url>
cd delivery-service
npm install
```

## Development

```bash
npm run build       # compile src/ into dist/, including the `delivery` command
npm test            # lint, build, then run tests once
npm run test:watch  # run tests in watch mode (run `npm run build` first)
npm run lint        # ESLint + TypeScript strict check
npm run typecheck   # TypeScript only
```

`npm test` lints first, so green means lint and tests together, the same as `make verify`
and CI. It builds before running the tests because some tests run the compiled `delivery`
command the way a person would, through `runDelivery` in `tests/helpers.ts`. When you run vitest directly or in
watch mode, run `npm run build` first, and again after changing `src/`.

To run the command from a checkout, build and link it, which puts `delivery` on your `PATH`:

```bash
npm run build
npm link
delivery --help
```

or run it straight from source with `npx tsx src/cli/main.ts --help`.

Some tests and demos drive the real Claude Agent SDK against `claude-mock`, a scripted fake
`claude` binary vendored in `vendor/claude-mock` (see `vendor/README.md`). `npm install`
provides it, so those tests always run, locally and in CI. Point a session at it with
`mockSessionEnvironment({ scriptPath, journalPath })` from `src/testing.ts`; never name the
`claude-mock` command or rely on `PATH`.

To run the `delivery` command itself against `claude-mock`, set `DELIVERY_TEST_MOCK_SCRIPT` to
the path of a script written with `writeMockScript` from `src/testing.ts`. Every agent session in
the run then goes to `claude-mock`, the sign-in check is skipped, and the journal is written next
to the script as `<script>.journal.jsonl`:

```bash
DELIVERY_TEST_MOCK_SCRIPT=/tmp/scratch/mock.json delivery run --task "add a hello function"
```

This seam is for contributors only: it needs the dev dependency, so an installed copy refuses
it with a plain message, and it is deliberately left out of `--help`. `src/cli/run-command.test.ts`
drives the command in-process this way; `runDelivery` in `tests/helpers.ts` drives the compiled
binary.

To prove a gate, a closer and role configurations work together, run one surface end to end
against `claude-mock` with `runSurfaceAgainstMock` from `src/testing.ts`, in a scratch
repository made with `initTempRepo`. It returns the run's result and the parsed journal:
`promptsSent(journal)` shows what the harness sent, and `assertFullyConsumed(journal, script)`
fails naming any expectation the run never used. Every agent session re-reads the whole
script, so give each expectation a `when` clause once a run makes more than one call.
Build each scripted envelope with `expectEnvelope(roleConfig, envelope)`, so a malformed one
fails where it is written rather than as an unexplained incomplete attempt; to script a
malformed reply on purpose, put it in the expectation's `json` directly.
`docs/testing-your-pipeline.md` teaches the same API to adopters, and
`tests/testing-your-pipeline-guide.test.ts` runs its worked tests: change the guide with the
testing API.

`docs/getting-started.md` and `docs/project-configuration.md` are run the same way, by
`tests/getting-started-guide.test.ts` and `tests/project-configuration-guide.test.ts`, against
the example projects in `examples/`: a change to what a command prints changes those guides in
the same commit. Leave `examples/sample-project/` without a configuration file; it is the
no-configuration first run.

To stand in for an agent in a test or demo, build the double with `fakeAgentPort` from
`src/testing.ts`, supplying a reply only for the roles the test exercises. Each reply is
type-checked against its role, and a role with no reply fails the test by name. Do not cast
to `AgentPort["invoke"]`: the linter rejects it, because the cast lets a reply of the wrong
shape compile.

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

## Pull requests

- Branch from `main`
- `npm test` must pass (it runs lint as well as the tests)
- One concern per PR
- A changeset describes anything a user would notice (`npx changeset`)
- Code style is enforced by the linter, not by convention
