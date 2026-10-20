# Moving off lib/legacy-dates.js

`lib/legacy-dates.js` is deprecated. Every file that imports it moves to `format()` from
`lib/dates.js`, one file per change, with its output unchanged.

| Legacy call | Replacement |
|---|---|
| `formatDate(d)` | `format(d, "dd/MM/yyyy")` |
| `formatDateTime(d)` | `format(d, "dd/MM/yyyy HH:mm")` |

## Worked example

Before:

```js
import { formatDate } from "../lib/legacy-dates.js";
export const heading = (d) => `Orders for ${formatDate(d)}`;
```

After:

```js
import { format } from "../lib/dates.js";
export const heading = (d) => `Orders for ${format(d, "dd/MM/yyyy")}`;
```

Do not change what a file prints, and do not edit its tests to fit: if a test fails after the
change, the change is wrong. `lib/legacy-dates.js` itself is deleted only once nothing imports it.
