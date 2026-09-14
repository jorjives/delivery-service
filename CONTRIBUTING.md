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
