# Contributing

## Setup

```bash
git clone <repo-url>
cd delivery-service
npm install
```

## Development

```bash
npm test            # run tests once
npm run test:watch  # run tests in watch mode
npm run lint        # ESLint + TypeScript strict check
npm run typecheck   # TypeScript only
```

Some tests and demos drive the real Claude Agent SDK against `claude-mock`, a scripted fake
`claude` binary vendored in `vendor/claude-mock` (see `vendor/README.md`). `npm install`
provides it, so those tests always run, locally and in CI. Point a session at it with
`mockSessionEnvironment({ scriptPath, journalPath })` from `src/testing.ts`; never name the
`claude-mock` command or rely on `PATH`.

To prove a gate, a closer and role configurations work together, run one surface end to end
against `claude-mock` with `runSurfaceAgainstMock` from `src/testing.ts`, in a scratch
repository made with `initTempRepo`. It returns the run's result and the parsed journal:
`promptsSent(journal)` shows what the harness sent, and `assertFullyConsumed(journal, script)`
fails naming any expectation the run never used. Every agent session re-reads the whole
script, so give each expectation a `when` clause once a run makes more than one call.
Build each scripted envelope with `expectEnvelope(roleConfig, envelope)`, so a malformed one
fails where it is written rather than as an unexplained incomplete attempt; to script a
malformed reply on purpose, put it in the expectation's `json` directly.

To stand in for an agent in a test or demo, build the double with `fakeAgentPort` from
`src/testing.ts`, supplying a reply only for the roles the test exercises. Each reply is
type-checked against its role, and a role with no reply fails the test by name. Do not cast
to `AgentPort["invoke"]`: the linter rejects it, because the cast lets a reply of the wrong
shape compile.

## Pull requests

- Branch from `main`
- Tests must pass (`npm test`)
- Lint must pass (`npm run lint`)
- One concern per PR
- Code style is enforced by the linter, not by convention
