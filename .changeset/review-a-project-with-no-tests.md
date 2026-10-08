---
"delivery-service": minor
---

A review of a project with no tests now says so at the top: nothing will check that a fix has not
broken something else, and every fix will wait for your sign-off. A problem with a specific check
can still be approved; its level reads "this problem's own check only, no regression tests", and
its fix is checked by that check alone and then waits for your sign-off, whatever its severity and
on either review. A problem with no specific check is not offered: it reads "needs your decision;
cannot be checked", and `delivery findings approve --all` leaves it out.
`delivery findings approve <n> --allow-unchecked` approves it anyway, is recorded, warns that
nothing will check the fix except you, and its fix always waits. A review pack can set
`"requireCheck": true` to treat a problem with no check this way in any project.
`delivery fix` no longer refuses a project with no tests. `examples/no-tests-example` and
`npm run demo:packs-slice-6` show the whole case.
