-- Demo data: Redgum Diesel & Shutdown Pty Ltd, a fictional Welshpool (Perth) mining services contractor.
-- Seventeen people (employees, labour hire and subcontractors) across three client sites: fixed plant
-- maintenance in the Pilbara on 2/1 and 14/14 panels, mobile plant in the Goldfields on 8/6, a crusher
-- reline shutdown just finished, and a dragline shutdown in Queensland in nine days. Dates are relative
-- to today and every insert skips what is already there, so running it twice is harmless.
-- Problems are planted on purpose so /attention and /compliance have something to say: a fitter on site
-- now with a lapsed site induction (booked through an override nobody signed), a medical that runs out
-- mid-swing, a rigger whose rigging licence lapses during the shutdown, a labour hire firm with no
-- Queensland licence supplying two people to a Queensland site, a night-to-day swap with eight hours'
-- rest, a 14 hour shift, a fitter past the client's consecutive shift limit and the 14 day hours cap,
-- declined shifts that leave a gap, a shutdown two fitters short, missing flights and camp rooms,
-- shifts with no timesheet, timesheets waiting on approval, and approved hours not yet invoiced.

insert into clients (name, contact_name, contact_email, abn) values
  ('Mount Ida Iron Pty Ltd', 'Grace Tan', 'grace.tan@mountida.example', '41 612 330 918'),
  ('Coolabah Gold Ltd', 'Dean Hollis', 'dean.hollis@coolabahgold.example', '73 603 118 245'),
  ('Bowen Range Coal Pty Ltd', 'Mick Farrelly', 'mick.farrelly@bowenrange.example', '19 640 552 017')
on conflict (name) do nothing;

insert into sites (code, name, client_id, region, state, travel_mode, airport, camp)
select v.code, v.name, c.id, v.region, v.state, v.mode, v.airport, v.camp
from (values
  ('WIR', 'Wirraway Hub', 'Mount Ida Iron Pty Ltd', 'Pilbara', 'WA', 'FIFO', 'PBO', 'Wirraway Village'),
  ('CLB', 'Coolabah Mill', 'Coolabah Gold Ltd', 'Goldfields', 'WA', 'DIDO', null, 'Coolabah Camp'),
  ('BRC', 'Bowen Range North', 'Bowen Range Coal Pty Ltd', 'Bowen Basin', 'QLD', 'FIFO', 'MOV', 'Range Village')
) as v(code, name, client, region, state, mode, airport, camp)
join clients c on c.name = v.client
on conflict (code) do nothing;

insert into swing_templates (code, name, days_on, days_off, shift_minutes) values
  ('2/1', 'Two weeks on, one off', 14, 7, 720),
  ('14/14', 'Even time', 14, 14, 720),
  ('8/6', 'Eight on, six off', 8, 6, 720),
  ('SD10', 'Shutdown, ten days', 10, 0, 720)
on conflict (code) do nothing;

insert into fatigue_policies (name, level, max_shift_minutes, min_rest_minutes, max_consecutive, max_14d_minutes, source)
values ('Redgum fatigue plan', 'business', 750, 600, 21, 10080, 'Redgum fatigue management plan rev 4')
on conflict (name) do nothing;
insert into fatigue_policies (name, level, client_id, max_shift_minutes, min_rest_minutes, max_consecutive, source)
select 'Mount Ida contractor standard', 'client', id, 750, 600, 14, 'Mount Ida contractor fatigue standard' from clients where name = 'Mount Ida Iron Pty Ltd'
on conflict (name) do nothing;
insert into fatigue_policies (name, level, client_id, max_consecutive, source)
select 'Coolabah site access rules', 'client', id, 14, 'Coolabah contractor management plan' from clients where name = 'Coolabah Gold Ltd'
on conflict (name) do nothing;
insert into fatigue_policies (name, level, site_id, max_shift_minutes, min_rest_minutes, max_consecutive, max_14d_minutes, source)
select 'Bowen Range North fatigue standard', 'site', id, 720, 600, 14, 9240, 'Bowen Range North site standard' from sites where code = 'BRC'
on conflict (name) do nothing;

