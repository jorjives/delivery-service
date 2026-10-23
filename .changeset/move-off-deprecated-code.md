---
"delivery-service": minor
---

A built-in `deprecations` pack (`delivery review deprecations`) finds places that still use code your team has marked as replaced and moves each to the replacement; moves rated high or critical wait for sign-off; a move that changes a test to make itself pass is refused.

Because built-in packs load in every project, the names `deprecations`, `deprecations:scan`, `deprecations:code` and `deprecations:tests` are now reserved: a project that lists a pack named `deprecations`, or defines one of those workflows, is refused with a sentence saying what to rename.

A pack you list, or a workflow in your configuration, that takes the name of a pack that comes with the harness is now refused with a sentence naming that pack and what to rename; a listed pack named like a built-in is refused even when none of its workflow names overlap. An unknown pack name now lists the packs available and says to list a folder of your own under `packs`.
