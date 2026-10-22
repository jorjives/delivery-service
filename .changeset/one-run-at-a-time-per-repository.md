---
"delivery-service": minor
---

A second `delivery run`, `resume`, `sign-off` or `review` on a repository where a run is already going is now refused, even when that run works one task at a time. Before, only a run of several tasks at once held the repository, so two runs could take the same item and do its work twice. Every run now holds the repository from start to finish, so two runs never take the same item.