insert into credential_types (code, name, kind, site_id)
select v.code, v.name, v.kind, s.id
from (values
  ('IND-WIR', 'Wirraway Hub site induction', 'induction', 'WIR'),
  ('IND-CLB', 'Coolabah Mill site induction', 'induction', 'CLB'),
  ('IND-BRC', 'Bowen Range North site induction', 'induction', 'BRC'),
  ('S11', 'Coal mining generic induction (Standard 11)', 'induction', null),
  ('MED', 'Pre-employment medical and drug screen', 'medical', null),
  ('VOC-LV', 'VOC: light vehicle on site', 'voc', null),
  ('WAH', 'Working at heights', 'ticket', null),
  ('CSE', 'Confined space entry', 'ticket', null),
  ('HRWL-RB', 'High risk work licence: basic rigging (RB)', 'hrwl', null),
  ('HRWL-WP', 'High risk work licence: boom-type elevating work platform (WP)', 'hrwl', null),
  ('DL-C', 'Driver licence, class C', 'licence', null)
) as v(code, name, kind, site)
left join sites s on s.code = v.site
on conflict (code) do nothing;

insert into requirements (client_id, credential_type_id)
select c.id, t.id from (values
  ('Mount Ida Iron Pty Ltd', 'MED'), ('Mount Ida Iron Pty Ltd', 'VOC-LV'),
  ('Coolabah Gold Ltd', 'DL-C'),
  ('Bowen Range Coal Pty Ltd', 'MED'), ('Bowen Range Coal Pty Ltd', 'WAH')
) as v(client, cred) join clients c on c.name = v.client join credential_types t on t.code = v.cred
where not exists (select 1 from requirements r where r.client_id = c.id and r.credential_type_id = t.id);
insert into requirements (site_id, credential_type_id)
select s.id, t.id from (values ('WIR', 'IND-WIR'), ('CLB', 'IND-CLB'), ('BRC', 'IND-BRC'), ('BRC', 'S11')) as v(site, cred)
join sites s on s.code = v.site join credential_types t on t.code = v.cred
where not exists (select 1 from requirements r where r.site_id = s.id and r.credential_type_id = t.id);

insert into providers (name, kind, abn, contact_email, qld_licence_ref, insurance_expires_on) values
  ('Pilbara Labour Co', 'labour-hire', '58 622 401 990', 'bookings@pilbaralabour.example', null, current_date + 200),
  ('Fortitude Labour Hire', 'labour-hire', '36 611 784 202', 'crew@fortitude.example', 'LHL 03812', current_date + 300),
  ('Hallett Rigging', 'subcontractor', '92 145 667 310', 'greg@hallettrigging.example', null, current_date + 40)
on conflict (name) do nothing;

insert into workers (code, full_name, trade, employment, provider_id, home_port, phone, email)
select v.code, v.name, v.trade, v.emp, p.id, v.port, v.phone, v.email
from (values
  ('W01', 'Tom Harding', 'Fitter', 'employee', null, 'PER', '0412 330 101', 'tom.h@redgum.example'),
  ('W02', 'Raj Patel', 'Fitter', 'employee', null, 'PER', '0412 330 102', 'raj.p@redgum.example'),
  ('W03', 'Kelly Brooks', 'Fitter', 'employee', null, 'PER', '0412 330 103', 'kelly.b@redgum.example'),
  ('W04', 'Sean Kelly', 'Auto electrician', 'employee', null, 'PER', '0412 330 104', 'sean.k@redgum.example'),
  ('W05', 'Mia Russo', 'Auto electrician', 'employee', null, 'PER', '0412 330 105', 'mia.r@redgum.example'),
  ('W06', 'Liam O''Connor', 'Boilermaker', 'employee', null, 'PER', '0412 330 106', 'liam.o@redgum.example'),
  ('W07', 'Dylan Marsh', 'Heavy diesel fitter', 'labour-hire', 'Pilbara Labour Co', 'PER', '0433 210 007', null),
  ('W08', 'Alan Brice', 'Heavy diesel fitter', 'employee', null, null, '0412 330 108', 'alan.b@redgum.example'),
  ('W09', 'Priya Shah', 'Heavy diesel fitter', 'employee', null, null, '0412 330 109', 'priya.s@redgum.example'),
  ('W10', 'Josh Nguyen', 'Fitter', 'labour-hire', 'Pilbara Labour Co', 'PER', '0433 210 010', null),
  ('W11', 'Ben Ashby', 'Fitter', 'employee', null, 'PER', '0412 330 111', 'ben.a@redgum.example'),
  ('W12', 'Karen Doyle', 'Supervisor', 'employee', null, 'BNE', '0412 330 112', 'karen.d@redgum.example'),
  ('W13', 'Nathan Cole', 'Boilermaker', 'labour-hire', 'Pilbara Labour Co', 'PER', '0433 210 013', null),
  ('W14', 'Greg Hallett', 'Rigger', 'subcontractor', 'Hallett Rigging', 'BNE', '0455 900 214', 'greg@hallettrigging.example'),
  ('W15', 'Ana Lopes', 'Fitter', 'labour-hire', 'Fortitude Labour Hire', 'BNE', '0466 120 015', null),
  ('W16', 'Pete Walsh', 'Fitter', 'employee', null, 'PER', '0412 330 116', 'pete.w@redgum.example'),
  ('W17', 'Chris Doran', 'Fitter', 'labour-hire', 'Fortitude Labour Hire', 'BNE', '0466 120 017', null)
) as v(code, name, trade, emp, provider, port, phone, email)
left join providers p on p.name = v.provider
on conflict (code) do nothing;

