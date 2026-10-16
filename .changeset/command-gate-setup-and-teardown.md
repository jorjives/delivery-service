---
"delivery-service": minor
---

A written-out command gate can name `setup` and `teardown` commands. Setup runs before the check
and teardown after it, whatever the result. A setup that fails is reported as the check being
unable to run, not as the work failing. `delivery validate` and the agent's instructions both show
them.
