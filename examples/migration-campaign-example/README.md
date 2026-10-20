# A migration campaign, one file at a time

Large migrations are where teams report the biggest wins from agents, and they all share a
shape: list every file that needs the change, migrate each one separately through fixed steps,
check each one automatically, retry the ones that fail, and hand the stubborn remainder to a
person.

- Anthropic ([best practices](https://code.claude.com/docs/en/best-practices)): have Claude list
  the files, then loop `claude -p` over them, one file per session.
- Airbnb ([Enzyme to React Testing Library](https://www.infoq.com/news/2025/03/airbnb-llm-test-migration/)):
  each file goes through ordered steps (convert, fix the tests, fix lint, fix types), each tracked
  so it can be retried, hundreds at a time. Retrying beat prompt tuning.
- Google ([Migrating code at scale with LLMs](https://arxiv.org/abs/2504.09691)): every change
  must build and pass its tests; the ones that cannot go to people.
- Nubank with Devin ([customers](https://devin.ai/customers)): a playbook written from earlier
  hand-done migrations guides every session.

Here the project is moving from `lib/legacy-dates.js` to `format()` in `lib/dates.js`, and
`docs/MIGRATION.md` is the playbook.

| Piece | What it is |
|---|---|
| `scripts/migration-source.mjs` | A `command` source: `list` prints one task per file that still imports the legacy module, with the file in a `file` field. A migrated file stops being listed |
| `migrate-file` workflow | Airbnb's steps. `convert`, checked by `gates/file-migrated.mjs` (the named file no longer imports the legacy module, and no other file started to); then `tests` and `lint`, each in the same session, each with its own check |
| `concurrency: 3` | Three files at a time, each in its own working copy |
| `parkAfter: 2` | A file that fails twice is set aside for a person, not retried forever |
| `commit-to-branch` | Every migrated file lands on one branch, `delivery/main`, for you to review as one change. Use `open-pr` to have it opened as a pull request |

## Try it

```bash
cp -r examples/migration-campaign-example ~/shop-reports
cd ~/shop-reports
git init -b main
git add -A
git commit -m "Start the reports"
node scripts/migration-source.mjs list   # the four files still to move
delivery run --sources --max 1           # try the playbook on one file first
git diff main delivery/main              # read it; improve docs/MIGRATION.md if needed
delivery run --sources --max 10          # then the rest, three at a time
delivery report                          # what landed, and what is parked for you
```

`tests-unchanged` on the `tests` step means a session cannot make a failing test pass by
editing it: the playbook says the file is wrong, not the test, and the harness holds it to that.
