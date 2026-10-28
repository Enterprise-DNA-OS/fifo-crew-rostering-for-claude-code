# Moving off Humanz

A day or two for one office person, done in this order. Keep Humanz running until one full swing has been rostered, travelled and timesheeted out of this system.

## 1. Set up what Humanz holds as settings

These are short lists, quicker to enter by asking Claude Code than to export:

- **Clients and sites.** Each site's state, whether crews fly, drive or bus in, the airstrip, the camp, and day and night start times.
- **What each client and site requires.** Inductions, medicals, VOCs, tickets and licences, recorded once per client or per site, and the ticket a trade needs on a job (a rigger's RB licence on a shutdown).
- **Fatigue limits** at business, client and site level: shift length, minimum rest, days in a row, hours in 14 days.
- **Swing patterns.** 2/1, 8/6 and 14/14 and a shutdown pattern come built in. Add your own by asking.
- **Jobs** with the crew each needs per day by trade, and each client's hourly rate by trade.
- **Labour hire firms and subcontractors**, with their Queensland labour hire licence number and insurance expiry.

Ask in plain words: "add a site Mt Keith Mill for Coolabah, drive in from Leinster, camp Keith Village, needs a Coolabah induction and a medical" and Claude Code writes the rows.

## 2. Get your data out of Humanz

Humanz onboards from spreadsheets and bulk uploads, and you can export reports to CSV. Ask your Humanz account manager for three exports: the worker list, every worker's credentials with numbers and expiry dates, and the roster with timesheets for the period you want to keep (at least the current and next swings, and every shift not yet invoiced or paid). Humanz does not publish its export format, so the column names below are the common variants; the import matches by name and tells you what it could not read.

## 3. Import, in order

```
npm run roster -- import workers workers.csv --dry-run
npm run roster -- import workers workers.csv
npm run roster -- import credentials credentials.csv
npm run roster -- import shifts roster.csv
```

The dry run writes nothing and reports anything it could not read. Running any import twice is harmless: a worker code, a worker's credential with the same expiry, or a worker and date already here is skipped.

### What maps

| Import | This system | Column names it looks for |
|---|---|---|
| workers | Code | Employee ID, Worker ID, Payroll ID, Code, ID |
| workers | Name | Full Name, Name, Worker, or First Name and Last Name |
| workers | Trade | Trade, Position, Role, Job Title |
| workers | Employee, labour hire or subcontractor | Employment Type, Type, Worker Type |
| workers | Labour hire firm or subcontractor | Company, Agency, Provider, Supplier (created if new) |
| workers | Home airport | Home Port, Point of Hire, Departure Airport |
| workers | Contact | Mobile, Phone, Email |
| credentials | Worker | Employee ID, Worker ID, Worker, Name, Full Name |
| credentials | Credential | Credential, Competency, Licence, Qualification, Type (matched to your types by code or name; new ones are created and sorted into induction, medical, high risk work licence, VOC, licence or ticket from the name) |
| credentials | Number and expiry | Number, Licence Number, Card Number, Reference; Expiry, Expiry Date, Expires, Valid To (YYYY-MM-DD or DD/MM/YYYY) |
| shifts | Worker, date, job | Employee ID or name; Date, Shift Date, Roster Date; Job, Job Code, Project, or Site (matched to a job code, job name, site code or site name) |
| shifts | Shift | Shift, Shift Type (night or N is a night shift), Hours, Rostered Hours, Planned Hours, Status (confirmed, accepted, declined) |
| shifts | Timesheet | Start, Start Time, Actual Start; End, Finish, End Time, Actual End; Break, Break (min); Timesheet Status, Approval (approved, else submitted) |

`examples/` has one file of each shape. If your export names a column differently, ask Claude Code to map it in `scripts/roster.mjs` (the `importCmd` function) and add the case to `scripts/smoke.mjs`.

### What does not carry over

- **Swing assignments as patterns.** The import brings the roster as dated shifts, which is what every check reads. To roll a pattern forward from here, book it once with `/assign`.
- **Flights, camp rooms, vehicles and plant.** Enter the current and next swings' flights and rooms from the travel bookings. Vehicles and plant are not in the base; they are a `/customise` away.
- **Forms, prestarts and the documents behind each credential.** Keep the files where they are; the credential records the number and the expiry.
- **Approval history.** An imported approved timesheet is marked "imported from Humanz" as the approver.
- **The phone app.** Workers confirm shifts and send hours the way they do now (a text, a photo, the supervisor's sheet) and the office or Claude Code enters them. A phone screen for workers is something Enterprise DNA builds into your version if you want one.

## 4. Check, then switch

1. `npm run roster -- board --days=28` against the Humanz scheduler for the same four weeks. Every person, every day.
2. `npm run roster -- compliance` and `npm run roster -- attention`. Anything flagged that Humanz did not flag is either a requirement you have not entered yet or a real problem.
3. `npm run roster -- hours --days=14` against the last Humanz timesheet report.
4. When they match, roster the next changeover here.
