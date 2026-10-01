---
"delivery-service": minor
---

`delivery init` now offers to run tasks at the same time. When you list more than one thing to
do, it asks whether to work on some of them at once, says in a sentence that this costs more at
the same time and uses a working copy of your project for each, and suggests 2. Saying yes
writes `concurrency` into `delivery.config.json`; saying no, or pressing Enter, writes nothing,
so the list is still worked through one at a time. With one thing listed it does not ask.
After a yes it asks how many, offering 2: a number typed in its place is checked by the same
rule `delivery validate` uses, and asked for again if it is not a whole number of 1 or more.

`--concurrency` and `DELIVERY_CONCURRENCY` are now held to exactly the rule the config file's
`concurrency` is: a number too large to be an exact whole number is refused in the same words as
any other value that is not a whole number of 1 or more, instead of being accepted.
