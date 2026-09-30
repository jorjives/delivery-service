# A library of text helpers with a shared check

This is a variant of `../project-configuration-example` that adds a shared check: the repository holds `check.mjs` and a helper file `shared/helper.json`, outside every task's copy. Every task's check reads the same helper file to know what command to run. When the helper goes missing, the shared environment is broken, and `delivery run` stops the run rather than each task repairing its own copy.

To see what happens when the shared environment breaks, follow [the shared-environment guide](../../docs/shared-environment.md).
