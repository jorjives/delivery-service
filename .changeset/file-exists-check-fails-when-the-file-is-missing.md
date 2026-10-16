---
"delivery-service": minor
---

The ready-made `file-exists` check now fails when the file is still missing after the work. Before,
a file that was missing before the work started could stay missing and the check still passed. A
written-out command gate can ask for the same with `"checkOnly": true`.