-- Credentials: [worker, credential, days from today it expires (null: no expiry)]
insert into credentials (worker_id, credential_type_id, ref, issued_on, expires_on)
select w.id, t.id, v.cred || '-' || v.worker, current_date - 300, case when v.exp is null then null else current_date + v.exp end
from (values
  ('W01','IND-WIR',200),('W01','MED',300),('W01','VOC-LV',150),
  ('W02','IND-WIR',180),('W02','MED',10),('W02','VOC-LV',90),
  ('W03','IND-WIR',-3),('W03','MED',250),('W03','VOC-LV',120),
  ('W04','IND-WIR',220),('W04','MED',260),('W04','VOC-LV',200),('W04','HRWL-WP',40),
  ('W05','IND-WIR',240),('W05','MED',310),('W05','VOC-LV',25),
  ('W06','IND-WIR',190),('W06','MED',400),('W06','VOC-LV',160),('W06','WAH',300),('W06','IND-BRC',200),('W06','S11',900),('W06','CSE',100),
  ('W07','IND-WIR',100),('W07','MED',200),('W07','VOC-LV',100),('W07','DL-C',400),('W07','IND-CLB',300),
  ('W08','DL-C',700),('W08','IND-CLB',60),
  ('W09','DL-C',500),('W09','IND-CLB',30),
  ('W10','IND-WIR',150),('W10','MED',220),('W10','VOC-LV',150),('W10','WAH',180),('W10','IND-BRC',240),('W10','S11',800),
  ('W11','IND-WIR',170),('W11','MED',330),('W11','VOC-LV',140),('W11','WAH',260),('W11','IND-BRC',210),('W11','S11',700),
  ('W12','MED',280),('W12','WAH',200),('W12','IND-BRC',150),('W12','S11',600),('W12','VOC-LV',300),
  ('W13','MED',190),('W13','WAH',240),('W13','IND-BRC',160),('W13','S11',500),('W13','CSE',220),
  ('W14','MED',170),('W14','WAH',150),('W14','IND-BRC',180),('W14','S11',400),('W14','HRWL-RB',12),
  ('W15','MED',260),('W15','WAH',300),('W15','IND-BRC',200),('W15','S11',650),
  ('W16','MED',230),('W16','WAH',210),('W16','IND-BRC',190),
  ('W17','MED',300),('W17','WAH',330),('W17','IND-BRC',250),('W17','S11',720)
) as v(worker, cred, exp)
join workers w on w.code = v.worker join credential_types t on t.code = v.cred
on conflict (worker_id, credential_type_id) do nothing;

