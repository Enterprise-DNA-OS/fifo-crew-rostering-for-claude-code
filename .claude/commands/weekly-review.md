---
description: The Monday review, written from three commands: who is on site, what is not ready for the next changeover, the gaps, the hours and the money.
---

Run these three and write the review from what they return. Nothing they do not support goes in.

```
npm run roster -- swings --days=14
npm run roster -- attention
npm run roster -- hours --days=7
```

Then, no more than a page:

1. **The week in one line.** From `npm run roster -- stats`: people on shift, swings starting, people not cleared, gaps, timesheets waiting, hours not invoiced.
2. **Gates.** Anyone booked who is not cleared, with the day it bites. These lead the actions.
3. **Fatigue.** Every breach, with the rule it broke.
4. **Changeovers.** The next two changeover days and what is not booked for them.
5. **Crew.** Gaps by job and trade, and who can fill each (`npm run roster -- fill <job>`).
6. **Hours and money.** Planned against worked by job, timesheets waiting, approved hours to invoice.
7. **Five things to do this week**, picked from the attention list, with why each made it.
8. **One thing to decide.** The single item that needs a person, not a process.

`npm run view -- week`, `npm run view -- compliance` and `npm run view -- hours` render the same numbers as printable pages.
