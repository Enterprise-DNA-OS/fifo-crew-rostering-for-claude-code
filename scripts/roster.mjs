#!/usr/bin/env node
// fifo-crew-rostering-for-claude-code: the one CLI. The slash commands call this; so can you.
//
//   node scripts/roster.mjs <command> [args] [--flags] [--json]
//   npm run roster -- <command> ...
//
// Run with no arguments (or `help`) for the command list.
//
// This records what a mining services contractor rosters FIFO and DIDO crews on: sites and their
// entry requirements, swing patterns, jobs and the crew each needs, workers and their credentials,
// fatigue rules at business, client and site level, the roster itself, flights, camp rooms,
// timesheets and an audit trail of every override. It sends nothing and talks to no other system:
// itineraries, compliance packs and chase notes are drafted here and a person sends them. Payroll
// stays in your payroll system: approved hours export to it as a CSV.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, heading, hours, weekday, truncate } from './lib/format.mjs';

// ---------------------------------------------------------------- settings

// How far ahead the gates look at booked shifts, and how far back.
const LOOK_AHEAD_DAYS = 56;
const LOOK_BACK_DAYS = 14;
// A timesheet is missing once the shift is this many days old.
const TIMESHEET_GRACE_DAYS = 1;
// A submitted timesheet waiting longer than this is flagged.
const APPROVAL_DAYS = 2;
// Approved hours not invoiced after this many days are flagged.
const INVOICE_DAYS = 7;
// Shifts starting within this many days should be confirmed by the worker.
const CONFIRM_DAYS = 10;

// ---------------------------------------------------------------- arguments

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'save', 'night', 'missing', 'cancel', 'open']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name, value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const n = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const aud = (cents) => money(cents, 'AUD');
const h1 = (minutes) => (n(minutes) / 60).toFixed(1).replace(/\.0$/, '');

function today() { return isoDate(new Date()); }
function addDays(iso, k) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + k));
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const t = (s) => Date.UTC(...String(s).slice(0, 10).split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  return Math.round((t(b) - t(a)) / 86400000);
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'today') return today();
  if (s === 'yesterday') return addDays(today(), -1);
  if (s === 'tomorrow') return addDays(today(), 1);
  const rel = s.match(/^([+-])(\d+)d?$/);
  if (rel) return addDays(today(), (rel[1] === '-' ? -1 : 1) * Number(rel[2]));
  // AU exports write DD/MM/YYYY.
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD, today, or +7.`);
}

function parseTime(v, what) {
  const s = str(v).trim();
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) throw new CliError(`${what} should be a time like 06:00 or 1830 (got "${s}").`);
  return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
}
const toMin = (t) => { const [hh, mm] = String(t).split(':').map(Number); return hh * 60 + mm; };

function intFlag(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const x = Number(v);
  if (!Number.isInteger(x) || x < 0) throw new CliError(`"${v}" is not a whole number.`);
  return x;
}

// ---------------------------------------------------------------- lookups

let db;
let JSON_OUT = false;

function ambiguous(what, rows, label) {
  return new CliError(`More than one ${what} matches. Be more specific:\n${rows.map((r) => `  ${label(r)}`).join('\n')}`);
}

async function findWorker(ref) {
  if (!ref || ref === true) throw new CliError('Who? Give a worker code (W03) or part of a name.');
  const rows = await db.query(`select w.*, p.name as provider, p.qld_licence_ref from workers w left join providers p on p.id = w.provider_id
    where lower(w.code) = lower($1) or lower(w.full_name) = lower($1) or w.full_name ilike $2 or lower(coalesce(w.external_ref,'')) = lower($1) order by w.full_name`, [ref, `%${ref}%`]);
  const exact = rows.filter((r) => r.code.toLowerCase() === String(ref).toLowerCase() || r.full_name.toLowerCase() === String(ref).toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No one called "${ref}". Run: roster workers`);
  throw ambiguous('person', rows, (r) => `${r.code}  ${r.full_name} (${r.trade})`);
}