insert into jobs (code, site_id, name, kind, po_ref, starts_on, ends_on, status)
select v.code, s.id, v.name, v.kind, v.po, current_date + v.s, case when v.e is null then null else current_date + v.e end, v.status
from (values
  ('J-201', 'WIR', 'Wirraway fixed plant maintenance', 'ongoing', 'MI-PO-44120', -120, null, 'active'),
  ('J-202', 'CLB', 'Coolabah mobile plant', 'ongoing', 'CG-7781', -90, null, 'active'),
  ('J-198', 'WIR', 'Wirraway crusher reline shutdown', 'shutdown', 'MI-PO-44391', -12, -6, 'finished'),
  ('J-203', 'BRC', 'Bowen Range dragline shutdown', 'shutdown', 'BRC-SD-0912', 9, 18, 'planned')
) as v(code, site, name, kind, po, s, e, status)
join sites s on s.code = v.site
on conflict (code) do nothing;

insert into job_roles (job_id, trade, headcount, credential_type_id)
select j.id, v.trade, v.n, t.id
from (values
  ('J-201', 'Fitter', 2, null), ('J-201', 'Auto electrician', 1, null),
  ('J-202', 'Heavy diesel fitter', 1, null),
  ('J-198', 'Fitter', 2, null), ('J-198', 'Heavy diesel fitter', 1, null), ('J-198', 'Boilermaker', 1, null),
  ('J-203', 'Fitter', 4, null), ('J-203', 'Boilermaker', 2, 'CSE'), ('J-203', 'Rigger', 1, 'HRWL-RB'), ('J-203', 'Supervisor', 1, null)
) as v(job, trade, n, cred)
join jobs j on j.code = v.job left join credential_types t on t.code = v.cred
on conflict (job_id, trade) do nothing;

insert into client_rates (client_id, trade, rate_cents)
select c.id, v.trade, v.cents from (values
  ('Mount Ida Iron Pty Ltd', 'Fitter', 12800), ('Mount Ida Iron Pty Ltd', 'Auto electrician', 13500),
  ('Mount Ida Iron Pty Ltd', 'Heavy diesel fitter', 13200), ('Mount Ida Iron Pty Ltd', 'Boilermaker', 12500),
  ('Coolabah Gold Ltd', 'Heavy diesel fitter', 12200),
  ('Bowen Range Coal Pty Ltd', 'Fitter', 13900), ('Bowen Range Coal Pty Ltd', 'Boilermaker', 13600),
  ('Bowen Range Coal Pty Ltd', 'Rigger', 13200), ('Bowen Range Coal Pty Ltd', 'Supervisor', 15800)
) as v(client, trade, cents) join clients c on c.name = v.client
on conflict (client_id, trade) do nothing;

-- Assignments. Panels on the same job are offset so the site always has its crew.
insert into assignments (worker_id, job_id, template_id, panel, shift_kind, start_on, end_on)
select w.id, j.id, t.id, v.panel, v.kind, current_date + v.s, case when v.e is null then null else current_date + v.e end
from (values
  ('W01', 'J-201', '2/1', 'A', 'day', -42, null),
  ('W02', 'J-201', '2/1', 'B', 'day', -35, null),
  ('W03', 'J-201', '2/1', 'C', 'day', -28, null),
  ('W04', 'J-201', '14/14', 'A', 'day', -42, null),
  ('W05', 'J-201', '14/14', 'B', 'day', -28, null),
  ('W08', 'J-202', '8/6', 'A', 'night', -34, null),
  ('W09', 'J-202', '8/6', 'B', 'day', -27, null),
  ('W07', 'J-198', 'SD10', null, 'day', -12, -6),
  ('W06', 'J-198', 'SD10', null, 'day', -12, -6),
  ('W10', 'J-198', 'SD10', null, 'day', -12, -6),
  ('W11', 'J-198', 'SD10', null, 'day', -12, -6),
  ('W07', 'J-202', '2/1', 'cover', 'day', -5, 3),
  ('W06', 'J-203', 'SD10', null, 'day', 9, 18),
  ('W10', 'J-203', 'SD10', null, 'day', 9, 18),
  ('W11', 'J-203', 'SD10', null, 'day', 9, 18),
  ('W12', 'J-203', 'SD10', null, 'day', 9, 18),
  ('W13', 'J-203', 'SD10', null, 'day', 9, 18),
  ('W14', 'J-203', 'SD10', null, 'day', 9, 18)
) as v(worker, job, tpl, panel, kind, s, e)
join workers w on w.code = v.worker join jobs j on j.code = v.job join swing_templates t on t.code = v.tpl
where not exists (select 1 from assignments a where a.worker_id = w.id and a.job_id = j.id and a.start_on = current_date + v.s);

