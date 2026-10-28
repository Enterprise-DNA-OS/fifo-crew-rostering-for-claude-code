<h1 align="center">FIFO Crew Rostering for Claude Code</h1>

<p align="center">
  <strong>The open-source FIFO crew rostering system (swings, mobilisation, flights and camp, credential and fatigue checks, timesheets) that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Humanz data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=humanz">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/humanz?utm_source=github&utm_medium=readme&utm_campaign=humanz">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-humanz">Instead of Humanz</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

FIFO Crew Rostering for Claude Code does the rostering, gate, travel and timesheet side of the job you pay Humanz for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Humanz dashboard cannot.

Humanz publishes no price. Its own pricing page says it is quoted per business on the size of the workforce you roster, employees and subcontractors together, with all 14 modules included ([humanz.net.au/pricing](https://humanz.net.au/pricing), checked 28 October 2026), and its mining page describes an indicative rollout of about 11 weeks ([humanz.net.au/solutions/mining](https://humanz.net.au/solutions/mining)). The bill grows with your headcount every year. This costs nothing, or a setup fee and a retainer if Enterprise DNA runs it for you.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=humanz).

It is built for a mining services contractor rostering FIFO and DIDO crews (fixed and mobile plant maintenance, shutdowns, diesel, electrical, boilermaking, rigging) across client sites in WA and Queensland: clients and sites with what each requires at the gate, swing patterns and panels, jobs with the crew they need by trade, employees, labour hire and subcontractors, credentials with expiry, fatigue rules at business, client and site level, the roster, flights and camp rooms, timesheets, and an audit trail of every override. The words are the ones a crew coordinator already uses.

**Nothing sends or talks to another system on its own.** Itineraries, crew packs and labour requests are drafted here and a person sends them. Payroll stays in your payroll system: approved hours leave as a file. The gates are real, though: nobody is booked who is not cleared for the site, double booked, on a declined day, or past the consecutive shift limit, unless someone overrides it with a reason and their name, and that goes on the audit trail.

```
/attention                 everything that wants a decision, worst first
/swings                    every swing with its flights, room and gate check
/coverage                  days a job is short of a trade
/fill                      who can fill the gap, checked against the gates
/assign                    book a swing, gates first
/fatigue                   shifts over the strictest limit that applies
/compliance                nine rules: site requirements, high risk work licences, four fatigue limits, hours records, Queensland labour hire, signed overrides
/billing                   approved hours not invoiced, at each client's rates
/weekly-review             the Monday review, written from three commands
```

Every gate reads one view, `v_shift_requirements`: every credential each booked shift needs (the client's, the site's and the trade's ticket on that job) and whether the person holds it current on that day. The board, the swings list, the fill list, the crew pack and the attention list can never disagree about who is cleared.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/fifo-crew-rostering-for-claude-code.git
cd fifo-crew-rostering-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database and loads Redgum Diesel & Shutdown (a demo Welshpool contractor with 17 people on fixed plant maintenance at a Pilbara iron ore hub on 2/1 and 14/14 panels, mobile plant at a Goldfields mill on 8/6, a crusher reline shutdown just finished and a dragline shutdown in Queensland in nine days: a fitter on site today with a site induction that lapsed three days ago, booked through an override nobody signed; a medical that runs out mid-swing; a rigger whose rigging licence lapses during the shutdown; a labour hire firm with no Queensland licence supplying two people to the Queensland site; a night-to-day swap with eight hours' rest; a 14 hour shift; a fitter past the client's 14 days in a row and the 168 hour cap; three declined days that leave the hub a fitter short; the shutdown two fitters short; swings with no flight or room; shifts with no timesheet; and $74,396 of approved hours not yet invoiced), then prints the swings that are not ready, the crew gaps and the attention list.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/swings`, `/fill J-203`, `/board`, `/fatigue`, `/worker W03`, `/billing`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), and put your name, logo and colours in [brand.json](brand.json) so the itineraries and crew packs carry them.

## Your first hour: ten things to ask for

1. "What needs attention today?"
2. "Who is not ready for Thursday's changeover?"
3. "Who can fill the fitter gap on the Bowen Range shutdown?"
4. "Put Ana on the shutdown, ten days from the 6th."
5. "Kelly's new Wirraway induction is number WIR-88213, valid two years."
6. "Josh is on QF2380 on the 5th, booking ref LP3K2B."
7. "Here is the photo of the supervisor's timesheet for last night. Enter it."
8. "Who is over hours or short on rest this fortnight?"
9. "Send me the crew and compliance pack for the shutdown so I can check it before it goes to Mick."
10. "Bring in this Humanz export."

## Ten questions answered from your own records

Every one is a real command or query on the demo data today.

1. Who is on site today without a current site requirement, and who let them through? (`attention`, `worker`)
2. Whose induction, medical or ticket lapses before the end of a swing they are already booked on? (`credentials`, `compliance` R1)
3. Which booked rigger or dogman has a high risk work licence that runs out mid-job? (`compliance` R2)
4. Who can fill this gap, cleared for this site, free on these days, not on a declined day and inside the consecutive shift limit? (`fill`)
5. Who goes over the strictest fatigue limit of the business, the client and the site, counted across every job? (`fatigue`)
6. Which labour hire firm is supplying people to a Queensland site with no Queensland licence on file? (`compliance` R8, `providers`)
7. Which swings in the next two weeks have no flight in, no flight home or no camp room? (`swings --missing`)
8. Which shifts were rostered and have no hours recorded? (`timesheets`, `compliance` R7)
9. How many approved hours are not yet invoiced, by job and trade, at each client's rate? (`billing`)
10. Which overrides have no reason or no name on them? (`overrides`, `compliance` R9)

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/stats` | The roster in four lines. |
| `/board` | The roster grid by job and day: day, night, declined, not cleared. |
| `/swings` | Every swing with flight in, flight home, room and gate check. |
| `/changeover` | Who starts and finishes on a day, and every flight. |
| `/coverage` | Days a job is short of a trade. |
| `/fill` | Who can fill a gap, checked against every gate. |
| `/check` | Can this person work this job on these days? |
| `/assign` | Book a swing pattern onto a job, gates first. |
| `/end` | Take someone off a job from a date. |
| `/confirm` | Record that a worker confirmed their shifts. |
| `/decline` | Record shifts a worker cannot do, and show the gap. |
| `/workers` | Everyone on the books, where they are today, next expiry. |
| `/worker` | One person: credentials, swings, hours, audit trail. |
| `/credentials` | What is expired or expiring, and who is booked past it. |
| `/credential` | Add or renew an induction, medical, VOC, ticket or licence. |
| `/fatigue` | Shifts over the strictest fatigue limit. |
| `/overrides` | Every gate overridden, with the reason and the name. |
| `/flights` | Flights booked, and FIFO swings with no flight. |
| `/flight` | Record or cancel a flight. |
| `/rooms` | Camp rooms booked, and swings with no room. |
| `/room` | Record a camp room. |
| `/timesheet` | Enter hours from a photo, a text or a spreadsheet. |
| `/timesheets` | Timesheets for a period, and shifts with no hours. |
| `/approve` | Supervisor approval for a person or a whole job. |
| `/hours` | Planned against worked, by job, site or client. |
| `/billing` | Approved hours not invoiced, at each client's rate. |
| `/payroll` | Approved employee hours as a file for your payroll system. |
| `/providers` | Labour hire firms and subcontractors: licence, insurance, sites. |
| `/jobs` | Jobs and shutdowns with crew per day. |
| `/job` | One job: requirements, crew by trade, booked, gaps, notes. |
| `/compliance` | Nine rules checked against the roster, each with its source. |
| `/documents` | Swing itineraries, crew and compliance packs, hours summaries in your brand. |
| `/view` | The week, gates and fatigue, and hours dashboards as printable pages. |
| `/new-view` | Add a dashboard in plain language. |
| `/draft-itinerary` | Draft a worker's swing itinerary message. |
| `/draft-crew-pack` | Draft the crew pack cover email to the client. |
| `/draft-credential-reminder` | Draft a reminder to renew a credential. |
| `/draft-labour-request` | Draft a request to a labour hire firm. |
| `/import` | Bring workers, credentials and the roster across from Humanz. |
| `/export` | Every table to CSV. |
| `/log` | A dated note on a job or a person. |
| `/customise` | Change a field, a rule or a limit in plain language. |

Every command is a short recipe over one CLI: `npm run roster -- help` lists it all.

## Instead of Humanz

Set up your sites, requirements, fatigue limits and jobs by asking for them, export your workers, credentials and roster from Humanz as CSV, then:

```
npm run roster -- import workers workers.csv --dry-run
npm run roster -- import workers workers.csv
npm run roster -- import credentials credentials.csv
npm run roster -- import shifts roster.csv
```

Check four weeks of the board against the Humanz scheduler before you switch. The full guide, what maps and what does not: [docs/replace-humanz.md](docs/replace-humanz.md). The rules the compliance check uses, with sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
fifo-crew-rostering-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/roster.mjs        the one CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis, the compliance rules and the Humanz guide
  documents.json, views.json  the paperwork and dashboards, as SQL
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs FIFO Crew Rostering for Claude Code for your business, migrates your Humanz data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=humanz)
- Read more: [enterprisedna.co/omni/instead-of/humanz](https://enterprisedna.co/omni/instead-of/humanz?utm_source=github&utm_medium=readme&utm_campaign=humanz)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
