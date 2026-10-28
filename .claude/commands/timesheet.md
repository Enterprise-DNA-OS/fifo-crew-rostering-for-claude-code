---
description: Enter a shift's hours: from a photo of a paper timesheet, a text from the supervisor, or a spreadsheet row. Flags anything over a fatigue limit.
---

1. Read the start, finish and break for each person and day. Never guess a time off a photo: if it is unclear, ask.
2. For each, run `npm run roster -- timesheet <worker> --date=<date> --start=06:00 --end=18:00 --break=30`. A night shift past midnight is fine.
3. If it says a fatigue limit was broken, say so and ask the operator for the reason, then note it with `/log`.
4. Timesheets go in as submitted. The supervisor approves with `/approve`.
