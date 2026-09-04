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

## Pull requests

- Branch from `main`
- Tests must pass (`npm test`)
- Lint must pass (`npm run lint`)
- One concern per PR
- Code style is enforced by the linter, not by convention
