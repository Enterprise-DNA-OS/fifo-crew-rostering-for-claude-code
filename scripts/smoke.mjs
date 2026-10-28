#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database: migrate, seed, then every command
// that matters, asserting on the JSON. Passes on Windows and Linux. No network, no Postgres install.
// TEST_DATABASE_URL runs the same test against a real Postgres (CI does this).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'roster-smoke-'));
const outDir = path.join(dataDir, 'out');
const env = { ...process.env, DATA_DIR: dataDir, OUTPUT_DIR: outDir };
delete env.DATABASE_URL;
if (process.env.TEST_DATABASE_URL) env.DATABASE_URL = process.env.TEST_DATABASE_URL;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try { return JSON.parse(res.stdout); } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}
function assert(cond, msg) { if (!cond) { console.error(`\nFAIL assertion: ${msg}`); process.exit(1); } }
const n = (v) => Number(v ?? 0);
const R = (...a) => ['roster.mjs', ...a];
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const counts = (comp) => Object.fromEntries(comp.map((x) => [x.id, x.count]));

console.log(`smoke: ${env.DATABASE_URL ? 'Postgres' : 'embedded database in ' + dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the overview
  const stats = run('stats', R('stats'));
  assert(stats.workers === 17 && stats.live_jobs === 3 && stats.on_site_today === 5, `17 people, 3 live jobs, 5 on shift today (${JSON.stringify(stats)})`);
  assert(stats.coverage_gaps === 2, 'two crew gaps');

  const comp = run('compliance', R('compliance'));
  const c = counts(comp);
  assert(c.R1 === 4 && c.R2 === 1 && c.R3 === 1 && c.R4 === 1 && c.R5 === 1 && c.R6 === 1 && c.R7 === 2 && c.R8 === 2 && c.R9 === 1, `compliance counts ${JSON.stringify(c)}`);
  assert(comp[0].items[0].includes('W03') && comp[0].items[0].includes('ON SITE NOW'), 'the lapsed induction on site now leads R1');
  const att = run('attention', R('attention'));
  assert(att[0].area === 'on site now' && /W03/.test(att[0].what), 'the fitter on site with a lapsed induction leads');
  assert(att.some((a) => a.area === 'labour hire' && /W10/.test(a.what)), 'unlicensed labour hire in QLD');
  assert(att.some((a) => a.area === 'mobilisation' && /W13/.test(a.what) && /no flight in/.test(a.what)), 'missing flights');
  assert(att.some((a) => a.area === 'crew' && /J-203/.test(a.what) && /2 fitter/.test(a.what)), 'shutdown two fitters short');
  assert(att.some((a) => a.area === 'money' && /J-198/.test(a.what)), 'approved shutdown hours not invoiced');

  // ---- the roster
  const board = run('board', R('board', '--days=10', '--job=J-201'));
  const tom = board.rows.find((r) => r.worker_code === 'W01');
  assert(tom.days[day(3)] === 'x' && tom.days[day(0)] === 'D', 'declined days show on the board');
  assert(board.rows.find((r) => r.worker_code === 'W03').days[day(0)] === '!', 'not cleared shows on the board');
  const sw = run('swings', R('swings', '--days=14'));
  const josh = sw.find((s) => s.worker_code === 'W10' && s.job === 'J-203');
  assert(josh.issues.includes('no flight in') && josh.issues.includes('no room'), 'swing mobilisation check');
  assert(sw.find((s) => s.worker_code === 'W12').issues.length === 0, 'Karen ready to go');
  const co = run('changeover', R('changeover', `--date=${day(9)}`));
  assert(co.starting.length === 6 && co.flights.some((f) => f.worker_code === 'W14'), 'shutdown mobilisation day');
  const gaps = run('coverage', R('coverage'));
  assert(gaps.length === 2 && gaps.find((g) => g.job === 'J-203').short === 2 && gaps.find((g) => g.job === 'J-203').days === 10, 'two gaps, shutdown 2 short for 10 days');
  const fill = run('fill', R('fill', 'J-203', '--trade=Fitter'));
  assert(fill.candidates.slice(0, 2).map((x) => x.code).sort().join() === 'W15,W17' && fill.candidates.slice(0, 2).every((x) => x.verdict === 'ready'), 'two ready fitters');
  assert(fill.candidates.find((x) => x.code === 'W16').missing.join() === 'S11', 'Pete needs the coal induction');
  const fill201 = run('fill a declined gap', R('fill', 'J-201'));
  assert(fill201.candidates.find((x) => x.code === 'W01').verdict.includes('declined'), 'the person who declined is not offered');
  assert(fill201.candidates.find((x) => x.code === 'W02').on_break, 'someone on R&R is flagged');
  const chk = run('check not cleared', R('check', 'W16', 'J-203'));
  assert(!chk.ok && chk.missing[0].code === 'S11', 'check explains why');
  run('ambiguous worker lists and exits 1', R('worker', 'Kelly'), { json: false, expectFail: true });

  // ---- gates on booking
  run('booking someone not cleared is refused', R('assign', 'W16', 'J-203', '--swing=SD10', `--start=${day(9)}`), { json: false, expectFail: true });
  run('credential added', R('credential', 'W16', 'S11', '--expires=+900', '--ref=S11-44120'));
  const a16 = run('assign W16 to the shutdown', R('assign', 'W16', 'J-203', '--swing=SD10', `--start=${day(9)}`, '--by=Dan Price'));
  assert(a16.shifts === 10 && a16.overrides.length === 0, 'ten shutdown shifts, no override');
  run('double booking is refused', R('assign', 'W16', 'J-202', '--swing=8/6', `--start=${day(12)}`, '--override=x', '--by=x'), { json: false, expectFail: true });
  run('assign W15 to the shutdown', R('assign', 'W15', 'J-203', '--swing=SD10', `--start=${day(9)}`));
  run('a declined day cannot be booked over', R('assign', 'W01', 'J-201', '--swing=2/1', `--start=${day(3)}`, `--end=${day(5)}`), { json: false, expectFail: true });
  run('cover the declined days', R('assign', 'W11', 'J-201', '--swing=2/1', `--start=${day(3)}`, `--end=${day(5)}`));
  assert(run('no gaps left', R('coverage')).length === 0, 'every gap filled');
  run('override without a name is refused', R('assign', 'W13', 'J-201', '--swing=2/1', `--start=${day(20)}`, `--end=${day(24)}`, '--override=Short notice'), { json: false, expectFail: true });
  const ov = run('override with a reason and a name', R('assign', 'W13', 'J-201', '--swing=2/1', `--start=${day(20)}`, `--end=${day(24)}`, '--override=Induction booked for day one', '--by=Dan Price'));
  assert(ov.overrides.length === 2, `two gates overridden and logged (${JSON.stringify(ov.overrides)})`);
  assert(run('overrides', R('overrides')).filter((o) => o.by_name === 'Dan Price').length === 3, 'overrides on the audit trail');
  run('fatigue gate on booking', R('assign', 'W07', 'J-202', '--swing=2/1', `--start=${day(4)}`, `--end=${day(6)}`), { json: false, expectFail: true });

  // ---- confirm, decline, end
  run('decline', R('decline', 'W12', `--date=${day(10)}`, '--reason=Medical appointment'));
  assert(run('supervisor gap', R('coverage')).some((g) => g.trade === 'Supervisor' && g.from === day(10)), 'a decline opens a gap');
  run('decline without a reason is refused', R('decline', 'W12', `--date=${day(11)}`), { json: false, expectFail: true });
  run('confirm the day back', R('confirm', 'W12', `--from=${day(10)}`, `--to=${day(10)}`));
  run('confirm W13', R('confirm', 'W13'));
  run('confirm W14', R('confirm', 'W14'));
  assert(!run('attention after confirming', R('attention')).some((a) => /has not confirmed/.test(a.what) && /W1[34]/.test(a.what)), 'confirmations cleared');
  const ended = run('end the rigger', R('end', 'W14', 'J-203', `--from=${day(9)}`, '--reason=Licence lapses mid shutdown'));
  assert(ended.cancelled === 10, 'ten shifts cancelled');
  assert(run('rigger gap', R('coverage', '--job=J-203')).some((g) => g.trade === 'Rigger' && g.short === 1), 'ending a booking opens the gap');

  // ---- credentials and fatigue
  const creds = run('credentials', R('credentials', '--days=30'));
  assert(creds.find((x) => x.worker_code === 'W02' && x.code === 'MED').booked_after_expiry, 'booked past the expiry');
  run('renew the induction', R('credential', 'W03', 'IND-WIR', '--expires=+700', '--ref=WIR-88213'));
  const comp2 = counts(run('compliance after fixes', R('compliance')));
  assert(comp2.R1 === 5 && comp2.R2 === 0, `induction renewed (minus 1), the overridden booking (plus 2) and the rigger off (${JSON.stringify(comp2)})`);
  assert(run('attention after renewing', R('attention'))[0].area !== 'on site now', 'nobody on site uncleared');
  const fat = run('fatigue', R('fatigue'));
  assert(fat.some((f) => f.worker_code === 'W08' && f.breaches[0].rule === 'R4') && fat.some((f) => f.worker_code === 'W07'), 'fatigue breaches');

  // ---- mobilisation
  const fl = run('book a flight home', R('flight', 'W03', `--date=${day(6)}`, '--out', '--flight=QF1931', '--ref=RW2K9P'));
  assert(fl.from === 'PBO' && fl.to === 'PER' && fl.job === 'J-201', 'ports from the site and home');
  const rm = run('book a room', R('room', 'W02', `--in=${day(7)}`, '--room=B-16'));
  assert(rm.check_out === day(20), 'check out from the swing');
  const fls = run('flights', R('flights'));
  assert(fls.missing.some((m) => m.worker_code === 'W10') && !fls.missing.some((m) => m.worker_code === 'W03' && m.needed_on === day(6)), 'flights missing list');
  run('rooms', R('rooms'));

  // ---- timesheets
  const ts = run('enter a timesheet', R('timesheet', 'W03', `--date=${day(-2)}`, '--start=06:00', '--end=18:00', '--break=30'));
  assert(ts.worked_minutes === 690, '11.5 hours worked');
  const long = run('a long shift is flagged', R('timesheet', 'W03', `--date=${day(-3)}`, '--start=0500', '--end=19:30'));
  assert(long.breaches.some((b) => b.rule === 'R3'), 'long shift flagged on entry');
  run('a night shift across midnight', R('timesheet', 'W08', `--date=${day(-4)}`, '--start=18:00', '--end=06:15'));
  run('no shift that day is refused', R('timesheet', 'W16', `--date=${day(-1)}`, '--start=06:00', '--end=18:00'), { json: false, expectFail: true });
  assert(counts(run('compliance after timesheets', R('compliance'))).R7 === 0, 'every shift has hours');
  run('approve without a name is refused', R('approve', '--job=J-198'), { json: false, expectFail: true });
  const ap = run('approve the shutdown', R('approve', '--job=J-198', '--by=Grace Tan (Mount Ida)'));
  assert(ap.approved === 7, `seven shutdown timesheets approved (${ap.approved})`);
  run('reject', R('reject', 'W03', `--date=${day(-3)}`, '--reason=Check the start time with the supervisor'));
  const tsl = run('timesheets', R('timesheets', '--status=rejected'));
  assert(tsl.timesheets.length === 1, 'one rejected');
  const hrs = run('planned against worked', R('hours', '--by=client'));
  assert(hrs.length === 2 && hrs.every((h) => h.worked_minutes > 0), 'hours by client (the Queensland shutdown has not started)');
  const bill = run('billing', R('billing', '--job=J-198'));
  assert(bill.jobs[0].timesheets === 28 && n(bill.jobs[0].value_cents) > 0, `28 shutdown timesheets to invoice (${bill.jobs[0]?.timesheets})`);
  const inv = run('invoiced', R('invoiced', 'J-198', `--to=${day(-6)}`, '--ref=INV-3321'));
  assert(inv.timesheets === 28, 'marked invoiced');
  assert(run('nothing left to invoice', R('billing', '--job=J-198')).jobs.length === 0, 'not invoiced twice');
  const pay = run('payroll', R('payroll', '--save'));
  assert(pay.timesheets > 0 && pay.file, 'payroll file written');
  assert(readFileSync(path.join(root, pay.file), 'utf8').startsWith('Employee ID,'), 'payroll CSV');
  rmSync(path.join(root, pay.file));
  assert(run('payroll again', R('payroll')).timesheets === 0, 'not sent to payroll twice');

  // ---- reads
  run('workers', R('workers'));
  assert(run('labour hire only', R('workers', '--type=labour-hire')).length === 5, 'five labour hire');
  const wk = run('one worker', R('worker', 'W03'));
  assert(wk.credentials.length === 3 && wk.events.some((e) => e.kind === 'override'), 'worker card');
  run('sites', R('sites'));
  assert(run('jobs', R('jobs')).length === 3 && run('jobs --all', R('jobs', '--all')).length === 4, 'jobs');
  const jb = run('one job', R('job', 'dragline'));
  assert(jb.job.code === 'J-203' && jb.roles.length === 4, 'job card by name');
  run('providers', R('providers'));
  run('credential types', R('credential-types'));

  // ---- import from Humanz (or any roster spreadsheet)
  const wcsv = path.join(dataDir, 'workers.csv');
  writeFileSync(wcsv, ['Employee ID,First Name,Last Name,Position,Employment Type,Company,Point of Hire,Mobile,Email',
    'H-301,Sam,Rivers,Fitter,Labour hire,Fortitude Labour Hire,PER,0400 000 301,',
    'H-302,Jo,Kent,"Boilermaker, welder",Employee,,BNE,0400 000 302,jo@example.com',
    ',No,Id,Fitter,Employee,,,,'].join('\r\n'));
  const wd = run('import workers dry run', R('import', 'workers', wcsv, '--dry-run'));
  assert(wd.created === 2 && wd.problems.length === 1 && wd.dry_run, 'dry run counts and writes nothing');
  assert(run('still 17 after the dry run', R('workers')).length === 17, 'dry run wrote nothing');
  run('import workers', R('import', 'workers', wcsv));
  assert(run('import workers again', R('import', 'workers', wcsv)).skipped_existing === 2, 'idempotent');
  const ccsv = path.join(dataDir, 'creds.csv');
  writeFileSync(ccsv, ['Employee ID,Credential,Number,Expiry', `H-301,MED,M-1,${day(200).split('-').reverse().join('/')}`, 'H-301,IND-WIR,W-1,' + day(300), 'H-301,VOC-LV,V-1,' + day(300), 'H-302,Forklift licence,LF-9,', 'H-999,MED,x,'].join('\n'));
  const ci = run('import credentials', R('import', 'credentials', ccsv));
  assert(ci.created === 4 && ci.problems.length === 1, `credentials in, unknown worker reported (${JSON.stringify(ci)})`);
  assert(run('import credentials again', R('import', 'credentials', ccsv)).skipped_existing === 4, 'credentials idempotent');
  const scsv = path.join(dataDir, 'shifts.csv');
  writeFileSync(scsv, ['Employee ID,Date,Job,Shift,Hours,Status,Start,End,Break,Timesheet Status',
    `H-301,${day(-3)},J-201,Day,12,Confirmed,06:00,18:00,30,Approved`,
    `H-301,${day(-2)},Wirraway Hub,Day,12,Confirmed,06:00,18:30,30,`,
    `H-301,${day(-1)},Nowhere,Day,12,Confirmed,,,,`].join('\n'));
  const si = run('import shifts', R('import', 'shifts', scsv));
  assert(si.created === 2 && si.problems.some((p) => /Nowhere/.test(p)), 'shifts in, unknown job reported');
  assert(run('import shifts again', R('import', 'shifts', scsv)).skipped_existing === 2, 'shifts idempotent');
  const hs = run('imported hours', R('timesheets', '--days=4', '--job=J-201'));
  assert(hs.timesheets.some((t) => t.worker_code === 'H-301' && t.status === 'approved' && t.worked_minutes === 690), 'imported timesheet');

  // ---- export, views, docs, log
  const exp = run('export', R('export', `--out=${path.join(dataDir, 'export')}`));
  assert(exp.counts.shifts > 400 && existsSync(path.join(dataDir, 'export', 'timesheets.csv')), 'export writes every table');
  run('views', ['view.mjs'], { json: false });
  assert(readdirSync(path.join(outDir, 'views')).length === 3, 'three views');
  run('documents', ['docs.mjs'], { json: false });
  assert(readdirSync(path.join(outDir, 'docs-out', 'crew-pack')).some((f) => f.includes('J-203')), 'the shutdown crew pack renders');
  assert(readdirSync(path.join(outDir, 'docs-out', 'itinerary')).every((f) => !/[|:<>"?*]/.test(f)), 'file names are safe on Windows');
  run('log a note', R('log', 'J-203', 'Mick confirmed the crane is on site day one', '--by=Dan'));
  run('help', ['roster.mjs', 'help'], { json: false });
  run('unknown command exits 1', ['roster.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\nPASS: ${step} steps`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
