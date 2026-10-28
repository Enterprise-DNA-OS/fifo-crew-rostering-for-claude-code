---
description: Check the roster against the nine rules in docs/compliance.md (site requirements, high risk work licences, four fatigue limits, hours records, Queensland labour hire licences, signed overrides) and report every breach with its source.
---

1. Run `npm run roster -- compliance`. Read `docs/compliance.md` for what each rule means and where it comes from.
2. Report as a table: rule, count, the worst example (name and date), the source. Breached on site now first, then breaches in the next 14 days, then the rest, then clean rules.
3. For anything breached, draft the fix the operator can approve: the credential to renew (`/draft-credential-reminder`), the person to swap (`/fill`), the day off to put in (`/fatigue`), the licence to ask for. Drafts go to `drafts/`, never sent.
4. If a rule in `docs/compliance.md` is out of date, say so and stop. Do not guess at law. The operator confirms the rule, then you update the doc and the check in `scripts/roster.mjs` (`RULES` and `complianceRows`) together.

Nothing here is legal advice. The doc records the rules the operator has told the system to enforce, with sources, and this command checks the data against them.
