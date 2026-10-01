---
"delivery-service": minor
---

`--concurrency` and `DELIVERY_CONCURRENCY` are now held to exactly the rule the config file's
`concurrency` is: a number too large to be an exact whole number is refused in the same words as
any other value that is not a whole number of 1 or more, instead of being accepted.
