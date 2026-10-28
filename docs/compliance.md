# Compliance: the rules this system checks

`/compliance` (or `npm run roster -- compliance`) checks the roster against the rules below and reports every breach with the rule and its source. It looks at shifts from 14 days back to 8 weeks ahead, so a credential that lapses mid-swing shows up the day the swing is booked, not the morning of the gate. The rules are written for a Western Australian contractor that also sends crews to Queensland, because that is where most FIFO mining work is. A contractor working under another state's law changes the sources here and the check in `scripts/roster.mjs` (`RULES` and `complianceRows`) together.

This is a records check. It finds what the records say. It is not legal or safety advice, and it does not replace your safety management system, your fatigue management plan, your safety adviser or the client's contractor management plan. Confirm each rule against the current version of its source before you rely on it.

| Rule | What a breach looks like in the data | Source |
|---|---|---|
| R1 Site requirements met | A booked shift where the worker has no record, or an expired one, of something the client or the site requires (site induction, medical, VOC, ticket, licence) on that day | The client's and the site's access standards, recorded in `requirements`; Work Health and Safety Act 2020 (WA) s 19 and Work Health and Safety Act 2011 (Qld) s 19, the duty to provide the information, training and instruction needed to work safely |
| R2 High risk work licence | A booked shift in a role that needs a high risk work licence (rigging, dogging, elevating work platform) where the licence is missing or has expired | Work Health and Safety (General) Regulations 2022 (WA) r 81 and Work Health and Safety Regulation 2011 (Qld) s 81: a person must not carry out high risk work without the licence for that class |
| R3 Shift length | A shift, planned or worked, longer than the strictest limit that applies to it | Your fatigue management plan and the client's or site's; the Code of Practice: Working Hours (WA Commission for Occupational Safety and Health, 2006) |
| R4 Rest between shifts | Less than the minimum rest between the end of one shift and the start of the next, counted across every job and site | As R3 |
| R5 Days in a row | More consecutive shifts than the limit, counted across every job and site | As R3 |
| R6 Hours in 14 days | More hours in any 14 days than the limit, counted across every job and site | As R3 |
| R7 Hours recorded | A rostered shift more than a day old with no timesheet | Fair Work Act 2009 (Cth) s 535 and Fair Work Regulations 2009 (Cth) reg 3.33: employee records, including hours worked, are made and kept for seven years |
| R8 Queensland labour hire licence | A labour hire worker booked on a Queensland site whose firm has no Queensland labour hire licence recorded | Labour Hire Licensing Act 2017 (Qld) s 11: a person must not enter into an arrangement with an unlicensed provider for the supply of workers |
| R9 Overrides signed | An override of any gate with no reason or no name on it | Your own audit trail; most clients' contractor management plans ask for it |

## How the fatigue limits work

Limits live in `fatigue_policies` at three levels: the business (your fatigue management plan), the client, and the site. For every shift the strictest number that applies wins: the shortest shift limit, the longest minimum rest, the fewest days in a row, the fewest hours in 14 days. Hours are counted across every job, so a fitter who finishes a shutdown on Tuesday and starts on a mill on Wednesday is counted as one run. A shift's hours are its timesheet when there is one, and its planned hours when there is not.

Change a limit by asking: "Bowen Range North is going to 11.5 hour shifts from 1 December". `/customise` updates the row and the check picks it up.

## Why each one matters

- **R1 and R2.** The client's gate stops anyone without a current induction, medical or ticket. Finding out at the gate costs a flight, a day's work and the client's patience. Finding out mid-swing is worse: the person stands down on site.
- **R3 to R6.** Fatigue is a hazard your safety management system must manage, and most clients set their own numbers on top. The roster already knows the hours; this check reads them before the shift, not after the incident.
- **R7.** Hours not recorded cannot be paid correctly, invoiced, or shown to the Fair Work Ombudsman.
- **R8.** Using an unlicensed labour hire firm for Queensland work is an offence for the business that uses it, not only the firm.
- **R9.** An override is a decision someone made. A client's auditor asks who made it and why.

## Not checked here

- Payroll, awards and leave. Approved hours export to your payroll system, which does the pay.
- Drug and alcohol testing results, and health monitoring. Record the date as a credential if your client requires one.
- Site access cards and the client's own contractor portal. Those stay in the client's system.
