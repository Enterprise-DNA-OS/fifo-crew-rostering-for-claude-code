---
description: Approved employee hours not yet sent to payroll, as a CSV for your payroll system.
---

1. Run `npm run roster -- payroll [--to=<date>]` to see the totals by person.
2. On a yes, run it with `--save`. It writes `exports/payroll-<date>.csv` and marks those hours as sent, so they never go twice.
3. Labour hire and subcontractor hours are not in it: their firms invoice you. This never pays anyone.
