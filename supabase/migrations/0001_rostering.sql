-- FIFO Crew Rostering for Claude Code: the schema.
-- What a mining services contractor runs its FIFO and DIDO crews on: clients and their sites, swing
-- templates, jobs (ongoing maintenance and shutdowns) with the crew each needs, workers (employees,
-- labour hire and subcontractors), their credentials with expiry, each client's and site's entry
-- requirements, fatigue policies at business, client and site level, the roster (one shift per
-- worker per day), flights and camp rooms, timesheets, and an audit trail of every override.
-- Plain Postgres. Runs the same on PGlite. Money is integer cents, time is minutes.

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  contact_email text,
  abn text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  client_id uuid not null references clients(id),
  region text,
  state text not null default 'WA' check (state in ('WA', 'QLD', 'NSW', 'NT', 'SA', 'VIC', 'TAS')),
  travel_mode text not null default 'FIFO' check (travel_mode in ('FIFO', 'DIDO', 'BIBO')),
  airport text,                          -- the airstrip crews fly into
  camp text,
  day_start time not null default '06:00',
  night_start time not null default '18:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A swing pattern: 2/1 is 14 on, 7 off; 8/6 is 8 on, 6 off; a shutdown is N on, then done.
create table if not exists swing_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  days_on int not null check (days_on > 0),
  days_off int not null check (days_off >= 0),
  shift_minutes int not null default 720,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fatigue rules. The strictest applying rule wins for every shift: business, then the client, then the site.
create table if not exists fatigue_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  level text not null check (level in ('business', 'client', 'site')),
  client_id uuid references clients(id),
  site_id uuid references sites(id),
  max_shift_minutes int,
  min_rest_minutes int,
  max_consecutive int,
  max_14d_minutes int,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((level = 'business' and client_id is null and site_id is null) or (level = 'client' and client_id is not null and site_id is null) or (level = 'site' and site_id is not null))
);

create table if not exists credential_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('induction', 'medical', 'hrwl', 'voc', 'licence', 'ticket', 'other')),
  site_id uuid references sites(id),     -- a site induction belongs to one site
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What a worker needs on file, current, to be booked at a client's sites or one site.
create table if not exists requirements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  site_id uuid references sites(id),
  credential_type_id uuid not null references credential_types(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((client_id is null) <> (site_id is null)),
  unique (client_id, site_id, credential_type_id)
);

-- Labour hire firms and subcontractors who supply people.
create table if not exists providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('labour-hire', 'subcontractor')),
  abn text,
  contact_email text,
  qld_licence_ref text,                  -- Queensland labour hire licence number
  insurance_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  trade text not null,
  employment text not null default 'employee' check (employment in ('employee', 'labour-hire', 'subcontractor')),
  provider_id uuid references providers(id),
  home_port text,                        -- the airport they fly out of
  phone text,
  email text,
  active boolean not null default true,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One current record per worker and credential type. Renewing replaces the dates.
create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  credential_type_id uuid not null references credential_types(id),
  ref text,
  issued_on date,
  expires_on date,                       -- null means it does not expire
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, credential_type_id)
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  site_id uuid not null references sites(id),
  name text not null,
  kind text not null default 'ongoing' check (kind in ('ongoing', 'shutdown')),
  po_ref text,
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('planned', 'active', 'finished')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The crew a job needs on site each day, by trade, and the ticket that trade must hold on this job.
create table if not exists job_roles (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  trade text not null,
  headcount int not null check (headcount > 0),
  credential_type_id uuid references credential_types(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, trade)
);

-- The hourly rate the client pays for each trade.
create table if not exists client_rates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  trade text not null,
  rate_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, trade)
);

