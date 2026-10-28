---
description: A supervisor approves timesheets, for one person or a whole job. The name goes on every timesheet.
---

1. Run `npm run roster -- approve <worker> [--date=<date>] --by="<name>"` or `npm run roster -- approve --job=<job> --by="<name>"`.
2. To send one back: `npm run roster -- reject <worker> --date=<date> --reason=".."`.
3. Confirm the count and the hours.
