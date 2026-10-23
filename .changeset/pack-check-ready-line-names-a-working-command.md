---
"delivery-service": patch
---

`delivery packs check` now ends on a command that works: a pack folder of your own is told to be listed under `packs` and started by name, and a built-in pack's folder is told its `delivery review <name>`. Before, a `delivery.pack/2` folder was told `delivery review ./<folder>`, which is refused unless the project lists it.
