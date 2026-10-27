---
"delivery-service": minor
---

The `open-pr` closer takes `"branch": "per-item"`. With `delivery run --sources`, each item then lands on its own branch and gets its own independent pull request from the base, instead of sharing one rolling pull request or a stack. It cannot be combined with `stack`.
