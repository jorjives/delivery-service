---
"delivery-service": minor
---

A `delivery.pack/3` pack may declare `settings`, each `text`, `path`, `paths` or `severity`, with a one-line `summary` and an optional `default`; a prompt uses one as `{{settings.<name>}}`. New published pack keys under `delivery.pack/3.settings`.

`delivery.config.json` takes `packSettings`, keyed by pack name, for built-in, listed and added packs; values reach the pack's prompts when the project loads; a value with `{{`, `}}`, a line break or a hidden character is refused.

`delivery preview` prints a `Settings used:` line for a pack step, naming each value and whether it came from the pack's default or your configuration.

An unset required setting, a `packSettings` entry for a pack not in use, an undeclared setting or a wrong value refuses `run`, `review` and `validate` with exit 2, every problem at once; a `/3` pack is refused for a setting with no summary, a placeholder naming no declared setting, a setting no prompt uses, or more than 32 settings.

`delivery packs inspect --json` gains `settings` (each setting's name, type, summary, whether it is required, its default, the value in effect, its source and the workflows that use it) and, per step, `given` (the prompt as the agent would be given it) and `uses`.

`delivery packs inspect` shows a Settings section after the summary: each setting, the value in effect and its source, what it changes, and for an unset required setting the lines to add; the instructions show each value beside its placeholder. A faulty owner value for the inspected pack is refused, not shown.
