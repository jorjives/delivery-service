---
"delivery-service": minor
---

`delivery review <name>` now starts a pack your project lists under `packs` by its name, and a pack folder that is not listed is refused with a sentence naming the pack and how to list it.

`delivery review` starts the find of any pack, including a `delivery.pack/3` pack whose find is not called `scan`, with `--path` and `--preview` as before.

A `delivery.pack/3` pack's find now speaks in the pack's own title and summary: it names the pack when it starts, says plainly when it found nothing (the agent's reading of the project, not a guarantee), and says when there may be more ideas than it was asked to write. `delivery.pack/2` output is unchanged.
