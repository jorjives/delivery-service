---
"delivery-service": minor
---

`delivery review` now runs its agent inside the write fence too, so the agent that reads your
project cannot change your main folder. It follows your `fence` setting: where the fence cannot
be had it says so first, and with `"fence": "required"` it will not start.
