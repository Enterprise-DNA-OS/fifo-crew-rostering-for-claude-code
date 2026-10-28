#!/usr/bin/env node
// Loads supabase/seed.sql: Redgum Diesel & Shutdown Pty Ltd, a fictional Perth mining services contractor
// with seventeen people on four jobs across three client sites, four weeks of roster history and eight
// weeks ahead. Dates are relative to today and every insert skips what is already there, so re-running
// it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  await db.exec(readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
  const [c] = await db.query(`
    select (select count(*) from sites) as sites, (select count(*) from jobs) as jobs, (select count(*) from workers) as workers,
           (select count(*) from credentials) as credentials, (select count(*) from shifts) as shifts, (select count(*) from flights) as flights,
           (select count(*) from rooms) as rooms, (select count(*) from timesheets) as timesheets`);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(`seed: ${n.sites} sites, ${n.jobs} jobs, ${n.workers} people, ${n.credentials} credentials, ${n.shifts} shifts, ${n.flights} flights, ${n.rooms} camp rooms, ${n.timesheets} timesheets`);
  } finally {
    await db.close();
  }
}
