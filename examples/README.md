# Examples

Each folder is a small project you copy out, make a git repository, and run `delivery` in. Its
README says how.

## Getting started

| Example | What it shows |
|---|---|
| [sample-project](sample-project/) | The first run, with no configuration file |
| [project-configuration-example](project-configuration-example/) | A whole project set up in `delivery.config.json` |
| [shared-environment-example](shared-environment-example/) | Several tasks at once, sharing a check that breaks |
| [code-review-example](code-review-example/) | A code review and a security review finding planted problems |
| [no-tests-example](no-tests-example/) | A review of a project with no tests |

## Ways of working with agents

Each of these turns a workflow that practitioners describe into a project configuration. The
README of each names who describes it and where.

| Example | Workflow | Who describes it |
|---|---|---|
| [plan-then-build-example](plan-then-build-example/) | Explore, plan, build, then a fresh session reviews; and a throwaway scouting run | Anthropic, Jesse Vincent, Mitchell Hashimoto, Simon Willison |
| [test-first-example](test-first-example/) | Red, green, refactor, with the test and the code written by different sessions | Kent Beck, Anthropic |
| [spec-to-backlog-example](spec-to-backlog-example/) | A spec planned into a todo list, worked one item per fresh session, in a loop | Harper Reed, Addy Osmani, Geoffrey Huntley |
| [research-notebook-example](research-notebook-example/) | Questions answered by code, several at once, each on its own branch | Simon Willison, Anthropic |
| [compound-engineering-example](compound-engineering-example/) | Plan, work, review, then write the lesson down for the next agent | Every, Boris Cherny |
| [migration-campaign-example](migration-campaign-example/) | A migration listed file by file and worked through fixed steps, three at a time | Anthropic, Airbnb, Google, Nubank |
| [flaky-test-example](flaky-test-example/) | Fix a flaky test so it stays fixed, record the pattern, find it elsewhere | Intercom |
| [docs-drift-example](docs-drift-example/) | Keep the docs in step with the code, after each landing and daily | Claude Code GitHub Actions users |
| [ad-copy-example](ad-copy-example/) | Rewrite underperforming ads within the platform's limits | Anthropic growth marketing |
| [issue-to-pr-example](issue-to-pr-example/) | A labelled issue reproduced in a test, fixed, and opened as a pull request | GitHub Copilot coding agent |
| [dependency-upgrade-example](dependency-upgrade-example/) | Upgrade dependencies one at a time and repair what breaks | Renovate and Dependabot users |

`tests/workflow-examples.test.ts` runs each of these against a scripted agent, so they keep
working as the harness changes.
