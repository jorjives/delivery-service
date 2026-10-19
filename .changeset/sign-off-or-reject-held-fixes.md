---
"delivery-service": minor
---

`delivery sign-off <item>` lands a serious fix that waits for your sign-off: it is checked again where it lands, then handed to your closer as a run would. `delivery reject <item>` sets it aside: nothing is landed, and its work stays on its branch. Each refuses an item that is not waiting for your sign-off.
