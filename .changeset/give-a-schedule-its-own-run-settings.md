---
"delivery-service": minor
---

A schedule can now run with settings of its own: `delivery schedule enable` takes `--config`, `--workflow`, `--max` and `--concurrency`, and each scheduled run uses them, so one project can run a quick pass and a thorough pass. `delivery schedule status` shows each schedule's run settings. Enabling a schedule again replaces its whole definition, so a setting left out is dropped rather than kept. `delivery run --sources --workflow <name>` now names the workflow for items that name none.
