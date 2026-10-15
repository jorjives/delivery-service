---
"delivery-service": minor
---

The agent now works inside a fence that keeps your main folder read-only, on Linux with
bubblewrap installed. Its own copy of the project and the repository's history stay writable, so
it can commit. Where the fence cannot be had, the run goes ahead and says first: "Your main folder
is not protected on this machine. Commit or save your work before the run starts." Set
`"fence": "required"` to refuse to run without it, or `"off"` to turn it off.
