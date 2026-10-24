---
"delivery-service": minor
---

`delivery packs inspect --json` prints the account as one document, `delivery.pack-inspection/1`, with the pack's fingerprint and its instructions exactly as written; a refusal is a document too, with `ok: false` and each problem. `--schema` prints its JSON Schema. Within version 1 a key may be added, and none is removed or changed. `--workflow <name>` shows one workflow in full; a name the pack does not have is refused, listing the workflows it has.
