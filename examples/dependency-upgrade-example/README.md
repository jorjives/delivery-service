# Upgrade dependencies one at a time, and repair what breaks

Teams now pair a version-bump bot with an agent: Renovate or Dependabot opens the bump, CI runs,
and when the bump breaks something an agent reads the failure and the changelog and patches the
code ([Renovate with agentic workflows](https://itnext.io/github-agentic-workflows-and-renovate-02ba4c90c9f1),
[Dependabot alerts assignable to agents](https://github.blog/changelog/2026-04-07-dependabot-alerts-are-now-assignable-to-ai-agents-for-remediation)).
Here the harness does both halves.

| Piece | What it is |
|---|---|
| `scripts/outdated-source.mjs` | A `command` source: `list` runs `npm outdated` and prints one task per package with a newer version, its `package`, `from` and `to` in fields. The id names the version, so a later release is a new task |
| `bump` step | Installs the new version. `gates/upgraded.mjs` checks `package-lock.json` now installs exactly that version |
| `repair` step | Runs the tests and, if the upgrade broke anything, reads the changelog and fixes our code. `tests-unchanged` means it cannot make the upgrade pass by editing the tests |
| The gate's `setup` | `npm ci` before every check, because each task works in a fresh copy with no `node_modules` |
| `parkAfter: 1` | An upgrade that fails is set aside for you at once rather than tried again on every run |

`concurrency` is left at 1. The Renovate write-up found that parallel agents made conflicting
changes to the same files; one upgrade at a time keeps each lockfile change on top of the last.

## Try it

This needs the npm registry.

```bash
cp -r examples/dependency-upgrade-example ~/timeouts
cd ~/timeouts
git init -b main
git add -A
git commit -m "Start the timeouts"
node scripts/outdated-source.mjs list   # ms 2.0.0 to the latest
delivery run --sources --max 5
git log -p main..delivery/main
delivery schedule enable --every 1d     # and keep up from then on
```
