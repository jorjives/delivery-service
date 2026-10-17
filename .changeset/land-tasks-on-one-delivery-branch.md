---
"delivery-service": minor
---

`delivery run --sources` lands every item it delivers on one branch, `delivery/main` (named after your base branch), each built on the work landed before it. An item that finishes after another is rebuilt on top of it and checked again before it lands, and one that conflicts gets a fresh attempt from the latest work. Your closer then takes that branch once per run, so you review and merge one branch, or one pull request, instead of one per item. Commits you make to your base branch are brought into the delivery branch at the start of the next run when that is clean and your check passes; when it is not, the run starts no task and says what is in the way. The `merge-back` closer can now land on a base branch that no checkout has open.
