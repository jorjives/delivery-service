---
"delivery-service": patch
---

A pack whose instruction file is not valid UTF-8 is now refused, naming the file, rather than showing replacement characters that differ from what the agent is given. A pack that names a folder where a file belongs is refused the same way, instead of stopping with an error.
