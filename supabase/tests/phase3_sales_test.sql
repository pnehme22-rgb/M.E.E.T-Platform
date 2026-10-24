-- =============================================================================
-- Phase 3 test: public prices, artist inquiries, project requests, the sales
-- pipeline and its permissions. Run in Supabase > SQL Editor AFTER update 010.
-- Everything happens inside one transaction that is cancelled at the end:
-- no test data is kept, no emails are sent, nothing real is changed.
-- Supabase then shows a red message that starts with "PHASE 3 TEST FINISHED"
-- and says how many checks passed. That red message is expected.
-- =============================================================================
begin;

create temp table t_results (n serial, check_name text, result text) on commit drop;
create temp table t_ids (k text primary key, v uuid) on commit drop;
grant all on t_results, t_ids to anon, authenticated;
grant usage, select on sequence t_results_n_seq to anon, authenticated;

create or replace function pg_temp.ok(name text, passed boolean) returns void language sql as $$
  insert into t_results (check_name, result) values (name, case when passed then 'PASS' else 'FAIL' end)
$$;
-- Act as a signed-in person (sub) with an optional confirmed team session.
create or replace function pg_temp.act(uid text, sid text default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid)::text, true)
$$;

-- ---------------------------------------------------------------------------
-- Sample people: three members, two artists (one public), four team members
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values
 ('00000000-0000-4000-8000-0000000003a1', 'p3-personal@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"personal","full_name":"Personal Member","country":"Lebanon","phone":"+961 1 234 567"}'),
 ('00000000-0000-4000-8000-0000000003a2', 'p3-pro@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"professional","full_name":"Pro Member","country":"France","professional_role":"Interior designer","company_name":"Atelier P3"}'),
 ('00000000-0000-4000-8000-0000000003a3', 'p3-biz@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"business","full_name":"Biz Member","country":"United Arab Emirates","business_name":"Hotel P3","contact_person":"Biz Member","business_type":"Hotel"}'),
 ('00000000-0000-4000-8000-0000000003b1', 'p3-artist@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000003b2', 'p3-hidden@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000003e1', 'p3-founder@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000003e2', 'p3-sales1@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000003e3', 'p3-sales2@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000003e4', 'p3-ops@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');

insert into applications (id, reference, full_name, artist_name, email, country, city, primary_discipline, practice, consent_version, consent_at, status, artist_id) values
 ('00000000-0000-4000-8000-0000000003c1','TEST-P3-1','Artist P3','Public P3','p3-artist@test.invalid','Japan','Kyoto','Ceramics','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000003b1'),
 ('00000000-0000-4000-8000-0000000003c2','TEST-P3-2','Hidden P3','Hidden P3','p3-hidden@test.invalid','Japan','Kyoto','Ceramics','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000003b2');
insert into artists (id, application_id, email, legal_name, display_name, craft, techniques, bio, profile_status, terms_version, terms_accepted_at) values
 ('00000000-0000-4000-8000-0000000003b1','00000000-0000-4000-8000-0000000003c1','p3-artist@test.invalid','Legal','Public P3','Ceramics','Raku','Bio','approved',(select value from app_config where key='terms_version_current'),now()),
 ('00000000-0000-4000-8000-0000000003b2','00000000-0000-4000-8000-0000000003c2','p3-hidden@test.invalid','Legal','Hidden P3','Ceramics','','Bio','submitted',(select value from app_config where key='terms_version_current'),now());
insert into artworks (id, artist_id, title, status, images, price, currency, price_on_request, price_public, feedback) values
 ('00000000-0000-4000-8000-0000000003d1','00000000-0000-4000-8000-0000000003b1','Shown price','approved','{}',900,'USD',false,true,''),
 ('00000000-0000-4000-8000-0000000003d2','00000000-0000-4000-8000-0000000003b1','Price not chosen','approved','{}',500,'USD',false,false,''),
 ('00000000-0000-4000-8000-0000000003d3','00000000-0000-4000-8000-0000000003b1','On request','approved','{}',700,'USD',true,false,''),
 ('00000000-0000-4000-8000-0000000003d4','00000000-0000-4000-8000-0000000003b1','Draft without choice','draft','{x.jpg}',300,'USD',false,false,''),
 ('00000000-0000-4000-8000-0000000003d5','00000000-0000-4000-8000-0000000003b2','Hidden artist work','approved','{}',null,'USD',true,false,'');

