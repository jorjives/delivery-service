---
"delivery-service": minor
---

A pack may now be written in `delivery.pack/3`, naming its own workflows: one find, which adds ideas to the backlog, and any number of act workflows, each with its own instructions, extra guards and hold. Mistakes in such a pack are named by file and field. `delivery packs` now also lists the packs your project lists under `packs`. `delivery.pack/2` packs, including the built-in `code` and `security`, keep working with no edit, with the same workflow names. `delivery packs --schema` prints the `delivery.pack/3` schema, and `PACK_SCHEMA` is now `delivery.pack/3`; `PACK_SCHEMAS_READ` lists both versions read.
