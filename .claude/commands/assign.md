---
description: Book someone onto a job on a swing pattern. The gates run first: credentials, the labour hire licence, double booking and the consecutive shift limit.
---

1. Confirm the person, the job, the swing pattern (2/1, 8/6, 14/14, SD10 for a shutdown), the first day, and the end or number of weeks.
2. Run `npm run roster -- assign <worker> <job> --swing=<pattern> --start=<date> [--end=<date>] [--panel=<A>] [--night] --by="<who is booking>"`.
3. If it is refused, show why. Do not override on your own. Only when the operator gives a reason and a name, run it again with `--override="<reason>" --by="<name>"`. Every override goes on the audit trail.
4. Then book travel: `/flight` and `/room` for the new swings.