-- A worker put on a job on a swing pattern. Its shifts are written into `shifts`.
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id),
  job_id uuid not null references jobs(id),
  template_id uuid not null references swing_templates(id),
  panel text,
  shift_kind text not null default 'day' check (shift_kind in ('day', 'night')),
  start_on date not null,
  end_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The roster: one row per worker per rostered day.
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id),
  job_id uuid not null references jobs(id),
  assignment_id uuid references assignments(id),
  shift_date date not null,
  shift_kind text not null default 'day' check (shift_kind in ('day', 'night')),
  planned_minutes int not null default 720,
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'declined', 'cancelled')),
  confirmed_at timestamptz,
  decline_reason text,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, shift_date)
);
create index if not exists shifts_job_date on shifts (job_id, shift_date);

create table if not exists flights (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id),
  job_id uuid references jobs(id),
  direction text not null check (direction in ('in', 'out')),
  flight_date date not null,
  from_port text,
  to_port text,
  flight_no text,
  booking_ref text,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, direction, flight_date)
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id),
  site_id uuid not null references sites(id),
  room text,
  check_in date not null,
  check_out date not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, site_id, check_in),
  check (check_out >= check_in)
);

create table if not exists timesheets (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references shifts(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0,
  worked_minutes int not null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  submitted_on date not null default current_date,
  approved_by text,
  approved_on date,
  reject_reason text,
  payroll_exported_on date,
  invoiced_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The audit trail: every override of a gate, every decline, who and why.
create table if not exists roster_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  worker_id uuid references workers(id),
  job_id uuid references jobs(id),
  shift_date date,
  kind text not null check (kind in ('override', 'decline', 'cancel', 'assign')),
  rule text,
  reason text,
  by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  worker_id uuid references workers(id),
  body text not null,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients','sites','swing_templates','fatigue_policies','credential_types','requirements','providers','workers',
    'credentials','jobs','job_roles','client_rates','assignments','shifts','flights','rooms','timesheets','roster_events','notes'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- views

-- Every shift with its real start, length and end: the timesheet when there is one, else the plan.
create or replace view v_shift_times as
select s.id as shift_id, s.worker_id, s.job_id, j.site_id, si.client_id, s.shift_date, s.shift_kind, s.status,
       s.planned_minutes, t.id as timesheet_id, t.status as timesheet_status, t.worked_minutes,
       coalesce(t.worked_minutes + t.break_minutes, s.planned_minutes) as minutes,
       s.shift_date + coalesce(t.start_time, case when s.shift_kind = 'night' then si.night_start else si.day_start end) as start_ts,
       s.shift_date + coalesce(t.start_time, case when s.shift_kind = 'night' then si.night_start else si.day_start end)
         + make_interval(mins => coalesce(t.worked_minutes + t.break_minutes, s.planned_minutes)) as end_ts
from shifts s
join jobs j on j.id = s.job_id
join sites si on si.id = j.site_id
left join timesheets t on t.shift_id = s.id
where s.status in ('planned', 'confirmed');

-- The strictest fatigue limit that applies to each shift.
create or replace view v_shift_limits as
select st.shift_id,
       min(p.max_shift_minutes) as max_shift_minutes,
       max(p.min_rest_minutes) as min_rest_minutes,
       min(p.max_consecutive) as max_consecutive,
       min(p.max_14d_minutes) as max_14d_minutes,
       string_agg(p.name, ', ' order by p.level) as policies
from v_shift_times st
join fatigue_policies p on p.level = 'business' or p.client_id = st.client_id or p.site_id = st.site_id
group by st.shift_id;

-- Each shift with the fatigue numbers: length, rest since the last shift, run of days, hours in 14 days.
create or replace view v_fatigue as
with base as (
  select st.*, lag(st.end_ts) over (partition by st.worker_id order by st.start_ts) as prev_end,
         st.shift_date - (row_number() over (partition by st.worker_id order by st.shift_date))::int as run_key
  from v_shift_times st
)
select b.shift_id, b.worker_id, b.job_id, b.site_id, b.shift_date, b.shift_kind, b.minutes,
       case when b.prev_end is null then null else (extract(epoch from (b.start_ts - b.prev_end)) / 60)::int end as rest_minutes,
       row_number() over (partition by b.worker_id, b.run_key order by b.shift_date) as consecutive,
       (select sum(x.minutes) from v_shift_times x where x.worker_id = b.worker_id and x.shift_date between b.shift_date - 13 and b.shift_date) as minutes_14d,
       l.max_shift_minutes, l.min_rest_minutes, l.max_consecutive, l.max_14d_minutes, l.policies
from base b
left join v_shift_limits l on l.shift_id = b.shift_id;

-- Swings: each unbroken run of rostered days for a worker on one job.
create or replace view v_swings as
with s as (
  select s.worker_id, s.job_id, s.shift_date, s.shift_kind, s.status,
         s.shift_date - (row_number() over (partition by s.worker_id, s.job_id order by s.shift_date))::int as grp
  from shifts s where s.status <> 'cancelled'
)
select s.worker_id, s.job_id, min(s.shift_date) as start_on, max(s.shift_date) as end_on, count(*)::int as days,
       min(s.shift_kind) as shift_kind,
       count(*) filter (where s.status = 'confirmed')::int as confirmed_days,
       count(*) filter (where s.status = 'declined')::int as declined_days
from s group by s.worker_id, s.job_id, s.grp;

-- Every credential a rostered shift needs (client, site and the trade's ticket on that job), and whether
-- the worker holds it current on that day.
create or replace view v_shift_requirements as
with need as (
  select s.id as shift_id, s.worker_id, s.job_id, s.shift_date, r.credential_type_id, 'client' as why
  from shifts s join jobs j on j.id = s.job_id join sites si on si.id = j.site_id join requirements r on r.client_id = si.client_id
  where s.status in ('planned', 'confirmed')
  union
  select s.id, s.worker_id, s.job_id, s.shift_date, r.credential_type_id, 'site'
  from shifts s join jobs j on j.id = s.job_id join requirements r on r.site_id = j.site_id
  where s.status in ('planned', 'confirmed')
  union
  select s.id, s.worker_id, s.job_id, s.shift_date, jr.credential_type_id, 'role'
  from shifts s join workers w on w.id = s.worker_id join job_roles jr on jr.job_id = s.job_id and lower(jr.trade) = lower(w.trade)
  where s.status in ('planned', 'confirmed') and jr.credential_type_id is not null
)
select n.shift_id, n.worker_id, n.job_id, n.shift_date, n.why, ct.code as credential, ct.name as credential_name, ct.kind,
       c.expires_on, c.ref,
       (c.id is not null and (c.expires_on is null or c.expires_on >= n.shift_date)) as ok
from need n
join credential_types ct on ct.id = n.credential_type_id
left join credentials c on c.worker_id = n.worker_id and c.credential_type_id = n.credential_type_id;

-- Timesheets with the job, site, client, worker and what the hours are worth at the client's rate.
create or replace view v_timesheets as
select t.id, t.shift_id, s.shift_date, s.shift_kind, w.code as worker_code, w.full_name as worker, w.trade, w.employment,
       j.code as job, j.name as job_name, si.code as site, c.name as client, t.start_time, t.end_time, t.break_minutes,
       t.worked_minutes, s.planned_minutes, t.status, t.submitted_on, t.approved_by, t.approved_on, t.reject_reason,
       t.payroll_exported_on, t.invoiced_on, cr.rate_cents,
       round(t.worked_minutes * coalesce(cr.rate_cents, 0) / 60.0)::bigint as value_cents
from timesheets t
join shifts s on s.id = t.shift_id
join workers w on w.id = s.worker_id
join jobs j on j.id = s.job_id
join sites si on si.id = j.site_id
join clients c on c.id = si.client_id
left join client_rates cr on cr.client_id = c.id and lower(cr.trade) = lower(w.trade);
