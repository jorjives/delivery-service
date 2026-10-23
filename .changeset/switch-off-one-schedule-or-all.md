---
"delivery-service": minor
---

`delivery schedule disable --name <name>` turns off one schedule and leaves the others running. Without `--name` it still turns off only the default schedule. Its messages now name the schedule, and disabling one that is not there says it is already off.
