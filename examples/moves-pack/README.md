# Move off old code: a delivery.pack/3 example

This is a `delivery.pack/3` pack with one find and two acts. The find looks for code marked `@deprecated` and its callers; the acts move one call site in code, and one test file's own calls, onto the new function. Copy this folder to start your own pack.

To prove it works, run `delivery packs check examples/moves-pack`. Then list the folder under `packs` in your `delivery.config.json`, and start it with `delivery review moves`.