-- The roster: four weeks back, eight weeks forward, written from each assignment's pattern.
insert into shifts (worker_id, job_id, assignment_id, shift_date, shift_kind, planned_minutes, status, confirmed_at)
select a.worker_id, a.job_id, a.id, g.d::date, a.shift_kind, t.shift_minutes,
       case when g.d::date < current_date then 'confirmed'
            when w.code in ('W13', 'W14') or g.d::date > current_date + 21 then 'planned'
            else 'confirmed' end,
       case when w.code in ('W13', 'W14') or g.d::date > current_date + 21 then null else now() end
from assignments a
join swing_templates t on t.id = a.template_id
join workers w on w.id = a.worker_id
cross join lateral generate_series(greatest(a.start_on, current_date - 28), coalesce(a.end_on, current_date + 56), interval '1 day') g(d)
where ((g.d::date - a.start_on) % (t.days_on + t.days_off)) < t.days_on
on conflict (worker_id, shift_date) do nothing;

-- Tom declined three days of his swing; Priya is on leave and Dylan covers; Alan swapped a night for a day.
update shifts s set status = 'declined', decline_reason = 'Family matter, leave approved', confirmed_at = null
from workers w where w.id = s.worker_id and w.code = 'W01' and s.shift_date between current_date + 3 and current_date + 5 and s.status <> 'declined';
update shifts s set status = 'cancelled'
from workers w where w.id = s.worker_id and w.code = 'W09' and s.shift_date between current_date + 1 and current_date + 3 and s.status <> 'cancelled';
update shifts s set shift_kind = 'day'
from workers w where w.id = s.worker_id and w.code = 'W08' and s.shift_date = current_date - 2 and s.shift_kind <> 'day';

-- Timesheets for every past shift, except three nobody filled in.
insert into timesheets (shift_id, start_time, end_time, break_minutes, worked_minutes, status, submitted_on, approved_by, approved_on, payroll_exported_on, invoiced_on)
select s.id,
       case when w.code = 'W08' and s.shift_date = current_date - 2 then time '14:00'
            when j.code = 'J-198' and w.code = 'W07' then time '05:45'
            when j.code = 'J-198' and w.code = 'W06' and s.shift_date = current_date - 8 then time '05:30'
            when s.shift_kind = 'night' then time '18:00' else time '06:00' end,
       case when w.code = 'W08' and s.shift_date = current_date - 2 then time '02:00'
            when j.code = 'J-198' and w.code = 'W07' then time '18:15'
            when j.code = 'J-198' and w.code = 'W06' and s.shift_date = current_date - 8 then time '19:30'
            when s.shift_kind = 'night' then time '06:00' else time '18:00' end,
       30,
       case when j.code = 'J-198' and w.code = 'W07' then 720
            when j.code = 'J-198' and w.code = 'W06' and s.shift_date = current_date - 8 then 810
            else 690 end,
       case when s.shift_date >= current_date - 7 and j.code <> 'J-198' then 'submitted'
            when j.code = 'J-198' and w.code = 'W06' then 'submitted'
            else 'approved' end,
       case when j.code = 'J-198' then current_date - 5 else s.shift_date + 1 end,
       case when s.shift_date >= current_date - 7 and j.code <> 'J-198' then null when j.code = 'J-198' and w.code = 'W06' then null
            when j.code = 'J-198' then 'Grace Tan (Mount Ida)' else 'Karen Doyle' end,
       case when s.shift_date >= current_date - 7 and j.code <> 'J-198' then null when j.code = 'J-198' and w.code = 'W06' then null
            when j.code = 'J-198' then current_date - 4 else s.shift_date + 2 end,
       case when s.shift_date < current_date - 14 and w.employment = 'employee' then current_date - 10 else null end,
       case when s.shift_date < current_date - 14 and j.code <> 'J-198' then current_date - 10 else null end
from shifts s join workers w on w.id = s.worker_id join jobs j on j.id = s.job_id
where s.shift_date < current_date and s.status = 'confirmed'
  and not (w.code = 'W03' and s.shift_date in (current_date - 3, current_date - 2))
  and not (w.code = 'W08' and s.shift_date = current_date - 4)
