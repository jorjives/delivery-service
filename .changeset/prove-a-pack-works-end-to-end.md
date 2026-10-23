---
"delivery-service": minor
---

`delivery packs check` now runs a `delivery.pack/3` pack end to end: its find, the approval of every idea it writes, and each act workflow, reporting each in the pack's own workflow names. A pack with an act workflow that no scripted idea reaches fails, naming it; this also catches a `delivery.pack/2` pack whose ideas name another pack's `fix`. The JSON result's `run` gains `find` and `workflowOf`. `delivery.pack/2` output is otherwise unchanged, but its ready line, `Ready to use: delivery review ./my-pack`, names a folder that `delivery review` refuses unless the project lists it under `packs`; that wording is for the next pass over the check's words. `examples/moves-pack` is a `delivery.pack/3` pack to copy.
