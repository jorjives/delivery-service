---
"delivery-service": minor
---

`delivery status` reads a run of several tasks at once by the id it opened with (`run-…`): when
it started and its shape, whether the environment the tasks share is healthy, how many tasks are
done, need your decision, stopped or are queued, then one line per task in list order naming its
own run id, with the
decision a stuck task needs set out in full beneath it. A task waiting only because every slot is
busy shows as "queued, waiting for a free slot". Each task is still read on its own by its own
run id, exactly as before.

With `--json` it prints the whole run as one document, nesting each task's usual status document
under `surfaces` and listing the tasks still to start under `queued`; every key is always
present, `null` where it does not apply.
