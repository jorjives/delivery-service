---
"delivery-service": patch
---

`delivery schedule enable` no longer overwrites another project's schedule whose timer name it would share, such as `/work/app`'s `nightly` and `/work/app.nightly`'s default. It refuses, names the other project, and changes nothing.
