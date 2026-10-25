---
"delivery-service": minor
---

A `delivery.pack/3` pack may declare `settings`, each `text`, `path`, `paths` or `severity`, with a one-line `summary` and an optional `default`; a prompt uses one as `{{settings.<name>}}`. New published pack keys under `delivery.pack/3.settings`.

`delivery.config.json` takes `packSettings`, keyed by pack name, for built-in, listed and added packs; values reach the pack's prompts when the project loads; a value with `{{`, `}}`, a line break or a hidden character is refused.

`delivery preview` prints a `Settings used:` line for a pack step, naming each value and whether it came from the pack's default or your configuration.
