---
"delivery-service": minor
---

A `delivery.pack/3` pack may declare `settings`, each `text`, `path`, `paths` or `severity`, with a one-line `summary` and an optional `default`; a prompt uses one as `{{settings.<name>}}`. New published pack keys under `delivery.pack/3.settings`.

An act may take its hold from a `severity` setting with `holdSetting`, so the owner can change when its changes wait for sign-off; `hold` and `holdSetting` on one act are refused. New published pack key `delivery.pack/3.workflows.*.holdSetting`.

`delivery packs inspect --json` gains, per workflow, `holdSetting` (the setting its hold comes from, or null) and `holdKnown` (false when that setting is unset or its value was not read). The pack decision document embeds this account, so `delivery.pack-decision/1.account.workflows[].holdSetting` and `.holdKnown` are published there too.

`delivery.config.json` takes `packSettings`, keyed by pack name, for built-in, listed and added packs; values reach the pack's prompts when the project loads; a value with `{{`, `}}`, a line break or a hidden character is refused.

`delivery preview` prints a `Settings used:` line for a pack step, naming each value and whether it came from the pack's default or your configuration.

An unset required setting, a `packSettings` entry for a pack not in use, an undeclared setting or a wrong value refuses `run`, `review` and `validate` with exit 2, every problem at once; a `/3` pack is refused for a setting with no summary, a placeholder naming no declared setting, a setting no prompt uses, or more than 32 settings.

`delivery packs inspect --json` gains `settings` (each setting's name, type, summary, whether it is required, its default, the value in effect, its source and the workflows that use it) and, per step, `given` (the prompt as the agent would be given it) and `uses`.

`delivery packs inspect` shows a Settings section after the summary: each setting, the value in effect and its source, what it changes, and for an unset required setting the lines to add; the instructions show each value beside its placeholder. A faulty owner value for the inspected pack is refused, not shown.

`delivery packs inspect` says, for an act whose hold is a setting, the severities that wait for sign-off and whether the value is yours or the default, or why it cannot be known.

`delivery packs` marks a pack that needs a setting with a line under it, `needs setting: <name>`, and `delivery packs --json` gains `packs[].needs`, the required settings with no value. New published pack key `delivery.packs/1.packs[].needs`.

`delivery packs add` says, after an added pack, how many settings it needs and which, with the lines to add to `delivery.config.json` and the command to run next, when the pack needs a setting you have not given. `delivery packs add --json` gains `needs`, the same setting names, which is null when the add ends before the project's settings are read. New published key `delivery.pack-decision/1.needs`.

`delivery packs update` compares the settings of the two versions: `changes` gains `setting-added` (with `required`, `type` and `default`), `setting-removed`, `setting-default-changed` and `setting-type-changed`, each neutral. A hold that depends on a setting moves through the `hold` change, and is not reported as lifted while its setting is unset. New published keys `delivery.pack-decision/1.changes[].kind`, `.setting`, `.required`, `.type`, `.default`, `.from` and `.to`.

`delivery packs update` reports the settings the new version adds, removes or changes, and which settings still need a value. It says when every run will stop, and what to change, for a required setting with no value, a setting the configuration still names that the new version removed, or a value the new type no longer takes. It judges both versions with your values, so a default change that moves a hold shows the direction it moves sign-off. `delivery packs update --json` gains `needs`, and its `account` now carries your accepted values, so `settings[].source` reads `configuration`, `default` or `unset` rather than `not-read`, and `holdKnown` follows. New published key `delivery.pack-decision/1.needs`, set by update too.
