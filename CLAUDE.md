# FIFO Crew Rostering for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing, what is wrong, what is late | `/attention` |
| The Monday review | `/weekly-review` |
| A quick picture of the roster | `/stats` |
| Who is where, the grid | `/board` |
| Swings, travel and gates for each | `/swings` |
| A changeover day | `/changeover` |
| Where a job is short | `/coverage` |
| Who can fill a gap | `/fill` |
| Can this person go to this job | `/check` |
| Book someone on, take someone off | `/assign`, `/end` |
| A worker confirmed or cannot make it | `/confirm`, `/decline` |
| People, one person | `/workers`, `/worker` |
| What expires, add or renew one | `/credentials`, `/credential` |
| Hours, rest and days in a row | `/fatigue` |
| Who overrode a gate | `/overrides` |
| Flights, one flight | `/flights`, `/flight` |
| Camp rooms, one room | `/rooms`, `/room` |
| A timesheet to enter (photo, text, spreadsheet) | `/timesheet` |
| Timesheets for a period, approvals | `/timesheets`, `/approve` |
| Planned against worked | `/hours` |
| What to invoice | `/billing` |
| Hours for the pay run | `/payroll` |
| Labour hire firms and subbies | `/providers` |
| Jobs, one job | `/jobs`, `/job` |
| Is everything in order with the rules | `/compliance` |
| Itineraries, crew packs, hours summaries | `/documents` |
| Printable dashboards, or a new one | `/view`, `/new-view` |
| A message to a worker, a client, a labour hire firm | `/draft-itinerary`, `/draft-credential-reminder`, `/draft-crew-pack`, `/draft-labour-request` |
| Bring data across from Humanz | `/import` |
| Get the data out | `/export` |
| A note on a job or person | `/log` |
| Change a field, a rule, a limit | `/customise` |

If an ask fits nothing here, run the CLI directly (`npm run roster -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.
- Never override a gate on your own. An override needs a reason and a person's name from the operator in this session, and it goes on the audit trail.
- Never guess a date, a number or a time off a photo of a card, a ticket or a timesheet. If it is unclear, ask.
- Never send a client a crew pack with anyone in it who is not cleared for the site. Tell the operator first.
- Nothing here pays anyone or books with an airline or a camp. It records what a person booked and hands payroll a file.
- Whether a fatigue breach is acceptable is a person's call under your fatigue management plan. Say what the rule is and who set it.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Humanz.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/humanz
