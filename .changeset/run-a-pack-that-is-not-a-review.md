---
"delivery-service": minor
---

`delivery review <name>` now starts a pack your project lists under `packs` by its name, and a pack folder that is not listed is refused with a sentence naming the pack and how to list it.

`delivery review` starts the find of any pack, including a `delivery.pack/3` pack whose find is not called `scan`, with `--path` and `--preview` as before.