on conflict (shift_id) do nothing;

-- Flights: [worker, job, direction, days from today, from, to, flight, booking ref]
insert into flights (worker_id, job_id, direction, flight_date, from_port, to_port, flight_no, booking_ref)
select w.id, j.id, v.dir, current_date + v.d, v.f, v.t, v.no, v.ref
from (values
  ('W01','J-201','in',0,'PER','PBO','QF1930','QX7H2L'), ('W01','J-201','out',13,'PBO','PER','QF1931','QX7H2L'),
  ('W03','J-201','in',-7,'PER','PBO','QF1930','RW2K9P'),
  ('W05','J-201','in',0,'PER','PBO','QF1930','QX7H3M'), ('W05','J-201','out',13,'PBO','PER','QF1931','QX7H3M'),
  ('W02','J-201','in',7,'PER','PBO','QF1930','TB4N6C'), ('W02','J-201','out',20,'PBO','PER','QF1931','TB4N6C'),
  ('W04','J-201','in',14,'PER','PBO','QF1930','UC8R1D'), ('W04','J-201','out',27,'PBO','PER','QF1931','UC8R1D'),
  ('W12','J-203','in',8,'BNE','MOV','QF2380','KD5J7A'), ('W12','J-203','out',18,'MOV','BNE','QF2381','KD5J7A'),
  ('W06','J-203','in',8,'PER','MOV','QF2380','LP2F8E'), ('W06','J-203','out',19,'MOV','PER','QF2381','LP2F8E'),
  ('W11','J-203','in',8,'PER','MOV','QF2380','LP2F9G'),
  ('W14','J-203','in',9,'BNE','MOV','QF2382','HR6T3B')
) as v(worker, job, dir, d, f, t, no, ref)
join workers w on w.code = v.worker join jobs j on j.code = v.job
on conflict (worker_id, direction, flight_date) do nothing;

-- Camp rooms: [worker, site, room, check in, check out (days from today)]
insert into rooms (worker_id, site_id, room, check_in, check_out)
select w.id, s.id, v.room, current_date + v.i, current_date + v.o
from (values
  ('W01','WIR','B-14',0,13), ('W03','WIR','B-15',-7,6), ('W05','WIR','C-02',0,13), ('W04','WIR','C-03',14,27),
  ('W08','CLB','Donga 4',-6,1), ('W07','CLB','Donga 9',-5,3), ('W09','CLB','Donga 7',4,8),
  ('W12','BRC','RV-112',8,18), ('W06','BRC','RV-114',8,19), ('W11','BRC','RV-115',8,18), ('W14','BRC','RV-116',9,18)
) as v(worker, site, room, i, o)
join workers w on w.code = v.worker join sites s on s.code = v.site
on conflict (worker_id, site_id, check_in) do nothing;

-- The audit trail.
insert into roster_events (at, worker_id, job_id, shift_date, kind, rule, reason, by_name)
select now() - (v.ago || ' days')::interval, w.id, j.id, current_date + v.d, v.kind, v.rule, v.reason, v.by
from (values
  ('W03', 'J-201', -7, 'override', 'R1 site requirements', null, null, 14),
  ('W07', 'J-202', -5, 'override', 'R5 consecutive shifts', 'Cover for Priya''s leave, mill reline backlog', 'Dan Price', 6),
  ('W01', 'J-201', 3, 'decline', null, 'Family matter, leave approved', 'Tom Harding', 2)
) as v(worker, job, d, kind, rule, reason, by, ago)
join workers w on w.code = v.worker join jobs j on j.code = v.job
where not exists (select 1 from roster_events e where e.worker_id = w.id and e.kind = v.kind and e.shift_date = current_date + v.d);

insert into notes (job_id, body, author)
select j.id, v.body, v.author from (values
  ('J-203', 'Mick wants the crew list and tickets by the Friday before mobilisation.', 'Dan Price'),
  ('J-201', 'Mount Ida moving to 12.5 hour cap from next quarter, confirm in writing.', 'Dan Price')
) as v(job, body, author) join jobs j on j.code = v.job
where not exists (select 1 from notes n where n.body = v.body);
