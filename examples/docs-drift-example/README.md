# Keep the docs in step with the code

A common Claude Code automation
([GitHub Actions](https://code.claude.com/docs/en/github-actions), and many write-ups of the
same pattern): when a change lands, or once a night, an agent reads what changed, compares it with
the docs, and either corrects the docs or says nothing needs to change. A person reviews the docs
change.

The library is three string helpers. Its documentation, `docs/API.md`, has drifted: it documents
a function that has gone, misses one that was added, and gives a wrong example. Docs written in
prose cannot be checked, so this project writes its examples as `call // => value`, and
`scripts/check-docs.mjs` runs them:

- every exported function has a `### name(...)` section, and every section names a real one;
- every example gives the value it claims;
- with `--only-docs`, nothing but `docs/API.md` (and new follow-up items) changed.

Two things keep the docs current:

| Piece | When it runs |
|---|---|
| `after`: "check the docs" | Once per run, after any other work lands: an agent pass runs the check and, if it fails, adds a `sync-docs` follow-up item. Its own changes are thrown away; only the follow-up is kept |
| `20261020T080000Z-sync-docs.md` | A recurring item (`cadence: 1d`) that runs the `sync-docs` workflow every day, as a safety net. Its `after` is empty, so a docs sync does not trigger a docs check of its own |

## Try it

```bash
cp -r examples/docs-drift-example ~/string-kit
cd ~/string-kit
git init -b main
git add -A
git commit -m "Start the string kit"
node scripts/check-docs.mjs      # three problems
delivery run --sources           # the sync item corrects docs/API.md
node scripts/check-docs.mjs      # none
delivery schedule enable --every 1d
```

The agent is told to describe what the code does. If the code looks wrong, it adds a follow-up
item rather than changing the code to match the docs.
