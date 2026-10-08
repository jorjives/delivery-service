---
"delivery-service": minor
---

After a review's fix phase, `delivery report` opens with which review it was and one sentence
counting the problems found, approved and skipped, then how many are fixed and merged, waiting for
your sign-off and could not be fixed. Each problem is listed by its title and how serious it is,
under who must act: waiting for your sign-off (with what the risk was, what the agent changed, how
the check knows, and the commands to look, sign off or decline), needs you, stopped for your
engineers, done (each naming how it was checked) and skipped by you. It works the same from another
terminal while fixes are going, and after an interruption it says to carry on with `delivery fix`.
A task waiting on a repair of the shared setup is now said to be paused.
