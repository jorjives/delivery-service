---
"delivery-service": minor
---

A project can choose how its work is checked by name in `delivery.config.json`, instead of writing
the check out: `{ "type": "test-runner" }` runs the project's tests, `{ "type": "file-exists",
"path": "CHANGES.md" }` checks a file is there, `{ "type": "command-succeeds", "command": "..." }`
checks a command succeeds, and `{ "type": "schema-validates", "file": "...", "schema": "..." }`
checks a JSON file against a JSON Schema. Each takes only the detail it needs and becomes exactly
the written-out command gate before a run starts, so a run's record is unchanged. `delivery
validate` describes the chosen check in plain words ("checks that CHANGES.md exists"), answers a
misspelt name with one line listing the four, and names a missing detail. Written-out gates work
as before.