async function findJob(ref) {
  if (!ref || ref === true) throw new CliError('Which job? Give its code (J-201) or part of its name or site.');
  const sql = `select j.*, s.code as site, s.name as site_name, s.state, s.travel_mode, s.airport, s.camp, s.client_id, c.name as client
    from jobs j join sites s on s.id = j.site_id join clients c on c.id = s.client_id`;
  const exact = await db.query(`${sql} where lower(j.code) = lower($1) or lower(coalesce(j.po_ref,'')) = lower($1)`, [ref]);
  if (exact.length === 1) return exact[0];
  const rows = await db.query(`${sql} where j.code ilike $1 or j.name ilike $1 or s.name ilike $1 or s.code ilike $1 or c.name ilike $1 order by j.code`, [`%${ref}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No job matches "${ref}". Run: roster jobs --all`);
  throw ambiguous('job', rows, (r) => `${r.code}  ${r.name} (${r.site})`);
}

async function findSite(ref) {
  const rows = await db.query(`select * from sites where lower(code) = lower($1) or name ilike $2 order by code`, [ref, `%${ref}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No site "${ref}". Run: roster sites`);
  throw ambiguous('site', rows, (r) => `${r.code}  ${r.name}`);
}

async function findCredType(ref) {
  if (!ref || ref === true) throw new CliError('Which credential? Give its code (MED, IND-WIR, HRWL-RB). Run: roster credential-types');
  const rows = await db.query(`select * from credential_types where lower(code) = lower($1) or name ilike $2 order by code`, [ref, `%${ref}%`]);
  const exact = rows.filter((r) => r.code.toLowerCase() === String(ref).toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No credential type "${ref}". Run: roster credential-types`);
  throw ambiguous('credential type', rows, (r) => `${r.code}  ${r.name}`);
}

async function findTemplate(ref) {
  const [t] = await db.query(`select * from swing_templates where lower(code) = lower($1) or name ilike $2`, [ref, `%${ref}%`]);
  if (!t) throw new CliError(`No swing pattern "${ref}". Patterns: ${(await db.query('select code from swing_templates order by code')).map((x) => x.code).join(', ')}`);
  return t;
}

// ---------------------------------------------------------------- output

function out(data, text) {
  if (JSON_OUT) console.log(JSON.stringify(data, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

// ---------------------------------------------------------------- shared queries

// Everything a worker must hold, current, to work this job: the client's, the site's and the trade's ticket.
async function requiredFor(job, trade) {
  return db.query(`
    select distinct ct.id, ct.code, ct.name, ct.kind from credential_types ct
    where ct.id in (select credential_type_id from requirements where client_id = $1)
       or ct.id in (select credential_type_id from requirements where site_id = $2)
       or ct.id in (select credential_type_id from job_roles where job_id = $3 and lower(trade) = lower($4) and credential_type_id is not null)
    order by ct.code`, [job.client_id, job.site_id, job.id, trade]);
}

// Can this person work these days on this job? Busy days, credentials not current on the last day, licence.
async function gateCheck(worker, job, dates) {
  const last = dates[dates.length - 1];
  const busy = await db.query(`select s.shift_date, j.code as job from shifts s join jobs j on j.id = s.job_id
    where s.worker_id = $1 and s.status in ('planned','confirmed') and s.shift_date = any($2::date[]) order by s.shift_date`, [worker.id, dates]);
  const need = await requiredFor(job, worker.trade);
  const held = await db.query(`select credential_type_id, expires_on, ref from credentials where worker_id = $1`, [worker.id]);
  const byType = Object.fromEntries(held.map((h) => [h.credential_type_id, h]));
  const missing = [];
  for (const c of need) {
    const h = byType[c.id];
    if (!h) missing.push({ code: c.code, name: c.name, kind: c.kind, problem: 'none on file' });
    else if (h.expires_on && isoDate(h.expires_on) < last) missing.push({ code: c.code, name: c.name, kind: c.kind, problem: `expires ${isoDate(h.expires_on)}`, expires_on: isoDate(h.expires_on) });
  }
  let licence = null;
  if (job.state === 'QLD' && worker.employment === 'labour-hire' && !worker.qld_licence_ref) licence = `${worker.provider || 'The labour hire firm'} has no Queensland labour hire licence recorded`;
  // The run of days in a row this booking makes, counting the shifts either side of it.
  const first = dates[0];
  const near = await db.query(`select shift_date, status from shifts where worker_id = $1 and shift_date between $2::date - 30 and $3::date + 30 and status <> 'cancelled'`, [worker.id, first, last]);
  const declined = near.filter((r) => r.status === 'declined' && dates.includes(isoDate(r.shift_date))).map((r) => isoDate(r.shift_date));
  const on = new Set([...near.filter((r) => r.status !== 'declined').map((r) => isoDate(r.shift_date)), ...dates]);
  let run = 0;
  for (const d of dates) {
    let a = d, b = d, k = 1;
    while (on.has(addDays(a, -1))) { a = addDays(a, -1); k++; }
    while (on.has(addDays(b, 1))) { b = addDays(b, 1); k++; }
    run = Math.max(run, k);
  }
  const worksBefore = near.some((r) => r.status !== 'declined' && isoDate(r.shift_date) < first && daysBetween(isoDate(r.shift_date), first) <= 7);
  const worksAfter = near.some((r) => r.status !== 'declined' && isoDate(r.shift_date) > last && daysBetween(last, isoDate(r.shift_date)) <= 7);
  const onBreak = worksBefore && worksAfter && !busy.length && !declined.length;
  return { busy: busy.map((b) => ({ date: isoDate(b.shift_date), job: b.job })), missing, licence, declined, run, on_break: onBreak };
}

async function strictestLimits(job) {
  const [l] = await db.query(`select min(max_shift_minutes) as max_shift_minutes, max(min_rest_minutes) as min_rest_minutes,
      min(max_consecutive) as max_consecutive, min(max_14d_minutes) as max_14d_minutes
    from fatigue_policies where level = 'business' or client_id = $1 or site_id = $2`, [job.client_id, job.site_id]);
  return l;
}

async function swingRows(aheadDays = 21, { workerId = null, jobId = null } = {}) {
  return db.query(`
    select w.code as worker_code, w.full_name as worker, w.trade, w.home_port, j.code as job, si.code as site, si.travel_mode,
           sw.start_on, sw.end_on, sw.days, sw.shift_kind, sw.confirmed_days, sw.declined_days, sw.worker_id, sw.job_id,
           (select f.flight_no || ' ' || to_char(f.flight_date, 'YYYY-MM-DD') from flights f where f.worker_id = sw.worker_id and f.direction = 'in' and f.status = 'booked' and f.flight_date between sw.start_on - 1 and sw.start_on limit 1) as flight_in,
           (select f.flight_no || ' ' || to_char(f.flight_date, 'YYYY-MM-DD') from flights f where f.worker_id = sw.worker_id and f.direction = 'out' and f.status = 'booked' and f.flight_date between sw.end_on and sw.end_on + 1 limit 1) as flight_out,
           (select r.room from rooms r where r.worker_id = sw.worker_id and r.site_id = j.site_id and r.status = 'booked' and r.check_in <= sw.start_on and r.check_out >= sw.end_on limit 1) as room,
           (select string_agg(distinct q.credential, ', ') from v_shift_requirements q where q.worker_id = sw.worker_id and q.job_id = sw.job_id and q.shift_date between sw.start_on and sw.end_on and not q.ok) as gate_fails
    from v_swings sw
    join workers w on w.id = sw.worker_id join jobs j on j.id = sw.job_id join sites si on si.id = j.site_id
    where sw.end_on >= current_date and sw.start_on <= current_date + $1::int
      and ($2::uuid is null or sw.worker_id = $2) and ($3::uuid is null or sw.job_id = $3)
    order by sw.start_on, j.code, w.code`, [aheadDays, workerId, jobId]);
}

function swingIssues(s) {
  const issues = [];
  const started = isoDate(s.start_on) <= today();
  if (s.travel_mode === 'FIFO' && !s.flight_in && !started) issues.push('no flight in');
  if (s.travel_mode === 'FIFO' && !s.flight_out) issues.push('no flight out');
  if (!s.room) issues.push('no room');
  if (s.gate_fails) issues.push(`not cleared: ${s.gate_fails}`);
  if (n(s.declined_days)) issues.push(`${s.declined_days} days declined`);
  return issues;
}

async function coverageRows(aheadDays = 28, jobId = null) {
  const rows = await db.query(`
    select j.code as job, j.name as job_name, jr.trade, g.d::date as day, jr.headcount as need,
           (select count(*) from shifts s join workers w on w.id = s.worker_id
             where s.job_id = j.id and s.shift_date = g.d::date and s.status in ('planned','confirmed') and lower(w.trade) = lower(jr.trade))::int as booked
    from jobs j join job_roles jr on jr.job_id = j.id
    cross join lateral generate_series(greatest(j.starts_on, current_date), least(coalesce(j.ends_on, current_date + $1::int), current_date + $1::int), interval '1 day') g(d)
    where j.status <> 'finished' and ($2::uuid is null or j.id = $2)
    order by j.code, jr.trade, day`, [aheadDays, jobId]);
  // Collapse short days into runs.
  const runs = [];
  for (const r of rows) {
    if (r.booked >= r.need) continue;
    const day = isoDate(r.day);
    const last = runs[runs.length - 1];
    if (last && last.job === r.job && last.trade === r.trade && last.short === r.need - r.booked && addDays(last.to, 1) === day) { last.to = day; last.days++; continue; }
    runs.push({ job: r.job, job_name: r.job_name, trade: r.trade, from: day, to: day, days: 1, need: r.need, booked: r.booked, short: r.need - r.booked });
  }
  return runs;
}

async function fatigueRows(from, to) {
  const rows = await db.query(`
    select f.*, w.code as worker_code, w.full_name as worker, j.code as job
    from v_fatigue f join workers w on w.id = f.worker_id join jobs j on j.id = f.job_id
    where f.shift_date between $1::date and $2::date order by w.code, f.shift_date`, [from, to]);
  return rows.map((r) => {
    const breaches = [];
    if (r.max_shift_minutes && n(r.minutes) > n(r.max_shift_minutes)) breaches.push({ rule: 'R3', what: `${h1(r.minutes)} h shift, limit ${h1(r.max_shift_minutes)} h` });
    if (r.min_rest_minutes && r.rest_minutes !== null && n(r.rest_minutes) < n(r.min_rest_minutes)) breaches.push({ rule: 'R4', what: `${h1(r.rest_minutes)} h rest before it, minimum ${h1(r.min_rest_minutes)} h` });
    if (r.max_consecutive && n(r.consecutive) > n(r.max_consecutive)) breaches.push({ rule: 'R5', what: `shift ${r.consecutive} in a row, limit ${r.max_consecutive}` });
    if (r.max_14d_minutes && n(r.minutes_14d) > n(r.max_14d_minutes)) breaches.push({ rule: 'R6', what: `${h1(r.minutes_14d)} h in 14 days, limit ${h1(r.max_14d_minutes)} h` });
    return { ...r, shift_date: isoDate(r.shift_date), breaches };
  });
}

async function requirementFails(from, to) {
  return db.query(`
    select q.worker_id, w.code as worker_code, w.full_name as worker, j.code as job, si.code as site, q.credential, q.credential_name, q.kind, q.why,
           q.expires_on, min(q.shift_date) as first_day, max(q.shift_date) as last_day, count(*)::int as shifts,
           bool_or(q.shift_date <= current_date) as on_site_now
    from v_shift_requirements q join workers w on w.id = q.worker_id join jobs j on j.id = q.job_id join sites si on si.id = j.site_id
    where not q.ok and q.shift_date between $1::date and $2::date
    group by q.worker_id, w.code, w.full_name, j.code, si.code, q.credential, q.credential_name, q.kind, q.why, q.expires_on
    order by min(q.shift_date), w.code`, [from, to]);
}

async function missingTimesheets() {
  return db.query(`
    select w.code as worker_code, w.full_name as worker, j.code as job, s.shift_date, s.shift_kind
    from shifts s join workers w on w.id = s.worker_id join jobs j on j.id = s.job_id
    where s.status in ('planned','confirmed') and s.shift_date < current_date - $1::int and s.shift_date >= current_date - 60
      and not exists (select 1 from timesheets t where t.shift_id = s.id)
    order by w.code, s.shift_date`, [TIMESHEET_GRACE_DAYS]);
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

// ---------------------------------------------------------------- overview

async function stats() {
  const [s] = await db.query(`
    select (select count(*) from workers where active) as workers,
           (select count(*) from shifts where shift_date = current_date and status in ('planned','confirmed')) as on_site_today,
           (select count(*) from jobs where status <> 'finished') as live_jobs,
           (select count(*) from v_swings where start_on between current_date + 1 and current_date + 7) as swings_starting_7d,
           (select count(distinct worker_id) from v_shift_requirements where not ok and shift_date between current_date and current_date + 21) as not_cleared_21d,
           (select count(*) from timesheets where status = 'submitted') as timesheets_waiting,
           (select coalesce(sum(value_cents),0) from v_timesheets where status = 'approved' and invoiced_on is null) as approved_not_invoiced_cents`);
  const r = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, n(v)]));
  r.coverage_gaps = (await coverageRows(21)).length;
  out(r, () => [
    heading('The roster at a glance'),
    `  ${r.workers} people, ${r.on_site_today} on shift today across ${r.live_jobs} live jobs. ${r.swings_starting_7d} swings start in the next 7 days.`,
    `  ${r.not_cleared_21d} people booked in the next 3 weeks who are not cleared for the site. ${r.coverage_gaps} crew gaps in the next 3 weeks.`,
    `  ${r.timesheets_waiting} timesheets waiting for approval. ${aud(r.approved_not_invoiced_cents)} of approved hours not yet invoiced.`,
  ].join('\n'));
}

// ---------------------------------------------------------------- the roster

async function board(flags) {
  const days = intFlag(flags.days, 14);
  const from = parseDate(flags.from) || today();
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const job = flags.job ? await findJob(flags.job) : null;
  const rows = await db.query(`
    select j.code as job, w.code as worker_code, w.full_name as worker, w.trade, s.shift_date, s.shift_kind, s.status,
           exists (select 1 from v_shift_requirements q where q.shift_id = s.id and not q.ok) as not_cleared
    from shifts s join jobs j on j.id = s.job_id join workers w on w.id = s.worker_id
    where s.shift_date between $1::date and $2::date and s.status <> 'cancelled' and ($3::uuid is null or j.id = $3)
    order by j.code, w.trade, w.code, s.shift_date`, [from, dates[dates.length - 1], job?.id || null]);
  const grid = [];
  for (const [key, list] of groupBy(rows, (r) => `${r.job}|${r.worker_code}`)) {
    const [jobCode] = key.split('|');
    const byDay = Object.fromEntries(list.map((r) => [isoDate(r.shift_date), r.status === 'declined' ? 'x' : r.not_cleared ? '!' : r.shift_kind === 'night' ? 'N' : 'D']));
    grid.push({ job: jobCode, worker_code: list[0].worker_code, worker: list[0].worker, trade: list[0].trade, days: Object.fromEntries(dates.map((d) => [d, byDay[d] || '.'])) });
  }
  out({ from, dates, rows: grid }, () => {
    const head = `  ${'job'.padEnd(6)} ${'who'.padEnd(18)} ${'trade'.padEnd(18)} ` + dates.map((d) => d.slice(8, 10)).join(' ');
    const sub = `  ${''.padEnd(6)} ${''.padEnd(18)} ${''.padEnd(18)} ` + dates.map((d) => weekday(d).slice(0, 2)).join(' ');
    const lines = grid.map((g) => `  ${g.job.padEnd(6)} ${truncate(`${g.worker_code} ${g.worker}`, 18).padEnd(18)} ${truncate(g.trade, 18).padEnd(18)} ` + dates.map((d) => ` ${g.days[d]}`).join(' '));
    return [heading(`Roster from ${from}`), head, sub, ...lines, '', '  D day  N night  x declined  ! booked but not cleared for the site  . off'].join('\n');
  });
}

async function swings(flags) {
  const ahead = intFlag(flags.days, 21);
  const w = flags.worker ? await findWorker(flags.worker) : null;
  const j = flags.job ? await findJob(flags.job) : null;
  let rows = (await swingRows(ahead, { workerId: w?.id || null, jobId: j?.id || null })).map((s) => ({ ...s, start_on: isoDate(s.start_on), end_on: isoDate(s.end_on), issues: swingIssues(s) }));
  if (flags.missing) rows = rows.filter((s) => s.issues.length);
  out(rows, () => heading(`Swings in progress or starting in the next ${ahead} days`) + '\n' + table(rows, [
    { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name', width: 16 }, { key: 'job', label: 'job' }, { key: 'site', label: 'site' },
    { key: 'start_on', label: 'in' }, { key: 'end_on', label: 'out' }, { key: 'days', label: 'days', align: 'right' },
    { key: 'flight_in', label: 'flight in', format: (v, r) => (r.travel_mode !== 'FIFO' ? r.travel_mode : v || '-') },
    { key: 'flight_out', label: 'flight out', format: (v, r) => (r.travel_mode !== 'FIFO' ? r.travel_mode : v || '-') },
    { key: 'room', label: 'room', format: (v) => v || '-' },
    { key: 'issues', label: 'needs', format: (v) => v.join('; ') || 'ready', width: 48 },
  ]));
}

async function changeover(flags) {
  const date = parseDate(flags.date) || today();
  const ins = await db.query(`select w.code as worker_code, w.full_name as worker, j.code as job, si.code as site, sw.start_on, sw.end_on
    from v_swings sw join workers w on w.id = sw.worker_id join jobs j on j.id = sw.job_id join sites si on si.id = j.site_id where sw.start_on = $1::date order by si.code, w.code`, [date]);
  const outs = await db.query(`select w.code as worker_code, w.full_name as worker, j.code as job, si.code as site, sw.start_on, sw.end_on
    from v_swings sw join workers w on w.id = sw.worker_id join jobs j on j.id = sw.job_id join sites si on si.id = j.site_id where sw.end_on = $1::date order by si.code, w.code`, [date]);
  const fl = await db.query(`select w.code as worker_code, w.full_name as worker, f.direction, f.from_port, f.to_port, f.flight_no, f.booking_ref
    from flights f join workers w on w.id = f.worker_id where f.flight_date = $1::date and f.status = 'booked' order by f.direction, f.flight_no, w.code`, [date]);
  out({ date, starting: ins, finishing: outs, flights: fl }, () => [
    heading(`Changeover ${date} (${weekday(date)})`),
    '  Starting a swing', table(ins, [{ key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'site', label: 'site' }, { key: 'end_on', label: 'until', format: isoDate }]),
    '', '  Last day of a swing', table(outs, [{ key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'site', label: 'site' }, { key: 'start_on', label: 'since', format: isoDate }]),
    '', '  Flights', table(fl, [{ key: 'direction', label: 'dir' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'flight_no', label: 'flight' }, { key: 'from_port', label: 'from' }, { key: 'to_port', label: 'to' }, { key: 'booking_ref', label: 'ref' }]),
  ].join('\n'));
}

// ---------------------------------------------------------------- people, sites, jobs

async function workers(flags) {
  const rows = await db.query(`
    select w.code, w.full_name, w.trade, w.employment, p.name as provider, w.home_port,
           (select j.code from shifts s join jobs j on j.id = s.job_id where s.worker_id = w.id and s.shift_date = current_date and s.status in ('planned','confirmed')) as on_today,
           (select min(s.shift_date) from shifts s where s.worker_id = w.id and s.shift_date > current_date and s.status in ('planned','confirmed')) as next_shift,
           (select min(c.expires_on) from credentials c where c.worker_id = w.id and c.expires_on is not null) as next_expiry
    from workers w left join providers p on p.id = w.provider_id
    where (w.active or $1) and ($2 = '' or w.trade ilike $2) and ($3 = '' or w.employment = $3)
    order by w.code`, [!!flags.all, flags.trade ? `%${flags.trade}%` : '', str(flags.type)]);
  out(rows, () => heading('Workers') + '\n' + table(rows, [
    { key: 'code', label: 'code' }, { key: 'full_name', label: 'name' }, { key: 'trade', label: 'trade' }, { key: 'employment', label: 'type' },
    { key: 'provider', label: 'supplied by', format: (v) => v || '' }, { key: 'home_port', label: 'from', format: (v) => v || 'drive' },
    { key: 'on_today', label: 'today', format: (v) => v || 'off' }, { key: 'next_shift', label: 'next shift', format: isoDate },
    { key: 'next_expiry', label: 'next expiry', format: isoDate },
  ]));
}

async function worker(args) {
  const w = await findWorker(args[0]);
  const creds = await db.query(`select ct.code, ct.name, ct.kind, c.ref, c.expires_on, (c.expires_on - current_date) as days_left
    from credentials c join credential_types ct on ct.id = c.credential_type_id where c.worker_id = $1 order by c.expires_on nulls last`, [w.id]);
  const sw = (await swingRows(90, { workerId: w.id })).map((s) => ({ ...s, start_on: isoDate(s.start_on), end_on: isoDate(s.end_on), issues: swingIssues(s) }));
  const [hrs] = await db.query(`select coalesce(sum(minutes),0) as minutes_14d, count(*)::int as shifts_14d from v_shift_times where worker_id = $1 and shift_date between current_date - 13 and current_date`, [w.id]);
  const events = await db.query(`select e.at, e.kind, e.rule, e.reason, e.by_name, e.shift_date, j.code as job from roster_events e left join jobs j on j.id = e.job_id where e.worker_id = $1 order by e.at desc limit 10`, [w.id]);
  const data = { worker: w, credentials: creds, swings: sw, last_14_days: { shifts: hrs.shifts_14d, hours: n(hrs.minutes_14d) / 60 }, events };
  out(data, () => [
    heading(`${w.code} ${w.full_name}`),
    `  ${w.trade}, ${w.employment}${w.provider ? ` through ${w.provider}` : ''}. Flies from ${w.home_port || '(drives in)'}. ${w.phone || ''} ${w.email || ''}`,
    `  Last 14 days: ${hrs.shifts_14d} shifts, ${h1(hrs.minutes_14d)} hours.`,
    '', '  Credentials', table(creds, [{ key: 'code', label: 'code' }, { key: 'name', label: 'credential' }, { key: 'ref', label: 'ref' }, { key: 'expires_on', label: 'expires', format: (v) => (v ? isoDate(v) : 'no expiry') }, { key: 'days_left', label: 'days', align: 'right', format: (v) => (v === null ? '' : v) }]),
    '', '  Swings', table(sw, [{ key: 'job', label: 'job' }, { key: 'site', label: 'site' }, { key: 'start_on', label: 'in' }, { key: 'end_on', label: 'out' }, { key: 'flight_in', label: 'flight in', format: (v) => v || '-' }, { key: 'flight_out', label: 'flight out', format: (v) => v || '-' }, { key: 'room', label: 'room', format: (v) => v || '-' }, { key: 'issues', label: 'needs', format: (v) => v.join('; ') || 'ready' }]),
    events.length ? '\n  Audit trail\n' + table(events, [{ key: 'at', label: 'when', format: (v) => isoDate(v) }, { key: 'kind', label: 'what' }, { key: 'job', label: 'job' }, { key: 'rule', label: 'rule', format: (v) => v || '' }, { key: 'reason', label: 'reason', format: (v) => v || '(none given)' }, { key: 'by_name', label: 'by', format: (v) => v || '(nobody)' }]) : '',
  ].join('\n'));
}

async function sites() {
  const rows = await db.query(`select s.code, s.name, c.name as client, s.region, s.state, s.travel_mode, s.airport, s.camp,
      (select string_agg(ct.code, ', ' order by ct.code) from credential_types ct where ct.id in (select credential_type_id from requirements r where r.site_id = s.id or r.client_id = s.client_id)) as requires
    from sites s join clients c on c.id = s.client_id order by s.code`);
  out(rows, () => heading('Sites') + '\n' + table(rows, [{ key: 'code', label: 'code' }, { key: 'name', label: 'site' }, { key: 'client', label: 'client' }, { key: 'state', label: 'state' }, { key: 'travel_mode', label: 'travel' }, { key: 'airport', label: 'airstrip', format: (v) => v || '' }, { key: 'camp', label: 'camp' }, { key: 'requires', label: 'to get on site' }]));
}

async function jobs(flags) {
  const rows = await db.query(`select j.code, j.name, s.code as site, c.name as client, j.kind, j.starts_on, j.ends_on, j.status,
      (select sum(headcount) from job_roles r where r.job_id = j.id)::int as crew_per_day,
      (select count(*) from shifts x where x.job_id = j.id and x.shift_date = current_date and x.status in ('planned','confirmed'))::int as on_today
    from jobs j join sites s on s.id = j.site_id join clients c on c.id = s.client_id where (j.status <> 'finished' or $1) order by j.starts_on`, [!!flags.all]);
  out(rows, () => heading('Jobs') + '\n' + table(rows, [{ key: 'code', label: 'job' }, { key: 'name', label: 'name' }, { key: 'site', label: 'site' }, { key: 'kind', label: 'kind' }, { key: 'starts_on', label: 'starts', format: isoDate }, { key: 'ends_on', label: 'ends', format: (v) => (v ? isoDate(v) : 'ongoing') }, { key: 'status', label: 'status' }, { key: 'crew_per_day', label: 'crew/day', align: 'right' }, { key: 'on_today', label: 'today', align: 'right' }]));
}

async function job(args) {
  const j = await findJob(args[0]);
  const roles = await db.query(`select r.trade, r.headcount, ct.code as ticket from job_roles r left join credential_types ct on ct.id = r.credential_type_id where r.job_id = $1 order by r.trade`, [j.id]);
  const crew = await db.query(`select w.code, w.full_name, w.trade, w.employment, min(s.shift_date) as first_shift, max(s.shift_date) as last_shift, count(*)::int as shifts
    from shifts s join workers w on w.id = s.worker_id where s.job_id = $1 and s.status in ('planned','confirmed') and s.shift_date >= least(current_date, $2::date)
    group by w.code, w.full_name, w.trade, w.employment order by w.trade, w.code`, [j.id, isoDate(j.starts_on)]);
  const gaps = await coverageRows(28, j.id);
  const notes = await db.query(`select created_at, body, author from notes where job_id = $1 order by created_at desc`, [j.id]);
  const need = await requiredFor(j, '');
  out({ job: j, roles, crew, gaps, requires: need, notes }, () => [
    heading(`${j.code} ${j.name}`),
    `  ${j.client}, ${j.site_name} (${j.state}, ${j.travel_mode}${j.airport ? ' via ' + j.airport : ''}, camp ${j.camp || 'none'}). ${j.kind}, ${isoDate(j.starts_on)} to ${j.ends_on ? isoDate(j.ends_on) : 'ongoing'}, ${j.status}. PO ${j.po_ref || '-'}.`,
    `  To get on site: ${need.map((x) => x.code).join(', ') || 'nothing recorded'}`,
    '', '  Crew needed each day', table(roles, [{ key: 'trade', label: 'trade' }, { key: 'headcount', label: 'need', align: 'right' }, { key: 'ticket', label: 'ticket', format: (v) => v || '' }]),
    '', '  Booked from today', table(crew, [{ key: 'code', label: 'who' }, { key: 'full_name', label: 'name' }, { key: 'trade', label: 'trade' }, { key: 'employment', label: 'type' }, { key: 'first_shift', label: 'from', format: isoDate }, { key: 'last_shift', label: 'to', format: isoDate }, { key: 'shifts', label: 'shifts', align: 'right' }]),
    '', '  Gaps', table(gaps, [{ key: 'trade', label: 'trade' }, { key: 'from', label: 'from' }, { key: 'to', label: 'to' }, { key: 'need', label: 'need', align: 'right' }, { key: 'booked', label: 'booked', align: 'right' }, { key: 'short', label: 'short', align: 'right' }]),
    notes.length ? '\n  Notes\n' + notes.map((x) => `  ${isoDate(x.created_at)}  ${x.body}${x.author ? ` (${x.author})` : ''}`).join('\n') : '',
  ].join('\n'));
}

async function coverage(flags) {
  const j = flags.job ? await findJob(flags.job) : null;
  const ahead = intFlag(flags.days, 28);
  const rows = await coverageRows(ahead, j?.id || null);
  out(rows, () => heading(`Crew gaps, next ${ahead} days`) + '\n' + (rows.length ? table(rows, [{ key: 'job', label: 'job' }, { key: 'job_name', label: 'name' }, { key: 'trade', label: 'trade' }, { key: 'from', label: 'from' }, { key: 'to', label: 'to' }, { key: 'days', label: 'days', align: 'right' }, { key: 'need', label: 'need', align: 'right' }, { key: 'booked', label: 'booked', align: 'right' }, { key: 'short', label: 'short', align: 'right' }]) + '\n\n  Find people: roster fill <job> --trade=<trade>' : '  Every job has its crew.'));
}

async function fill(args, flags) {
  const j = await findJob(args[0]);
  const gaps = await coverageRows(28, j.id);
  const trade = str(flags.trade) || gaps[0]?.trade;
  if (!trade) throw new CliError(`${j.code} has no gaps. Give --trade to look anyway.`);
  const gap = gaps.find((g) => g.trade.toLowerCase() === trade.toLowerCase());
  const from = parseDate(flags.from) || gap?.from || today();
  const to = parseDate(flags.to) || gap?.to || addDays(from, 13);
  const dates = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
  const people = await db.query(`select w.*, p.name as provider, p.qld_licence_ref from workers w left join providers p on p.id = w.provider_id where w.active and lower(w.trade) = lower($1) order by w.code`, [trade]);
  const limits = await strictestLimits(j);
  const rows = [];
  for (const w of people) {
    const g = await gateCheck(w, j, dates);
    const onJob = g.busy.filter((b) => b.job === j.code).length;
    if (onJob === dates.length) continue;
    const blockers = [];
    if (g.declined.length) blockers.push(`declined ${g.declined.length} of these days`);
    if (g.busy.length) blockers.push(`busy ${g.busy.length} of ${dates.length} days (${[...new Set(g.busy.map((b) => b.job))].join(', ')})`);
    if (limits.max_consecutive && g.run > n(limits.max_consecutive)) blockers.push(`would work ${g.run} days in a row, limit ${limits.max_consecutive}`);
    if (g.on_break) blockers.push('on their days off between swings');
    for (const m of g.missing) blockers.push(`${m.code} ${m.problem}`);
    if (g.licence) blockers.push(g.licence);
    rows.push({ code: w.code, name: w.full_name, employment: w.employment, provider: w.provider, home_port: w.home_port, busy_days: g.busy.length + g.declined.length, missing: g.missing.map((m) => m.code), licence: g.licence, on_break: g.on_break, verdict: blockers.length ? blockers.join('; ') : 'ready' });
  }
  rows.sort((a, b) => (a.verdict === 'ready' ? 0 : 1) - (b.verdict === 'ready' ? 0 : 1) || a.busy_days - b.busy_days || a.missing.length - b.missing.length || Number(a.on_break) - Number(b.on_break));
  out({ job: j.code, trade, from, to, short: gap?.short || 0, candidates: rows }, () => [
    heading(`${trade} for ${j.code} ${j.name}, ${from} to ${to}${gap ? ` (${gap.short} short)` : ''}`),
    table(rows, [{ key: 'code', label: 'who' }, { key: 'name', label: 'name' }, { key: 'employment', label: 'type' }, { key: 'provider', label: 'supplied by', format: (v) => v || '' }, { key: 'home_port', label: 'from', format: (v) => v || 'drive' }, { key: 'verdict', label: 'can they go', width: 70 }]),
    '', `  Book someone: roster assign <who> ${j.code} --swing=${j.kind === 'shutdown' ? 'SD10' : '2/1'} --start=${from}${j.kind === 'shutdown' ? '' : ` --end=${to}`}`,
  ].join('\n'));
}

async function check(args, flags) {
  const w = await findWorker(args[0]);
  const j = await findJob(args[1]);
  const from = parseDate(flags.from) || (j.starts_on && isoDate(j.starts_on) > today() ? isoDate(j.starts_on) : today());
  const to = parseDate(flags.to) || (j.ends_on ? isoDate(j.ends_on) : addDays(from, 13));
  const dates = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
  const g = await gateCheck(w, j, dates);
  const limits = await strictestLimits(j);
  const tooLong = limits.max_consecutive && g.run > n(limits.max_consecutive);
  const ok = !g.missing.length && !g.licence && !tooLong && !g.busy.filter((b) => b.job !== j.code).length;
  out({ worker: w.code, job: j.code, from, to, ok, limits, ...g }, () => [
    heading(`Can ${w.full_name} work ${j.code} from ${from} to ${to}?`),
    ok ? '  Yes. Every requirement is current to the last day and they are free.' : '  Not yet:',
    ...g.busy.filter((b) => b.job !== j.code).map((b) => `    - already booked on ${b.job} on ${b.date}`),
    tooLong ? `    - would work ${g.run} days in a row, limit ${limits.max_consecutive} at ${j.site}` : '',
    g.on_break && ok ? '  They would be called in on their days off between swings.' : '',
    ...g.missing.map((m) => `    - ${m.code} ${m.name}: ${m.problem}`),
    g.licence ? `    - ${g.licence}` : '',
  ].filter(Boolean).join('\n'));
}

async function assign(args, flags) {
  const w = await findWorker(args[0]);
  const j = await findJob(args[1]);
  if (!flags.swing) throw new CliError('Which swing pattern? --swing=2/1, 8/6, 14/14 or SD10.');
  const t = await findTemplate(flags.swing);
  const start = parseDate(flags.start);
  if (!start) throw new CliError('When does the first swing start? --start=YYYY-MM-DD');
  const end = parseDate(flags.end) || (j.ends_on ? isoDate(j.ends_on) : addDays(start, intFlag(flags.weeks, 8) * 7 - 1));
  if (end < start) throw new CliError('The end is before the start.');
  const cycle = t.days_on + t.days_off;
  const dates = [];
  for (let i = 0; i <= daysBetween(start, end); i++) if (i % cycle < t.days_on) dates.push(addDays(start, i));
  if (!dates.length) throw new CliError('That pattern puts no shifts between those dates.');
  const g = await gateCheck(w, j, dates);
  if (g.busy.length) throw new CliError(`${w.full_name} is already rostered on ${g.busy.length} of those days (${g.busy.slice(0, 5).map((b) => `${b.date} ${b.job}`).join(', ')}${g.busy.length > 5 ? ', ...' : ''}). End that first: roster end ${w.code} <job> --from=<date>`);
  if (g.declined.length) throw new CliError(`${w.full_name} declined ${g.declined.length} of those days (${g.declined.join(', ')}). Ask them first, then: roster confirm ${w.code} --from=.. --to=..`);
  const limits = await strictestLimits(j);
  const problems = [];
  for (const m of g.missing) problems.push({ rule: m.kind === 'hrwl' ? 'R2 high risk work licence' : 'R1 site requirements', what: `${m.code} ${m.name}: ${m.problem}` });
  if (g.licence) problems.push({ rule: 'R8 labour hire licence', what: g.licence });
  if (limits.max_consecutive && g.run > n(limits.max_consecutive)) problems.push({ rule: 'R5 consecutive shifts', what: `${g.run} days in a row is more than the ${limits.max_consecutive} allowed at ${j.site}` });
  if (limits.max_shift_minutes && t.shift_minutes > n(limits.max_shift_minutes)) problems.push({ rule: 'R3 shift length', what: `${h1(t.shift_minutes)} h shifts, limit ${h1(limits.max_shift_minutes)} h` });
  const override = str(flags.override);
  if (problems.length && (!override || !str(flags.by))) {
    throw new CliError(`Not booked. ${w.full_name} cannot be rostered on ${j.code} yet:\n${problems.map((p) => `  - ${p.rule}: ${p.what}`).join('\n')}\nFix it first, or book anyway with --override="the reason" --by="who approved it". Overrides go on the audit trail.`);
  }
  const kind = flags.night ? 'night' : 'day';
  await db.exec('BEGIN');
  try {
    const [a] = await db.query(`insert into assignments (worker_id, job_id, template_id, panel, shift_kind, start_on, end_on) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [w.id, j.id, t.id, str(flags.panel) || null, kind, start, end]);
    for (const d of dates) await db.query(`insert into shifts (worker_id, job_id, assignment_id, shift_date, shift_kind, planned_minutes) values ($1,$2,$3,$4,$5,$6)
      on conflict (worker_id, shift_date) do update set job_id = excluded.job_id, assignment_id = excluded.assignment_id, shift_kind = excluded.shift_kind,
        planned_minutes = excluded.planned_minutes, status = 'planned', confirmed_at = null, decline_reason = null where shifts.status = 'cancelled'`, [w.id, j.id, a.id, d, kind, t.shift_minutes]);
    await db.query(`insert into roster_events (worker_id, job_id, shift_date, kind, reason, by_name) values ($1,$2,$3,'assign',$4,$5)`, [w.id, j.id, start, `${t.code} from ${start} to ${end}`, str(flags.by) || null]);
    for (const p of problems) await db.query(`insert into roster_events (worker_id, job_id, shift_date, kind, rule, reason, by_name) values ($1,$2,$3,'override',$4,$5,$6)`, [w.id, j.id, start, p.rule, `${override} (${p.what})`, str(flags.by)]);
    await db.exec('COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  const result = { worker: w.code, job: j.code, swing: t.code, shifts: dates.length, first: dates[0], last: dates[dates.length - 1], overrides: problems };
  out(result, () => [
    `  ${w.full_name} is on ${j.code} ${t.code}: ${dates.length} ${kind} shifts from ${dates[0]} to ${dates[dates.length - 1]}. Shifts are planned until they confirm.`,
    problems.length ? `  Overridden and logged: ${problems.map((p) => p.rule).join(', ')} (${str(flags.by)}).` : '',
    j.travel_mode === 'FIFO' ? `  Next: book flights and a room (roster swings --worker=${w.code}).` : `  Next: book a room (roster swings --worker=${w.code}).`,
  ].filter(Boolean).join('\n'));
}

async function endCmd(args, flags) {
  const w = await findWorker(args[0]);
  const j = await findJob(args[1]);
  const from = parseDate(flags.from);
  if (!from) throw new CliError('From which day? --from=YYYY-MM-DD');
  const rows = await db.query(`update shifts set status = 'cancelled' where worker_id = $1 and job_id = $2 and shift_date >= $3 and status in ('planned','confirmed')
    and not exists (select 1 from timesheets t where t.shift_id = shifts.id) returning shift_date`, [w.id, j.id, from]);
  await db.query(`update assignments set end_on = $3::date - 1 where worker_id = $1 and job_id = $2 and (end_on is null or end_on >= $3::date)`, [w.id, j.id, from]);
  await db.query(`insert into roster_events (worker_id, job_id, shift_date, kind, reason, by_name) values ($1,$2,$3,'cancel',$4,$5)`, [w.id, j.id, from, str(flags.reason) || null, str(flags.by) || null]);
  out({ worker: w.code, job: j.code, cancelled: rows.length }, () => `  ${rows.length} shifts on ${j.code} cancelled for ${w.full_name} from ${from}. Cancel their flights and room too.`);
}

async function confirm(args, flags) {
  const w = await findWorker(args[0]);
  const from = parseDate(flags.from) || today();
  const to = parseDate(flags.to) || addDays(from, 28);
  const states = flags.from || flags.to ? ['planned', 'declined'] : ['planned'];
  const rows = await db.query(`update shifts set status = 'confirmed', confirmed_at = now(), decline_reason = null where worker_id = $1 and status = any($4::text[]) and shift_date between $2 and $3 returning shift_date`, [w.id, from, to, states]);
  out({ worker: w.code, confirmed: rows.length }, () => `  ${w.full_name} confirmed ${rows.length} shifts between ${from} and ${to}.`);
}

async function decline(args, flags) {
  const w = await findWorker(args[0]);
  const from = parseDate(flags.date || flags.from);
  if (!from) throw new CliError('Which day? --date=YYYY-MM-DD (and --to= for more than one)');
  const to = parseDate(flags.to) || from;
  if (!str(flags.reason)) throw new CliError('Why? --reason="..." It goes on the audit trail.');
  const rows = await db.query(`update shifts set status = 'declined', decline_reason = $4, confirmed_at = null where worker_id = $1 and shift_date between $2 and $3 and status in ('planned','confirmed') returning shift_date, job_id`, [w.id, from, to, str(flags.reason)]);
  if (!rows.length) throw new CliError(`${w.full_name} has no shifts between ${from} and ${to}.`);
  await db.query(`insert into roster_events (worker_id, job_id, shift_date, kind, reason, by_name) values ($1,$2,$3,'decline',$4,$5)`, [w.id, rows[0].job_id, from, str(flags.reason), str(flags.by) || w.full_name]);
  out({ worker: w.code, declined: rows.length }, () => `  ${rows.length} shifts declined. Find cover: roster coverage`);
}

// ---------------------------------------------------------------- credentials

async function credentialTypes() {
  const rows = await db.query(`select ct.code, ct.name, ct.kind, s.code as site from credential_types ct left join sites s on s.id = ct.site_id order by ct.kind, ct.code`);
  out(rows, () => heading('Credential types') + '\n' + table(rows, [{ key: 'code', label: 'code' }, { key: 'name', label: 'name' }, { key: 'kind', label: 'kind' }, { key: 'site', label: 'site', format: (v) => v || '' }]));
}

async function credentials(flags) {
  const days = intFlag(flags.days, 60);
  const w = flags.worker ? await findWorker(flags.worker) : null;
  const rows = await db.query(`
    select w.code as worker_code, w.full_name as worker, ct.code, ct.name, c.expires_on, (c.expires_on - current_date) as days_left,
           (select min(s.shift_date) from shifts s where s.worker_id = c.worker_id and s.status in ('planned','confirmed') and s.shift_date > c.expires_on
              and exists (select 1 from v_shift_requirements q where q.shift_id = s.id and q.credential = ct.code)) as booked_after_expiry
    from credentials c join workers w on w.id = c.worker_id join credential_types ct on ct.id = c.credential_type_id
    where w.active and c.expires_on is not null and c.expires_on <= current_date + $1::int and ($2::uuid is null or w.id = $2)
    order by c.expires_on`, [days, w?.id || null]);
  out(rows, () => heading(`Credentials expired or expiring in ${days} days`) + '\n' + table(rows, [
    { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'code', label: 'code' }, { key: 'name', label: 'credential', width: 40 },
    { key: 'expires_on', label: 'expires', format: isoDate }, { key: 'days_left', label: 'days', align: 'right' },
    { key: 'booked_after_expiry', label: 'booked after it lapses', format: (v) => (v ? `yes, from ${isoDate(v)}` : '') },
  ]));
}

async function credential(args, flags) {
  const w = await findWorker(args[0]);
  const t = await findCredType(args[1]);
  const exp = flags.expires === 'never' ? null : parseDate(flags.expires, 'expiry date');
  if (flags.expires === undefined) throw new CliError('When does it expire? --expires=YYYY-MM-DD (or --expires=never)');
  await db.query(`insert into credentials (worker_id, credential_type_id, ref, issued_on, expires_on) values ($1,$2,$3,$4,$5)
    on conflict (worker_id, credential_type_id) do update set ref = coalesce(excluded.ref, credentials.ref), issued_on = coalesce(excluded.issued_on, credentials.issued_on), expires_on = excluded.expires_on`,
  [w.id, t.id, str(flags.ref) || null, parseDate(flags.issued) || today(), exp]);
  out({ worker: w.code, credential: t.code, expires_on: exp }, () => `  ${w.full_name}: ${t.name} on file, ${exp ? `expires ${exp}` : 'no expiry'}.`);
}

// ---------------------------------------------------------------- fatigue

async function fatigue(flags) {
  const back = intFlag(flags.days, 14);
  const rows = (await fatigueRows(addDays(today(), -back), addDays(today(), 28))).filter((r) => r.breaches.length);
  const flat = rows.map((r) => ({ worker_code: r.worker_code, worker: r.worker, job: r.job, date: r.shift_date, hours: h1(r.minutes), rest_h: r.rest_minutes === null ? '' : h1(r.rest_minutes), in_a_row: n(r.consecutive), hours_14d: h1(r.minutes_14d), breaches: r.breaches, policies: r.policies }));
  out(flat, () => heading(`Fatigue: shifts over a limit, ${back} days back and 28 ahead`) + '\n' + (flat.length ? table(flat, [
    { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'date', label: 'date' },
    { key: 'hours', label: 'hours', align: 'right' }, { key: 'rest_h', label: 'rest', align: 'right' }, { key: 'in_a_row', label: 'in a row', align: 'right' }, { key: 'hours_14d', label: '14 days', align: 'right' },
    { key: 'breaches', label: 'over', format: (v) => v.map((b) => `${b.rule} ${b.what}`).join('; '), width: 60 },
  ]) + '\n\n  The strictest of the business, client and site rule applies to each shift.' : '  Every shift is inside the strictest limit that applies.'));
}

// ---------------------------------------------------------------- mobilisation

async function flights(flags) {
  const ahead = intFlag(flags.days, 14);
  const booked = await db.query(`select f.flight_date, f.direction, w.code as worker_code, w.full_name as worker, j.code as job, f.from_port, f.to_port, f.flight_no, f.booking_ref
    from flights f join workers w on w.id = f.worker_id left join jobs j on j.id = f.job_id
    where f.status = 'booked' and f.flight_date between current_date and current_date + $1::int order by f.flight_date, f.direction, w.code`, [ahead]);
  const missing = [];
  for (const s of await swingRows(ahead)) {
    if (s.travel_mode !== 'FIFO') continue;
    if (!s.flight_in && isoDate(s.start_on) >= today()) missing.push({ worker_code: s.worker_code, worker: s.worker, job: s.job, direction: 'in', needed_on: isoDate(s.start_on), home_port: s.home_port });
    if (!s.flight_out && isoDate(s.end_on) <= addDays(today(), ahead)) missing.push({ worker_code: s.worker_code, worker: s.worker, job: s.job, direction: 'out', needed_on: isoDate(s.end_on), home_port: s.home_port });
  }
  out({ booked, missing }, () => [
    heading(`Flights, next ${ahead} days`),
    table(booked, [{ key: 'flight_date', label: 'date', format: isoDate }, { key: 'direction', label: 'dir' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'flight_no', label: 'flight' }, { key: 'from_port', label: 'from' }, { key: 'to_port', label: 'to' }, { key: 'booking_ref', label: 'ref' }]),
    '', '  Not booked yet', table(missing, [{ key: 'needed_on', label: 'needed' }, { key: 'direction', label: 'dir' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'home_port', label: 'home' }]),
  ].join('\n'));
}

async function swingNear(w, date) {
  const [s] = await db.query(`select sw.*, j.code as job, j.site_id, si.airport from v_swings sw join jobs j on j.id = sw.job_id join sites si on si.id = j.site_id
    where sw.worker_id = $1 and $2::date between sw.start_on - 1 and sw.end_on + 1 order by sw.start_on limit 1`, [w.id, date]);
  return s;
}

async function flight(args, flags) {
  const w = await findWorker(args[0]);
  const date = parseDate(flags.date);
  if (!date) throw new CliError('Which day? --date=YYYY-MM-DD');
  const dir = flags.direction ? str(flags.direction) : flags.out ? 'out' : 'in';
  if (!['in', 'out'].includes(dir)) throw new CliError('--direction is in or out.');
  if (flags.cancel) {
    const r = await db.query(`update flights set status = 'cancelled' where worker_id = $1 and direction = $2 and flight_date = $3 returning id`, [w.id, dir, date]);
    return out({ cancelled: r.length }, () => `  ${r.length} flight cancelled.`);
  }
  const s = await swingNear(w, date);
  const home = str(flags.from) || (dir === 'in' ? w.home_port : s?.airport);
  const away = str(flags.to) || (dir === 'in' ? s?.airport : w.home_port);
  await db.query(`insert into flights (worker_id, job_id, direction, flight_date, from_port, to_port, flight_no, booking_ref) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (worker_id, direction, flight_date) do update set from_port = excluded.from_port, to_port = excluded.to_port, flight_no = excluded.flight_no, booking_ref = excluded.booking_ref, status = 'booked'`,
  [w.id, s?.job_id || null, dir, date, home || null, away || null, str(flags.flight) || null, str(flags.ref) || null]);
  out({ worker: w.code, direction: dir, date, from: home, to: away, job: s?.job || null }, () => `  ${w.full_name} flies ${dir} ${date}${home ? ` ${home} to ${away}` : ''}${flags.flight ? ` on ${flags.flight}` : ''}${s ? ` for ${s.job}` : ''}.`);
}

async function rooms(flags) {
  const ahead = intFlag(flags.days, 14);
  const booked = await db.query(`select r.check_in, r.check_out, w.code as worker_code, w.full_name as worker, s.code as site, s.camp, r.room
    from rooms r join workers w on w.id = r.worker_id join sites s on s.id = r.site_id
    where r.status = 'booked' and r.check_out >= current_date and r.check_in <= current_date + $1::int order by s.code, r.check_in, w.code`, [ahead]);
  const missing = (await swingRows(ahead)).filter((s) => !s.room).map((s) => ({ worker_code: s.worker_code, worker: s.worker, job: s.job, site: s.site, from: isoDate(s.start_on), to: isoDate(s.end_on) }));
  out({ booked, missing }, () => [
    heading(`Camp rooms, next ${ahead} days`),
    table(booked, [{ key: 'site', label: 'site' }, { key: 'camp', label: 'camp' }, { key: 'room', label: 'room' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'check_in', label: 'in', format: isoDate }, { key: 'check_out', label: 'out', format: isoDate }]),
    '', '  Swings with no room', table(missing, [{ key: 'site', label: 'site' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'from', label: 'from' }, { key: 'to', label: 'to' }]),
  ].join('\n'));
}

async function room(args, flags) {
  const w = await findWorker(args[0]);
  const checkIn = parseDate(flags.in);
  if (!checkIn) throw new CliError('Check in when? --in=YYYY-MM-DD --out=YYYY-MM-DD');
  const s = await swingNear(w, checkIn);
  const checkOut = parseDate(flags.out) || (s ? isoDate(s.end_on) : null);
  if (!checkOut) throw new CliError('Check out when? --out=YYYY-MM-DD');
  const site = flags.site ? await findSite(flags.site) : s ? { id: s.site_id } : null;
  if (!site) throw new CliError('Which site? --site=WIR (no swing found near that date).');
  await db.query(`insert into rooms (worker_id, site_id, room, check_in, check_out) values ($1,$2,$3,$4,$5)
    on conflict (worker_id, site_id, check_in) do update set room = excluded.room, check_out = excluded.check_out, status = 'booked'`, [w.id, site.id, str(flags.room) || null, checkIn, checkOut]);
  out({ worker: w.code, check_in: checkIn, check_out: checkOut, room: str(flags.room) || null }, () => `  Room${flags.room ? ' ' + flags.room : ''} booked for ${w.full_name}, ${checkIn} to ${checkOut}.`);
}

// ---------------------------------------------------------------- timesheets

async function timesheet(args, flags) {
  const w = await findWorker(args[0]);
  const date = parseDate(flags.date);
  if (!date) throw new CliError('Which shift? --date=YYYY-MM-DD');
  const start = parseTime(flags.start, 'Start');
  const end = parseTime(flags.end, 'End');
  const brk = intFlag(flags.break, 30);
  const span = (toMin(end) - toMin(start) + 1440) % 1440 || 1440;
  const worked = span - brk;
  if (worked <= 0) throw new CliError('The break is longer than the shift.');
  const [s] = await db.query(`select s.*, j.code as job from shifts s join jobs j on j.id = s.job_id where s.worker_id = $1 and s.shift_date = $2`, [w.id, date]);
  if (!s) throw new CliError(`${w.full_name} was not rostered on ${date}. Roster the shift first, so the hours land on the right job.`);
  if (!['planned', 'confirmed'].includes(s.status)) throw new CliError(`That shift is ${s.status}. Nothing to record.`);
  const [existing] = await db.query(`select status from timesheets where shift_id = $1`, [s.id]);
  if (existing?.status === 'approved') throw new CliError('That timesheet is already approved. Ask the supervisor to reject it first if it is wrong.');
  await db.query(`insert into timesheets (shift_id, start_time, end_time, break_minutes, worked_minutes, status, submitted_on) values ($1,$2,$3,$4,$5,'submitted',current_date)
    on conflict (shift_id) do update set start_time = excluded.start_time, end_time = excluded.end_time, break_minutes = excluded.break_minutes, worked_minutes = excluded.worked_minutes, status = 'submitted', reject_reason = null, submitted_on = current_date`,
  [s.id, start, end, brk, worked]);
  const [f] = (await fatigueRows(date, date)).filter((r) => r.shift_id === s.id);
  const result = { worker: w.code, job: s.job, date, worked_minutes: worked, planned_minutes: s.planned_minutes, breaches: f?.breaches || [] };
  out(result, () => [
    `  ${w.full_name}, ${s.job} ${date}: ${start} to ${end}, ${brk} min break, ${hours(worked)} worked (${hours(s.planned_minutes)} planned). Waiting for approval.`,
    ...(f?.breaches || []).map((b) => `  Over a fatigue limit: ${b.rule} ${b.what}. Record why with the supervisor.`),
  ].join('\n'));
}

async function timesheets(flags) {
  const days = intFlag(flags.days, 14);
  const j = flags.job ? await findJob(flags.job) : null;
  const status = str(flags.status);
  const rows = await db.query(`select * from v_timesheets where shift_date >= current_date - $1::int and ($2 = '' or status = $2) and ($3::text is null or job = $3) order by shift_date, job, worker_code`, [days, status, j?.code || null]);
  const missing = (await missingTimesheets()).filter((m) => !j || m.job === j.code);
  out({ timesheets: rows, missing }, () => [
    heading(`Timesheets, last ${days} days${status ? ` (${status})` : ''}`),
    table(rows, [{ key: 'shift_date', label: 'date', format: isoDate }, { key: 'job', label: 'job' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'start_time', label: 'start', format: (v) => String(v).slice(0, 5) }, { key: 'end_time', label: 'end', format: (v) => String(v).slice(0, 5) }, { key: 'worked_minutes', label: 'worked', align: 'right', format: hours }, { key: 'status', label: 'status' }, { key: 'approved_by', label: 'approved by', format: (v) => v || '' }]),
    '', '  Shifts with no timesheet', table(missing, [{ key: 'shift_date', label: 'date', format: isoDate }, { key: 'job', label: 'job' }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'shift_kind', label: 'shift' }]),
  ].join('\n'));
}

async function approve(args, flags) {
  const by = str(flags.by);
  if (!by) throw new CliError('Who is approving? --by="Name". It goes on the timesheet.');
  const w = args[0] ? await findWorker(args[0]) : null;
  const j = flags.job ? await findJob(flags.job) : null;
  if (!w && !j) throw new CliError('Approve whose? Give a worker, or --job=J-201 for every submitted timesheet on a job.');
  const date = parseDate(flags.date);
  const rows = await db.query(`update timesheets t set status = 'approved', approved_by = $1, approved_on = current_date
    from shifts s where s.id = t.shift_id and t.status = 'submitted' and ($2::uuid is null or s.worker_id = $2) and ($3::uuid is null or s.job_id = $3) and ($4::date is null or s.shift_date = $4)
    returning t.id, t.worked_minutes`, [by, w?.id || null, j?.id || null, date]);
  out({ approved: rows.length, minutes: rows.reduce((a, r) => a + n(r.worked_minutes), 0) }, () => `  ${rows.length} timesheets approved by ${by}, ${hours(rows.reduce((a, r) => a + n(r.worked_minutes), 0))}.`);
}

async function reject(args, flags) {
  const w = await findWorker(args[0]);
  const date = parseDate(flags.date);
  if (!date || !str(flags.reason)) throw new CliError('roster reject <worker> --date=YYYY-MM-DD --reason="what to fix"');
  const rows = await db.query(`update timesheets t set status = 'rejected', reject_reason = $3, approved_by = null, approved_on = null
    from shifts s where s.id = t.shift_id and s.worker_id = $1 and s.shift_date = $2 and t.payroll_exported_on is null and t.invoiced_on is null returning t.id`, [w.id, date, str(flags.reason)]);
  if (!rows.length) throw new CliError('No timesheet to reject on that day (or it has already gone to payroll or an invoice).');
  out({ rejected: rows.length }, () => `  Rejected. ${w.full_name} fixes it and submits again.`);
}

async function hoursCmd(flags) {
  const days = intFlag(flags.days, 14);
  const by = ['job', 'site', 'client'].includes(str(flags.by)) ? str(flags.by) : 'job';
  const col = { job: 'j.code', site: 'si.code', client: 'c.name' }[by];
  const rows = await db.query(`
    select ${col} as ${by}, count(*)::int as shifts, sum(s.planned_minutes)::int as planned_minutes,
           coalesce(sum(t.worked_minutes) filter (where t.status in ('submitted','approved')), 0)::int as worked_minutes,
           coalesce(sum(t.worked_minutes) filter (where t.status = 'approved'), 0)::int as approved_minutes,
           count(*) filter (where t.id is null)::int as no_timesheet
    from shifts s join jobs j on j.id = s.job_id join sites si on si.id = j.site_id join clients c on c.id = si.client_id
    left join timesheets t on t.shift_id = s.id
    where s.status in ('planned','confirmed') and s.shift_date between current_date - $1::int and current_date - 1
    group by ${col} order by 1`, [days]);
  out(rows, () => heading(`Planned against worked, last ${days} days, by ${by}`) + '\n' + table(rows, [
    { key: by, label: by }, { key: 'shifts', label: 'shifts', align: 'right' }, { key: 'planned_minutes', label: 'planned', align: 'right', format: hours },
    { key: 'worked_minutes', label: 'worked', align: 'right', format: hours }, { key: 'approved_minutes', label: 'approved', align: 'right', format: hours },
    { key: 'no_timesheet', label: 'no timesheet', align: 'right' },
  ]));
}

async function billing(flags) {
  const j = flags.job ? await findJob(flags.job) : null;
  const rows = await db.query(`select job, job_name, client, count(*)::int as timesheets, sum(worked_minutes)::int as minutes, sum(value_cents)::bigint as value_cents,
      min(shift_date) as oldest, max(shift_date) as newest, count(*) filter (where rate_cents is null)::int as no_rate
    from v_timesheets where status = 'approved' and invoiced_on is null and ($1::text is null or job = $1) group by job, job_name, client order by min(shift_date)`, [j?.code || null]);
  const lines = j ? await db.query(`select trade, count(*)::int as shifts, sum(worked_minutes)::int as minutes, max(rate_cents) as rate_cents, sum(value_cents)::bigint as value_cents
    from v_timesheets where status = 'approved' and invoiced_on is null and job = $1 group by trade order by trade`, [j.code]) : [];
  out({ jobs: rows, lines }, () => [
    heading('Approved hours not yet invoiced'),
    table(rows, [{ key: 'job', label: 'job' }, { key: 'job_name', label: 'name' }, { key: 'client', label: 'client' }, { key: 'minutes', label: 'hours', align: 'right', format: hours }, { key: 'value_cents', label: 'value', align: 'right', format: aud }, { key: 'oldest', label: 'oldest', format: isoDate }, { key: 'newest', label: 'newest', format: isoDate }, { key: 'no_rate', label: 'no rate', align: 'right' }]),
    lines.length ? '\n  By trade\n' + table(lines, [{ key: 'trade', label: 'trade' }, { key: 'shifts', label: 'shifts', align: 'right' }, { key: 'minutes', label: 'hours', align: 'right', format: hours }, { key: 'rate_cents', label: 'rate', align: 'right', format: (v) => (v ? `${aud(v)}/h` : 'no rate') }, { key: 'value_cents', label: 'value', align: 'right', format: aud }]) : '',
    '', '  When the invoice is raised: roster invoiced <job> --to=<last day>',
  ].join('\n'));
}

async function invoiced(args, flags) {
  const j = await findJob(args[0]);
  const to = parseDate(flags.to) || addDays(today(), -1);
  const rows = await db.query(`update timesheets t set invoiced_on = current_date from shifts s
    where s.id = t.shift_id and s.job_id = $1 and t.status = 'approved' and t.invoiced_on is null and s.shift_date <= $2 returning t.worked_minutes`, [j.id, to]);
  if (str(flags.ref)) await db.query(`insert into notes (job_id, body) values ($1,$2)`, [j.id, `Invoiced to ${to}: ${flags.ref}`]);
  out({ job: j.code, to, timesheets: rows.length }, () => `  ${rows.length} timesheets on ${j.code} to ${to} marked invoiced.`);
}

async function payroll(flags) {
  const to = parseDate(flags.to) || addDays(today(), -1);
  const rows = await db.query(`select t.id, t.shift_date, t.worker_code, t.worker, t.job, t.site, t.start_time, t.end_time, t.break_minutes, t.worked_minutes
    from v_timesheets t where t.status = 'approved' and t.payroll_exported_on is null and t.employment = 'employee' and t.shift_date <= $1 order by t.worker_code, t.shift_date`, [to]);
  const byWorker = [...groupBy(rows, (r) => r.worker_code)].map(([code, list]) => ({ worker_code: code, worker: list[0].worker, shifts: list.length, minutes: list.reduce((a, r) => a + n(r.worked_minutes), 0) }));
  let file = null;
  if (flags.save && rows.length) {
    const dir = path.join(REPO_ROOT, 'exports');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    file = path.join(dir, `payroll-${to}.csv`);
    writeFileSync(file, ['Employee ID,Employee,Date,Job,Site,Start,End,Break (min),Hours', ...rows.map((r) => [r.worker_code, csvCell(r.worker), isoDate(r.shift_date), r.job, r.site, String(r.start_time).slice(0, 5), String(r.end_time).slice(0, 5), r.break_minutes, (n(r.worked_minutes) / 60).toFixed(2)].join(','))].join('\n') + '\n', { mode: 0o600 });
    await db.query(`update timesheets set payroll_exported_on = current_date where id = any($1::uuid[])`, [rows.map((r) => r.id)]);
  }
  out({ to, timesheets: rows.length, by_worker: byWorker, file: file && path.relative(REPO_ROOT, file) }, () => [
    heading(`Approved employee hours not yet sent to payroll, to ${to}`),
    table(byWorker, [{ key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'shifts', label: 'shifts', align: 'right' }, { key: 'minutes', label: 'hours', align: 'right', format: hours }]),
    file ? `\n  Written to ${path.relative(REPO_ROOT, file)} and marked as sent. Load it into your payroll system.` : rows.length ? '\n  Add --save to write the payroll file and mark these as sent.' : '',
    '  Labour hire and subcontractor hours are not here: their firms invoice you for them.',
  ].join('\n'));
}

async function providers() {
  const rows = await db.query(`select p.name, p.kind, p.abn, p.qld_licence_ref, p.insurance_expires_on, (p.insurance_expires_on - current_date) as insurance_days,
      (select count(*) from workers w where w.provider_id = p.id and w.active)::int as people,
      (select string_agg(distinct si.code, ', ') from shifts s join workers w on w.id = s.worker_id join jobs j on j.id = s.job_id join sites si on si.id = j.site_id
        where w.provider_id = p.id and s.shift_date >= current_date - 30 and s.status in ('planned','confirmed')) as sites
    from providers p order by p.name`);
  out(rows, () => heading('Labour hire firms and subcontractors') + '\n' + table(rows, [{ key: 'name', label: 'firm' }, { key: 'kind', label: 'kind' }, { key: 'people', label: 'people', align: 'right' }, { key: 'sites', label: 'sites', format: (v) => v || '' }, { key: 'qld_licence_ref', label: 'QLD licence', format: (v) => v || '-' }, { key: 'insurance_expires_on', label: 'insurance to', format: isoDate }]));
}

async function overrides(flags) {
  const days = intFlag(flags.days, 30);
  const rows = await db.query(`select e.at, w.code as worker_code, w.full_name as worker, j.code as job, e.shift_date, e.rule, e.reason, e.by_name
    from roster_events e left join workers w on w.id = e.worker_id left join jobs j on j.id = e.job_id where e.kind = 'override' and e.at >= now() - make_interval(days => $1::int) order by e.at desc`, [days]);
  out(rows, () => heading(`Overrides, last ${days} days`) + '\n' + table(rows, [{ key: 'at', label: 'when', format: (v) => isoDate(v) }, { key: 'worker_code', label: 'who' }, { key: 'worker', label: 'name' }, { key: 'job', label: 'job' }, { key: 'rule', label: 'rule' }, { key: 'reason', label: 'reason', format: (v) => v || '(none given)', width: 50 }, { key: 'by_name', label: 'approved by', format: (v) => v || '(nobody)' }]));
}

// ---------------------------------------------------------------- compliance and attention

const RULES = [
  { id: 'R1', rule: 'Site requirements met on every booked shift', source: 'Client and site access standards; Work Health and Safety Act 2020 (WA) s 19; Work Health and Safety Act 2011 (Qld) s 19' },
  { id: 'R2', rule: 'High risk work licence current for the role', source: 'Work Health and Safety (General) Regulations 2022 (WA) r 81; Work Health and Safety Regulation 2011 (Qld) s 81' },
  { id: 'R3', rule: 'Shift length inside the fatigue limit', source: 'Your fatigue management plan and the client\'s; WA Code of Practice: Working Hours (2006)' },
  { id: 'R4', rule: 'Rest between shifts', source: 'Your fatigue management plan and the client\'s; WA Code of Practice: Working Hours (2006)' },
  { id: 'R5', rule: 'Consecutive shifts inside the limit', source: 'Your fatigue management plan and the client\'s; WA Code of Practice: Working Hours (2006)' },
  { id: 'R6', rule: 'Hours in any 14 days inside the limit', source: 'Your fatigue management plan and the client\'s; WA Code of Practice: Working Hours (2006)' },
  { id: 'R7', rule: 'Hours recorded for every shift worked', source: 'Fair Work Act 2009 (Cth) s 535; Fair Work Regulations 2009 (Cth) reg 3.33' },
  { id: 'R8', rule: 'Labour hire firm licensed for Queensland work', source: 'Labour Hire Licensing Act 2017 (Qld) s 11' },
  { id: 'R9', rule: 'Every override has a reason and a name', source: 'Your own audit trail; the client\'s contractor management plan' },
];

async function complianceRows() {
  const from = addDays(today(), -LOOK_BACK_DAYS);
  const to = addDays(today(), LOOK_AHEAD_DAYS);
  const res = Object.fromEntries(RULES.map((r) => [r.id, { ...r, items: [], detail: [] }]));
  for (const f of await requirementFails(from, to)) {
    const id = f.kind === 'hrwl' ? 'R2' : 'R1';
    const lapse = f.expires_on ? `expired ${isoDate(f.expires_on)}` : 'none on file';
    res[id].items.push(`${f.worker_code} ${f.worker} on ${f.job} (${f.site}): ${f.credential} ${f.credential_name} ${lapse}, booked ${isoDate(f.first_day)} to ${isoDate(f.last_day)} (${f.shifts} shifts)${f.on_site_now ? ', ON SITE NOW' : ''}`);
    res[id].detail.push({ ...f, first_day: isoDate(f.first_day), last_day: isoDate(f.last_day), expires_on: f.expires_on && isoDate(f.expires_on) });
  }
  const fat = (await fatigueRows(from, addDays(today(), 28))).filter((r) => r.breaches.length);
  for (const id of ['R3', 'R4', 'R5', 'R6']) {
    const hits = fat.flatMap((r) => r.breaches.filter((b) => b.rule === id).map((b) => ({ ...r, what: b.what })));
    for (const [, list] of groupBy(hits, (h) => h.worker_code)) {
      res[id].items.push(`${list[0].worker_code} ${list[0].worker} on ${[...new Set(list.map((x) => x.job))].join(', ')}: ${list.map((x) => `${x.shift_date} ${x.what}`).join('; ')}`);
      res[id].detail.push({ worker_code: list[0].worker_code, shifts: list.map((x) => x.shift_date) });
    }
  }
  for (const [, list] of groupBy(await missingTimesheets(), (m) => m.worker_code)) {
    res.R7.items.push(`${list[0].worker_code} ${list[0].worker}: no timesheet for ${list.map((x) => `${x.job} ${isoDate(x.shift_date)}`).join(', ')}`);
    res.R7.detail.push({ worker_code: list[0].worker_code, dates: list.map((x) => isoDate(x.shift_date)) });
  }
  const lh = await db.query(`select w.code, w.full_name, p.name as provider, si.code as site, min(s.shift_date) as first_day, max(s.shift_date) as last_day
    from shifts s join workers w on w.id = s.worker_id join providers p on p.id = w.provider_id join jobs j on j.id = s.job_id join sites si on si.id = j.site_id
    where w.employment = 'labour-hire' and si.state = 'QLD' and p.qld_licence_ref is null and s.status in ('planned','confirmed') and s.shift_date between $1::date and $2::date
    group by w.code, w.full_name, p.name, si.code order by w.code`, [from, to]);
  for (const r of lh) { res.R8.items.push(`${r.code} ${r.full_name} supplied by ${r.provider} to ${r.site} (QLD), ${isoDate(r.first_day)} to ${isoDate(r.last_day)}: no Queensland labour hire licence recorded`); res.R8.detail.push(r); }
  const ov = await db.query(`select e.at, w.code, w.full_name, j.code as job, e.rule, e.reason, e.by_name from roster_events e left join workers w on w.id = e.worker_id left join jobs j on j.id = e.job_id
    where e.kind = 'override' and (coalesce(trim(e.reason), '') = '' or coalesce(trim(e.by_name), '') = '') order by e.at`);
  for (const r of ov) { res.R9.items.push(`${r.code} ${r.full_name} on ${r.job}: ${r.rule || 'a gate'} overridden ${isoDate(r.at)} with ${r.reason ? '' : 'no reason'}${!r.reason && !r.by_name ? ' and ' : ''}${r.by_name ? '' : 'nobody named'}`); res.R9.detail.push(r); }
  return RULES.map((r) => ({ ...res[r.id], count: res[r.id].items.length }));
}

async function compliance() {
  const rows = await complianceRows();
  out(rows, () => heading('Compliance: the roster against the rules') + '\n' + rows.map((r) => [
    `  ${r.id} ${r.rule}: ${r.count ? `${r.count} to fix` : 'clean'}`,
    ...r.items.map((i) => `     - ${i}`),
    `     source: ${r.source}`,
  ].join('\n')).join('\n\n') + '\n\n  A records check, not legal advice. The rules and sources are in docs/compliance.md.');
}

async function attention() {
  const items = [];
  const push = (rank, area, what, action) => items.push({ rank, area, what, action });
  const comp = Object.fromEntries((await complianceRows()).map((r) => [r.id, r]));

  for (const f of [...comp.R1.detail, ...comp.R2.detail]) {
    const rank = f.on_site_now ? 1 : 2;
    const lapse = f.expires_on ? `expired ${f.expires_on}` : 'none on file';
    push(rank, f.on_site_now ? 'on site now' : 'gates', `${f.worker_code} ${f.worker} on ${f.job}: ${f.credential} ${f.credential_name} ${lapse}, ${f.on_site_now ? 'rostered on site today' : `booked from ${f.first_day}`}`,
      f.on_site_now ? 'Stand them down or get the credential renewed today, and tell the client\'s site contact' : `Book the renewal before ${f.first_day}, or swap them out: roster fill ${f.job}`);
  }
  for (const i of comp.R8.items) push(1, 'labour hire', i, 'Ask the firm for its licence number before anyone mobilises, or book from a licensed firm');
  for (const id of ['R3', 'R4', 'R5', 'R6']) for (const i of comp[id].items) push(2, 'fatigue', `${id} ${i}`, id === 'R5' || id === 'R6' ? 'Give them a day off inside the run, or find cover' : 'Record why with the supervisor, and fix the roster so it does not repeat');
  for (const i of comp.R9.items) push(2, 'audit', i, 'Find out who let it through and record the reason');

  for (const s of await swingRows(14)) {
    const start = isoDate(s.start_on);
    const end = isoDate(s.end_on);
    const gaps = [];
    const fixes = [];
    if (s.travel_mode === 'FIFO' && !s.flight_in && start >= today()) { gaps.push(`no flight in from ${s.home_port || 'home'}`); fixes.push(`roster flight ${s.worker_code} --date=${addDays(start, -1)} --in`); }
    if (s.travel_mode === 'FIFO' && !s.flight_out) { gaps.push('no flight home'); fixes.push(`roster flight ${s.worker_code} --date=${end} --out`); }
    if (!s.room) { gaps.push('no camp room'); fixes.push(`roster room ${s.worker_code} --in=${start} --out=${end}`); }
    if (gaps.length) push(3, 'mobilisation', `${s.worker_code} ${s.worker}, ${s.job} ${start} to ${end}: ${gaps.join(', ')}`, `Book it: ${fixes.join(' ; ')}`);
  }
  const unconfirmed = await db.query(`select w.code, w.full_name, j.code as job, min(s.shift_date) as first_day, count(*)::int as shifts from shifts s join workers w on w.id = s.worker_id join jobs j on j.id = s.job_id
    where s.status = 'planned' and s.shift_date between current_date and current_date + $1::int group by w.code, w.full_name, j.code order by min(s.shift_date)`, [CONFIRM_DAYS]);
  for (const u of unconfirmed) push(3, 'mobilisation', `${u.code} ${u.full_name} has not confirmed their shifts on ${u.job} starting ${isoDate(u.first_day)}`, `Ring them, then: roster confirm ${u.code}`);

  for (const g of await coverageRows(21)) push(4, 'crew', `${g.job} ${g.job_name}: ${g.short} ${g.trade.toLowerCase()} short ${g.from === g.to ? `on ${g.from}` : `${g.from} to ${g.to} (${g.days} days)`}`, `Find someone: roster fill ${g.job} --trade="${g.trade}"`);

  for (const i of comp.R7.items) push(5, 'timesheets', i, 'Get the hours from the supervisor and enter them: roster timesheet <who> --date=..');
  const waiting = await db.query(`select job, count(*)::int as n, min(submitted_on) as oldest from v_timesheets where status = 'submitted' and submitted_on < current_date - $1::int group by job order by min(submitted_on)`, [APPROVAL_DAYS]);
  for (const w of waiting) push(5, 'timesheets', `${w.job}: ${w.n} timesheets waiting for approval since ${isoDate(w.oldest)}`, `Supervisor approves: roster approve --job=${w.job} --by="Name"`);

  const unbilled = await db.query(`select job, client, sum(value_cents)::bigint as cents, min(shift_date) as oldest from v_timesheets where status = 'approved' and invoiced_on is null group by job, client having min(shift_date) < current_date - $1::int order by min(shift_date)`, [INVOICE_DAYS]);
  for (const u of unbilled) push(6, 'money', `${u.job} ${u.client}: ${aud(u.cents)} of approved hours not invoiced, oldest ${isoDate(u.oldest)}`, `Invoice it, then: roster invoiced ${u.job} --to=<last day>`);
  const [pay] = await db.query(`select count(*)::int as n from v_timesheets where status = 'approved' and payroll_exported_on is null and employment = 'employee'`);
  if (pay.n) push(6, 'money', `${pay.n} approved employee timesheets not yet sent to payroll`, 'Before the pay run: roster payroll --save');

  const soon = await db.query(`select w.code, w.full_name, ct.code as cred, ct.name, c.expires_on from credentials c join workers w on w.id = c.worker_id join credential_types ct on ct.id = c.credential_type_id
    where w.active and c.expires_on between current_date and current_date + 30 order by c.expires_on`);
  const flagged = new Set([...comp.R1.detail, ...comp.R2.detail].map((f) => `${f.worker_code}|${f.credential}`));
  for (const s of soon.filter((x) => !flagged.has(`${x.code}|${x.cred}`))) push(7, 'credentials', `${s.code} ${s.full_name}: ${s.cred} ${s.name} expires ${isoDate(s.expires_on)}`, 'Book the renewal on their next days off');
  const ins = await db.query(`select name, insurance_expires_on from providers where insurance_expires_on < current_date + 60 order by insurance_expires_on`);
  for (const p of ins) push(7, 'credentials', `${p.name}: insurance certificate expires ${isoDate(p.insurance_expires_on)}`, 'Ask for the renewed certificate of currency');

  items.sort((a, b) => a.rank - b.rank);
  out(items, () => heading('Needs attention, worst first') + '\n' + (items.length ? items.map((i, k) => `${String(k + 1).padStart(3)}. [${i.area}] ${i.what}\n       -> ${i.action}`).join('\n') : '  Nothing. Everyone booked is cleared, rested, travelling and recorded.'));
}

// ---------------------------------------------------------------- import and export

// Humanz onboards from spreadsheets and exports report data as CSV. Columns are matched by name,
// case-insensitive, with the common variants of each header. Run with --dry-run first.
async function importCmd(args, flags) {
  const kind = String(args[0] || '').toLowerCase();
  const file = args[1];
  if (!['workers', 'credentials', 'shifts'].includes(kind)) throw new CliError('Usage: roster import <workers|credentials|shifts> <file.csv> [--dry-run]');
  if (!file || !existsSync(file)) throw new CliError(`No file at "${file}".`);
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const dry = !!flags['dry-run'];
  const summary = { kind, rows: rows.length, created: 0, updated: 0, skipped_existing: 0, problems: [] };
  await db.exec('BEGIN');
  try {
    for (const [i, r] of rows.entries()) {
      const line = i + 2;
      if (kind === 'workers') {
        const code = pick(r, 'Employee ID', 'Worker ID', 'Payroll ID', 'Code', 'ID');
        const name = pick(r, 'Full Name', 'Name', 'Worker') || [pick(r, 'First Name', 'Given Name'), pick(r, 'Last Name', 'Surname')].filter(Boolean).join(' ');
        if (!code || !name) { summary.problems.push(`row ${line}: no ID or name`); continue; }
        const typeRaw = pick(r, 'Employment Type', 'Type', 'Worker Type').toLowerCase();
        const employment = /sub/.test(typeRaw) ? 'subcontractor' : /hire|agency|labour/.test(typeRaw) ? 'labour-hire' : 'employee';
        const provName = pick(r, 'Company', 'Agency', 'Provider', 'Supplier');
        let providerId = null;
        if (provName && employment !== 'employee') {
          const [p] = await db.query(`insert into providers (name, kind) values ($1,$2) on conflict (name) do update set name = excluded.name returning id`, [provName, employment]);
          providerId = p.id;
        }
        const [ex] = await db.query(`select id from workers where lower(code) = lower($1)`, [code]);
        if (ex) { summary.skipped_existing++; continue; }
        await db.query(`insert into workers (code, full_name, trade, employment, provider_id, home_port, phone, email, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [code, name, pick(r, 'Trade', 'Position', 'Role', 'Job Title') || 'Unassigned', employment, providerId, pick(r, 'Home Port', 'Point of Hire', 'Departure Airport').toUpperCase().slice(0, 3) || null, pick(r, 'Mobile', 'Phone') || null, pick(r, 'Email') || null, pick(r, 'Humanz ID') || null]);
        summary.created++;
      } else if (kind === 'credentials') {
        const who = pick(r, 'Employee ID', 'Worker ID', 'Worker', 'Name', 'Full Name');
        const credName = pick(r, 'Credential', 'Competency', 'Licence', 'Qualification', 'Type');
        if (!who || !credName) { summary.problems.push(`row ${line}: no worker or credential`); continue; }
        const [w] = await db.query(`select id from workers where lower(code) = lower($1) or lower(full_name) = lower($1)`, [who]);
        if (!w) { summary.problems.push(`row ${line}: no worker "${who}" (import workers first)`); continue; }
        let [t] = await db.query(`select id from credential_types where lower(code) = lower($1) or lower(name) = lower($1)`, [credName]);
        if (!t) {
          const k = /induct/i.test(credName) ? 'induction' : /medical|drug/i.test(credName) ? 'medical' : /high risk|hrwl/i.test(credName) ? 'hrwl' : /voc|verification/i.test(credName) ? 'voc' : /licen[cs]e/i.test(credName) ? 'licence' : 'ticket';
          [t] = await db.query(`insert into credential_types (code, name, kind) values ($1,$1,$2) returning id`, [credName.slice(0, 40), k]);
        }
        let expires = null;
        const expRaw = pick(r, 'Expiry', 'Expiry Date', 'Expires', 'Valid To');
        if (expRaw) { try { expires = parseDate(expRaw); } catch { summary.problems.push(`row ${line}: expiry "${expRaw}" not understood`); continue; } }
        const [ex] = await db.query(`select id, expires_on from credentials where worker_id = $1 and credential_type_id = $2`, [w.id, t.id]);
        if (ex && (ex.expires_on ? isoDate(ex.expires_on) : null) === expires) { summary.skipped_existing++; continue; }
        await db.query(`insert into credentials (worker_id, credential_type_id, ref, expires_on) values ($1,$2,$3,$4) on conflict (worker_id, credential_type_id) do update set expires_on = excluded.expires_on, ref = coalesce(excluded.ref, credentials.ref)`,
          [w.id, t.id, pick(r, 'Number', 'Licence Number', 'Card Number', 'Reference') || null, expires]);
        ex ? summary.updated++ : summary.created++;
      } else {
        const who = pick(r, 'Employee ID', 'Worker ID', 'Worker', 'Name', 'Full Name');
        const dateRaw = pick(r, 'Date', 'Shift Date', 'Roster Date');
        const jobRef = pick(r, 'Job', 'Job Code', 'Project', 'Site');
        if (!who || !dateRaw || !jobRef) { summary.problems.push(`row ${line}: needs a worker, a date and a job`); continue; }
        let date;
        try { date = parseDate(dateRaw); } catch { summary.problems.push(`row ${line}: date "${dateRaw}" not understood`); continue; }
        const [w] = await db.query(`select id from workers where lower(code) = lower($1) or lower(full_name) = lower($1)`, [who]);
        if (!w) { summary.problems.push(`row ${line}: no worker "${who}"`); continue; }
        const [j] = await db.query(`select j.id from jobs j join sites s on s.id = j.site_id where lower(j.code) = lower($1) or lower(j.name) = lower($1) or lower(s.code) = lower($1) or lower(s.name) = lower($1) order by j.status = 'finished', j.starts_on desc limit 1`, [jobRef]);
        if (!j) { summary.problems.push(`row ${line}: no job or site "${jobRef}" (add it first)`); continue; }
        const [ex] = await db.query(`select id from shifts where worker_id = $1 and shift_date = $2`, [w.id, date]);
        if (ex) { summary.skipped_existing++; continue; }
        const shiftKind = /night|^n/i.test(pick(r, 'Shift', 'Shift Type')) ? 'night' : 'day';
        const hrs = Number(pick(r, 'Hours', 'Rostered Hours', 'Planned Hours') || 12);
        const status = /declin/i.test(pick(r, 'Status')) ? 'declined' : /confirm|accept/i.test(pick(r, 'Status')) ? 'confirmed' : 'planned';
        const [s] = await db.query(`insert into shifts (worker_id, job_id, shift_date, shift_kind, planned_minutes, status, external_ref) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [w.id, j.id, date, shiftKind, Math.round((Number.isFinite(hrs) ? hrs : 12) * 60), status, pick(r, 'Shift ID', 'ID') || null]);
        const st = pick(r, 'Start', 'Start Time', 'Actual Start');
        const en = pick(r, 'End', 'Finish', 'End Time', 'Actual End');
        if (st && en) {
          const brk = Number(pick(r, 'Break', 'Break (min)', 'Break Minutes') || 0);
          const span = (toMin(parseTime(en, 'End')) - toMin(parseTime(st, 'Start')) + 1440) % 1440 || 1440;
          const approved = /approv/i.test(pick(r, 'Timesheet Status', 'Approval'));
          await db.query(`insert into timesheets (shift_id, start_time, end_time, break_minutes, worked_minutes, status, submitted_on, approved_by, approved_on) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [s.id, parseTime(st, 'Start'), parseTime(en, 'End'), brk, span - brk, approved ? 'approved' : 'submitted', date, approved ? 'imported from Humanz' : null, approved ? date : null]);
        }
        summary.created++;
      }
    }
    await db.exec(dry ? 'ROLLBACK' : 'COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  summary.dry_run = dry;
  out(summary, () => [
    `  ${dry ? 'Dry run, nothing written: would import' : 'Imported'} ${summary.created} new ${kind}${summary.updated ? `, ${summary.updated} updated` : ''}, ${summary.skipped_existing} already here, from ${summary.rows} rows.`,
    summary.problems.length ? '  Not imported:\n' + summary.problems.map((x) => `    - ${x}`).join('\n') : '',
  ].filter(Boolean).join('\n'));
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCmd(flags) {
  const dir = path.resolve(REPO_ROOT, str(flags.out) || 'exports');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tables = ['clients', 'sites', 'swing_templates', 'fatigue_policies', 'credential_types', 'requirements', 'providers', 'workers', 'credentials',
    'jobs', 'job_roles', 'client_rates', 'assignments', 'shifts', 'flights', 'rooms', 'timesheets', 'roster_events', 'notes'];
  const counts = {};
  for (const t of tables) {
    const rows = await db.query(`select * from ${t} order by created_at, id`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    writeFileSync(path.join(dir, `${t}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n', { mode: 0o600 });
    counts[t] = rows.length;
  }
  out({ dir, counts }, () => `  Exported ${tables.length} tables to ${path.relative(REPO_ROOT, dir) || dir}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

async function log(args, flags) {
  const ref = args[0];
  const body = args.slice(1).join(' ').trim();
  if (!ref || !body) throw new CliError('roster log <job or worker> "note text"');
  let j = null, w = null;
  try { j = await findJob(ref); } catch { w = await findWorker(ref); }
  await db.query(`insert into notes (job_id, worker_id, body, author) values ($1,$2,$3,$4)`, [j?.id || null, w?.id || null, body, str(flags.by) || null]);
  out({ job: j?.code || null, worker: w?.code || null, body }, () => `  Noted on ${j ? j.code : w.code}.`);
}

// ---------------------------------------------------------------- dispatch table

const HELP = `roster: the FIFO crew rostering CLI. Add --json to any read for machine output.

  Overview      stats | attention | compliance
  Roster        board [--days=14] [--from=date] [--job=j] | swings [--days=21] [--worker=w] [--job=j] [--missing] | changeover [--date=..]
                coverage [--days=28] [--job=j] | fill <job> [--trade=..] [--from --to] | check <worker> <job> [--from --to]
                assign <worker> <job> --swing=2/1 --start=date [--end=date|--weeks=8] [--panel=A] [--night] [--override=".." --by=".."]
                end <worker> <job> --from=date [--reason=..] | confirm <worker> [--from --to] | decline <worker> --date=.. [--to=..] --reason=..
  People        workers [--trade=..] [--type=employee|labour-hire|subcontractor] [--all] | worker <w> | providers
                credentials [--days=60] [--worker=w] | credential <worker> <type> --expires=date|never [--ref=..] | credential-types
  Sites, jobs   sites | jobs [--all] | job <j> | log <job|worker> "note"
  Fatigue       fatigue [--days=14] | overrides [--days=30]
  Travel        flights [--days=14] | flight <worker> --date=.. [--in|--out] [--flight=QF1930] [--ref=..] [--from --to] [--cancel]
                rooms [--days=14] | room <worker> --in=date [--out=date] [--room=B-14] [--site=WIR]
  Hours         timesheet <worker> --date=.. --start=06:00 --end=18:00 [--break=30] | timesheets [--days=14] [--status=..] [--job=j]
                approve <worker> [--date=..] --by=".." | approve --job=j --by=".." | reject <worker> --date=.. --reason=..
                hours [--days=14] [--by=job|site|client] | billing [--job=j] | invoiced <job> --to=date [--ref=..] | payroll [--to=date] [--save]
  Data          import <workers|credentials|shifts> <file.csv> [--dry-run] | export [--out=dir]`;

const COMMANDS = {
  stats: () => stats(), attention: () => attention(), compliance: () => compliance(),
  board: (a, f) => board(f), swings: (a, f) => swings(f), changeover: (a, f) => changeover(f), coverage: (a, f) => coverage(f), fill: (a, f) => fill(a, f),
  check: (a, f) => check(a, f), assign: (a, f) => assign(a, f), end: (a, f) => endCmd(a, f), confirm: (a, f) => confirm(a, f), decline: (a, f) => decline(a, f),
  workers: (a, f) => workers(f), worker: (a) => worker(a), providers: () => providers(), credentials: (a, f) => credentials(f), credential: (a, f) => credential(a, f),
  'credential-types': () => credentialTypes(), sites: () => sites(), jobs: (a, f) => jobs(f), job: (a) => job(a), log: (a, f) => log(a, f),
  fatigue: (a, f) => fatigue(f), overrides: (a, f) => overrides(f), flights: (a, f) => flights(f), flight: (a, f) => flight(a, f), rooms: (a, f) => rooms(f), room: (a, f) => room(a, f),
  timesheet: (a, f) => timesheet(a, f), timesheets: (a, f) => timesheets(f), approve: (a, f) => approve(a, f), reject: (a, f) => reject(a, f),
  hours: (a, f) => hoursCmd(f), billing: (a, f) => billing(f), invoiced: (a, f) => invoiced(a, f), payroll: (a, f) => payroll(f),
  import: (a, f) => importCmd(a, f), export: (a, f) => exportCmd(f),
};

const { args, flags } = parseArgv(process.argv.slice(2));
JSON_OUT = !!flags.json;
const cmd = args.shift();
if (!cmd || cmd === 'help' || flags.help || !COMMANDS[cmd]) {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' && !COMMANDS[cmd] ? 1 : 0);
}
db = await getDb();
try {
  await COMMANDS[cmd](args, flags);
} catch (e) {
  if (e instanceof CliError) { console.error(e.message); process.exitCode = e.code; }
  else { console.error(e.stack || e.message); process.exitCode = 2; }
} finally {
  await db.close();
}
