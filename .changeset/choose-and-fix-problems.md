---
"delivery-service": minor
---

Choose which of a review's problems are fixed, and have them fixed. `delivery findings approve 1 3`
(or `--all`) and `delivery findings skip 2` record your choice, and `delivery findings` shows where
every problem stands. `delivery fix` then fixes each approved problem as its own task, in its own
copy: it passes only when the problem's own check passes and every test that passed before still
passes, and is then merged (or handled by your own closer). A problem whose code has already gone is
not worked on, and one the agent cannot fix is explained in plain words while the rest carry on.
Running it again never fixes a problem twice. With no `delivery.config.json` of your own, `validate`,
`preview`, `status` and `report` read the fix's generated configuration. Report data gains a `tags`
key per task, and every gate is now told its run's `baseBranch`.
