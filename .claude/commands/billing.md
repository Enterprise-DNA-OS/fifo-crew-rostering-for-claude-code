---
description: Approved hours not yet invoiced, by job, with the value at each client's rate by trade.
---

1. Run `npm run roster -- billing [--job=<job>]`.
2. Lead with the oldest. When the operator has raised the invoice in their accounting system, run `npm run roster -- invoiced <job> --to=<last day> --ref=<invoice number>` so the same hours are never invoiced twice.
3. A trade with no rate shows as no rate: ask for the rate and add it with `/customise`.