insert into team_members (user_id, name, email, role, active) values
 ('00000000-0000-4000-8000-0000000003e1', 'Founder P3', 'p3-founder@test.invalid', 'founder', true),
 ('00000000-0000-4000-8000-0000000003e2', 'Sales One', 'p3-sales1@test.invalid', 'sales', true),
 ('00000000-0000-4000-8000-0000000003e3', 'Sales Two', 'p3-sales2@test.invalid', 'sales', true),
 ('00000000-0000-4000-8000-0000000003e4', 'Ops P3', 'p3-ops@test.invalid', 'operations', true);
insert into team_session_checks (session_id, user_id, code_hash, expires_at, verified_at) values
 ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003e1', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000003f2', '00000000-0000-4000-8000-0000000003e2', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000003f3', '00000000-0000-4000-8000-0000000003e3', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000003f4', '00000000-0000-4000-8000-0000000003e4', 'x', now() + interval '1 hour', now());

-- ---------------------------------------------------------------------------
-- 1. Public prices follow the artist's choice
-- ---------------------------------------------------------------------------
update artworks set price_public = true where id = '00000000-0000-4000-8000-0000000003d3';
select pg_temp.ok('Price on request always wins over showing a price',
  (select price_public from artworks where id = '00000000-0000-4000-8000-0000000003d3') = false);

