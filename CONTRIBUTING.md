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

Some tests drive the real Claude Agent SDK against `claude-mock`, a scripted fake `claude`
binary from a sibling project. It is not vendored here: install it with `npm link` from its
own checkout so `claude-mock` resolves on `PATH`. Without it those tests skip — they never
fail — and `npm test` still passes.

## Pull requests

- Branch from `main`
- Tests must pass (`npm test`)
- Lint must pass (`npm run lint`)
- One concern per PR
- Code style is enforced by the linter, not by convention
