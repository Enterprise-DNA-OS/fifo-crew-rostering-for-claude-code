---
description: Everything that wants a decision, worst first: people on site not cleared, unlicensed labour hire, fatigue breaches, unsigned overrides, missing flights and rooms, crew gaps, missing timesheets, unbilled hours.
---

1. Run `npm run roster -- attention`.
2. It is ordered by what costs most if it is wrong. Read it in that order:
   - **On site now and labour hire.** Someone working today without a current site requirement, or a labour hire firm with no licence for a Queensland site. These stop work or end a contract.
   - **Gates and fatigue.** Credentials that lapse during a booked swing, shifts over the strictest fatigue limit, overrides nobody signed.
   - **Mobilisation.** Swings in the next 14 days with no flight in, no flight home or no camp room, and shifts nobody has confirmed.
   - **Crew.** Days a job is short of a trade.
   - **Timesheets.** Shifts with no hours, timesheets waiting on a supervisor.
   - **Money.** Approved hours not invoiced, employee hours not yet sent to payroll.
   - **Credentials.** Expiring in 30 days, and subcontractor insurance.
3. For each item give the one action and who owns it (crew coordinator, supervisor, travel, payroll, the worker).
4. Anything that needs an email or a message is drafted to `drafts/`, never sent.

If the operator asks "what should I do today", pick the top three and say why those three.