set local role anon;
select pg_temp.ok('A price the artist chose to show is public, with its currency',
  exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000003d1' and price = 900 and currency = 'USD'));
select pg_temp.ok('A price the artist did not choose to show is not public',
  exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000003d2' and price is null and currency is null));
select pg_temp.ok('Price on request shows no number',
  exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000003d3' and price is null and price_on_request));
reset role;

set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000003b1');
do $$ begin
  begin
    perform submit_artwork('00000000-0000-4000-8000-0000000003d4');
    perform pg_temp.ok('An artwork cannot be sent for review without a price choice', false);
  exception when invalid_parameter_value then perform pg_temp.ok('An artwork cannot be sent for review without a price choice', true);
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 2. Artist inquiries
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000003a1');
do $$
declare v uuid;
begin
  v := create_inquiry('00000000-0000-4000-8000-0000000003b1', 'artwork', '00000000-0000-4000-8000-0000000003d1', 'Hello, I would love to know more about this piece.');
  insert into t_ids values ('inq', v);
  perform pg_temp.ok('A member sends an inquiry to a public artist', v is not null);
  begin
    perform create_inquiry('00000000-0000-4000-8000-0000000003b2', 'other', null, 'Hello, I would love to know more about your work.');
    perform pg_temp.ok('Inquiries to artists who are not public are refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('Inquiries to artists who are not public are refused', true);
  end;
  begin
    perform create_inquiry('00000000-0000-4000-8000-0000000003b1', 'artwork', '00000000-0000-4000-8000-0000000003d5', 'Hello, I would love to know more about this piece.');
    perform pg_temp.ok('An artwork that is not this artist''s public work is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('An artwork that is not this artist''s public work is refused', true);
  end;
  begin
    perform create_inquiry('00000000-0000-4000-8000-0000000003b1', 'other', null, 'Too short');
    perform pg_temp.ok('A message under 20 characters is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A message under 20 characters is refused', true);
  end;
  begin
    perform create_inquiry('00000000-0000-4000-8000-0000000003b1', 'other', null, 'Sending the same inquiry a second time.');
    perform pg_temp.ok('A second inquiry to the same artist within minutes is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A second inquiry to the same artist within minutes is refused', true);
  end;
end $$;

select pg_temp.ok('The inquiry stores the member''s name, type and country',
  exists (select 1 from artist_inquiries where member_name = 'Personal Member' and member_type = 'personal' and member_country = 'Lebanon'));
select pg_temp.ok('Inquiries hold no email address or phone number',
  not exists (select 1 from information_schema.columns where table_name = 'artist_inquiries' and column_name ~ '(email|phone)'));

select pg_temp.act('00000000-0000-4000-8000-0000000003a2');
select pg_temp.ok('Another member cannot see the inquiry', (select count(*) from artist_inquiries) = 0);

select pg_temp.act('00000000-0000-4000-8000-0000000003b2');
select pg_temp.ok('Another artist cannot see the inquiry', (select count(*) from artist_inquiries) = 0);
do $$ begin
  begin
    perform respond_inquiry((select v from t_ids where k = 'inq'), 'A reply from the wrong artist.');
    perform pg_temp.ok('Another artist cannot reply', false);
  exception when insufficient_privilege then perform pg_temp.ok('Another artist cannot reply', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000003b1');
do $$ begin
  begin
    perform create_inquiry('00000000-0000-4000-8000-0000000003b1', 'other', null, 'An artist trying to send an inquiry.');
    perform pg_temp.ok('Artist accounts cannot send inquiries', false);
  exception when insufficient_privilege then perform pg_temp.ok('Artist accounts cannot send inquiries', true);
  end;
end $$;
select pg_temp.ok('The artist sees the inquiry', (select count(*) from artist_inquiries) = 1);
select set_inquiry_status((select v from t_ids where k = 'inq'), 'responded');
select pg_temp.ok('"Responded" cannot be set without replying', (select status from artist_inquiries where id = (select v from t_ids where k = 'inq')) = 'new');
select set_inquiry_status((select v from t_ids where k = 'inq'), 'viewed');
select pg_temp.ok('The artist marks it viewed', (select status from artist_inquiries where id = (select v from t_ids where k = 'inq')) = 'viewed');
select respond_inquiry((select v from t_ids where k = 'inq'), 'Thank you for writing. The piece is available.');
select pg_temp.ok('The artist replies once and it is Responded', (select status from artist_inquiries where id = (select v from t_ids where k = 'inq')) = 'responded');
do $$ begin
  begin
    perform respond_inquiry((select v from t_ids where k = 'inq'), 'A second reply attempt here.');
    perform pg_temp.ok('A second reply is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A second reply is refused', true);
  end;
end $$;
select set_inquiry_status((select v from t_ids where k = 'inq'), 'closed');
select set_inquiry_status((select v from t_ids where k = 'inq'), 'open');
select pg_temp.ok('Closing and reopening returns to Responded', (select status from artist_inquiries where id = (select v from t_ids where k = 'inq')) = 'responded');

select pg_temp.act('00000000-0000-4000-8000-0000000003a1');
select pg_temp.ok('The member sees the reply in their account', (select response from artist_inquiries where id = (select v from t_ids where k = 'inq')) <> '');

select pg_temp.act('00000000-0000-4000-8000-0000000003e4', '00000000-0000-4000-8000-0000000003f4');
select pg_temp.ok('The team can track inquiries', (select count(*) from artist_inquiries where id = (select v from t_ids where k = 'inq')) = 1);
reset role;

set local role anon;
do $$ begin
  begin
    perform 1 from artist_inquiries limit 1;
    perform pg_temp.ok('Visitors cannot read inquiries', false);
  exception when insufficient_privilege then perform pg_temp.ok('Visitors cannot read inquiries', true);
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Project requests
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000003a1');
do $$ begin
  begin
    perform create_project_request('{"description":"A personal project description here.","artwork_type":"Painting","budget_undecided":true,"timeline_undecided":true}');
    perform pg_temp.ok('Personal accounts cannot send project requests', false);
  exception when insufficient_privilege then perform pg_temp.ok('Personal accounts cannot send project requests', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000003a2');
do $$
declare r jsonb;
begin
  begin
    perform create_project_request('{"description":"Ceramic pieces for a hotel lobby in Paris.","artwork_type":"Ceramics","timeline":"Spring"}');
    perform pg_temp.ok('A budget, or "not decided yet", is required', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A budget, or "not decided yet", is required', true);
  end;
  r := create_project_request('{"description":"Ceramic and raku pieces for a hotel lobby in Paris.","artwork_type":"Ceramics","budget_undecided":true,"timeline":"By June 2027","location":"Paris, France"}');
  insert into t_ids values ('prj', (r->>'id')::uuid);
  perform pg_temp.ok('A Professional member sends a project request with a reference', r->>'reference' like 'PRJ-%');
end $$;
select pg_temp.ok('The request keeps the client''s country and organization',
  exists (select 1 from project_requests where id = (select v from t_ids where k = 'prj') and client_country = 'France' and client_organization = 'Atelier P3'));
reset role;
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000003a2');
select pg_temp.ok('The member cannot read the sales table directly', (select count(*) from project_requests) = 0);
select pg_temp.ok('The member sees their request and a simple status', (select client_status from my_project_requests() limit 1) = 'received');
select pg_temp.ok('The member cannot see internal notes, artists or tasks',
  (select count(*) from project_notes) + (select count(*) from project_artists) + (select count(*) from project_tasks) = 0);
select pg_temp.act('00000000-0000-4000-8000-0000000003a3');
select pg_temp.ok('Another client does not see the request', (select count(*) from my_project_requests()) = 0);

-- ---------------------------------------------------------------------------
-- 4. Sales permissions and pipeline
-- ---------------------------------------------------------------------------
select pg_temp.act('00000000-0000-4000-8000-0000000003e4', '00000000-0000-4000-8000-0000000003f4');
select pg_temp.ok('Team members without sales access cannot see projects', (select count(*) from project_requests) = 0);
do $$ begin
  begin
    perform set_project_status((select v from t_ids where k = 'prj'), 'contacted', null, '');
    perform pg_temp.ok('Team members without sales access cannot change projects', false);
  exception when insufficient_privilege then perform pg_temp.ok('Team members without sales access cannot change projects', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000003e2', '00000000-0000-4000-8000-0000000003f2');
select pg_temp.ok('Sales team members see all project requests', (select count(*) from project_requests where id = (select v from t_ids where k = 'prj')) = 1);
do $$ begin
  begin
    perform set_project_status((select v from t_ids where k = 'prj'), 'contacted', null, '');
    perform pg_temp.ok('A sales member cannot change a project before taking it', false);
  exception when insufficient_privilege then perform pg_temp.ok('A sales member cannot change a project before taking it', true);
  end;
  begin
    perform set_application_status('00000000-0000-4000-8000-0000000003c1', 'declined', '');
    perform pg_temp.ok('The sales role cannot change artist applications', false);
  exception when insufficient_privilege then perform pg_temp.ok('The sales role cannot change artist applications', true);
  end;
end $$;
select assign_project((select v from t_ids where k = 'prj'), '00000000-0000-4000-8000-0000000003e2');
select pg_temp.ok('A sales member takes an unassigned project',
  (select assigned_to from project_requests where id = (select v from t_ids where k = 'prj')) = '00000000-0000-4000-8000-0000000003e2');
select set_project_status((select v from t_ids where k = 'prj'), 'contacted', null, '');
do $$ begin
  begin
    perform set_project_status((select v from t_ids where k = 'prj'), 'not_confirmed', null, '');
    perform pg_temp.ok('Not Confirmed requires a reason', false);
  exception when invalid_parameter_value then perform pg_temp.ok('Not Confirmed requires a reason', true);
  end;
  begin
    perform set_project_status((select v from t_ids where k = 'prj'), 'not_confirmed', 'other', '');
    perform pg_temp.ok('"Other" requires an explanation', false);
  exception when invalid_parameter_value then perform pg_temp.ok('"Other" requires an explanation', true);
  end;
  begin
    perform update_project_money((select v from t_ids where k = 'prj'), '{"currency":"EUR","final_value":"50000"}');
    perform pg_temp.ok('Final values need a confirmed project', false);
  exception when invalid_parameter_value then perform pg_temp.ok('Final values need a confirmed project', true);
  end;
  begin
    perform update_project_money((select v from t_ids where k = 'prj'), '{"estimated_value":"40000"}');
    perform pg_temp.ok('Amounts need a currency', false);
  exception when invalid_parameter_value then perform pg_temp.ok('Amounts need a currency', true);
  end;
  begin
    perform set_project_artist((select v from t_ids where k = 'prj'), '00000000-0000-4000-8000-0000000003b2', 'considered', 'Good ceramics');
    perform pg_temp.ok('Artists who are not public cannot be matched', false);
  exception when invalid_parameter_value then perform pg_temp.ok('Artists who are not public cannot be matched', true);
  end;
end $$;
select set_project_status((select v from t_ids where k = 'prj'), 'not_confirmed', 'budget', 'Budget below the artwork cost');
select pg_temp.ok('Not Confirmed is recorded with its reason',
  exists (select 1 from project_requests where id = (select v from t_ids where k = 'prj') and status = 'not_confirmed' and not_confirmed_reason = 'budget'));
select set_project_status((select v from t_ids where k = 'prj'), 'negotiation', null, '');
select pg_temp.ok('A Not Confirmed project can be reopened, and the reopening is recorded',
  exists (select 1 from project_events where project_id = (select v from t_ids where k = 'prj') and kind = 'reopened')
  and (select not_confirmed_reason from project_requests where id = (select v from t_ids where k = 'prj')) is null);
select set_project_artist((select v from t_ids where k = 'prj'), '00000000-0000-4000-8000-0000000003b1', 'recommended', 'Raku ceramics match the lobby brief');
select pg_temp.ok('A public artist is recommended with a reason',
  exists (select 1 from project_artists where artist_id = '00000000-0000-4000-8000-0000000003b1' and state = 'recommended' and reason <> ''));
select add_project_note((select v from t_ids where k = 'prj'), 'Client prefers earthy colours.');
select add_project_task((select v from t_ids where k = 'prj'), 'Send proposal', null, current_date - 1, '');
select pg_temp.ok('Notes and follow-ups are recorded',
  (select count(*) from project_notes where project_id = (select v from t_ids where k = 'prj')) = 1
  and (select count(*) from project_tasks where project_id = (select v from t_ids where k = 'prj') and assigned_to = '00000000-0000-4000-8000-0000000003e2') = 1);
select set_project_status((select v from t_ids where k = 'prj'), 'confirmed', null, '');
select update_project_money((select v from t_ids where k = 'prj'), '{"currency":"EUR","estimated_value":"40000","fee_terms":"As agreed","final_value":"45000","final_revenue":"4500","payment_status":"awaiting"}');
select pg_temp.ok('Project value and M.E.E.T. revenue are recorded separately',
  exists (select 1 from project_requests where id = (select v from t_ids where k = 'prj') and final_value = 45000 and final_revenue = 4500 and payment_status = 'awaiting'));

select pg_temp.act('00000000-0000-4000-8000-0000000003e3', '00000000-0000-4000-8000-0000000003f3');
do $$ begin
  begin
    perform set_project_status((select v from t_ids where k = 'prj'), 'negotiation', null, '');
    perform pg_temp.ok('Another sales member cannot change a colleague''s project', false);
  exception when insufficient_privilege then perform pg_temp.ok('Another sales member cannot change a colleague''s project', true);
  end;
  begin
    perform assign_project((select v from t_ids where k = 'prj'), '00000000-0000-4000-8000-0000000003e3');
    perform pg_temp.ok('Only founders reassign a taken project', false);
  exception when insufficient_privilege then perform pg_temp.ok('Only founders reassign a taken project', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003f1');
select assign_project((select v from t_ids where k = 'prj'), '00000000-0000-4000-8000-0000000003e3');
select pg_temp.ok('A founder reassigns the project',
  (select assigned_to from project_requests where id = (select v from t_ids where k = 'prj')) = '00000000-0000-4000-8000-0000000003e3');

select pg_temp.act('00000000-0000-4000-8000-0000000003a2');
select pg_temp.ok('The client sees "confirmed" and nothing internal', (select client_status from my_project_requests() limit 1) = 'confirmed');
reset role;

-- Finish by stopping the transaction on purpose: every test row is discarded.
do $$
declare passed int; total int; failed text;
begin
  select count(*) filter (where result = 'PASS'), count(*) into passed, total from t_results;
  select string_agg(check_name, '; ' order by n) into failed from t_results where result <> 'PASS';
  raise exception 'PHASE 3 TEST FINISHED, nothing was saved. % of % checks passed.%',
    passed, total, coalesce(' FAILED: ' || failed, ' All good.');
end $$;
