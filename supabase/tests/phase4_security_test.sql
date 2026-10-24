-- =============================================================================
-- Phase 4 security test. Run in Supabase > SQL Editor AFTER update 011.
-- One transaction, cancelled at the end: nothing is kept, no emails are sent.
-- Supabase then shows a red message that starts with "PHASE 4 TEST FINISHED".
-- =============================================================================
begin;

create temp table t_results (n serial, check_name text, result text) on commit drop;
grant all on t_results to anon, authenticated;
grant usage, select on sequence t_results_n_seq to anon, authenticated;
create or replace function pg_temp.ok(name text, passed boolean) returns void language sql as $$
  insert into t_results (check_name, result) values (name, case when passed then 'PASS' else 'FAIL' end)
$$;
create or replace function pg_temp.act(uid text, sid text default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid)::text, true)
$$;

-- ---------------------------------------------------------------------------
-- 1. What visitors may call
-- ---------------------------------------------------------------------------
select pg_temp.ok('Visitors can send an artist application', has_function_privilege('anon', 'submit_application(jsonb)', 'execute'));
select pg_temp.ok('Visitors can see public photographs', has_function_privilege('anon', 'is_public_media(text)', 'execute'));
select pg_temp.ok('Visitors cannot call any other function', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname not in ('submit_application', 'is_public_media')
    and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.ok('Signed-in people can still use their functions',
  has_function_privilege('authenticated', 'create_inquiry(uuid,text,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'my_project_requests()', 'execute')
  and has_function_privilege('authenticated', 'is_team()', 'execute')
  and has_function_privilege('authenticated', 'accept_terms(text)', 'execute'));

-- ---------------------------------------------------------------------------
-- 2. Sample records (cancelled at the end)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values
 ('00000000-0000-4000-8000-0000000004a1', 'p4-artist@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000004a2', 'p4-hidden@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000004a3', 'p4-member@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"personal","full_name":"P4 Member","country":"Peru"}'),
 ('00000000-0000-4000-8000-0000000004a4', 'p4-viewer@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000004a5', 'p4-sales@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');
insert into applications (id, reference, full_name, artist_name, email, country, city, primary_discipline, practice, consent_version, consent_at, status, artist_id) values
 ('00000000-0000-4000-8000-0000000004b1','TEST-P4-1','P4 Artist','P4 Artist','p4-artist@test.invalid','Peru','Lima','Textiles','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000004a1'),
 ('00000000-0000-4000-8000-0000000004b2','TEST-P4-2','P4 Hidden','P4 Hidden','p4-hidden@test.invalid','Peru','Lima','Textiles','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000004a2');
insert into artists (id, application_id, email, legal_name, display_name, craft, bio, instagram, profile_status, terms_version, terms_accepted_at, avatar_path) values
 ('00000000-0000-4000-8000-0000000004a1','00000000-0000-4000-8000-0000000004b1','p4-artist@test.invalid','Private Legal','P4 Artist','Textiles','Bio','@private','approved',(select value from app_config where key='terms_version_current'),now(),'00000000-0000-4000-8000-0000000004a1/avatar.jpg'),
 ('00000000-0000-4000-8000-0000000004a2','00000000-0000-4000-8000-0000000004b2','p4-hidden@test.invalid','Hidden Legal','P4 Hidden','Textiles','Bio','','approved','2026-10-21',now(),'00000000-0000-4000-8000-0000000004a2/avatar.jpg');
insert into artworks (id, artist_id, title, status, images, price, currency, price_on_request, price_public, feedback) values
 ('00000000-0000-4000-8000-0000000004c1','00000000-0000-4000-8000-0000000004a1','Approved, price private','approved','{00000000-0000-4000-8000-0000000004a1/works/c1/1.jpg}',1500,'EUR',false,false,''),
 ('00000000-0000-4000-8000-0000000004c2','00000000-0000-4000-8000-0000000004a1','Waiting for review','submitted','{00000000-0000-4000-8000-0000000004a1/works/c2/1.jpg}',800,'EUR',false,true,''),
 ('00000000-0000-4000-8000-0000000004c3','00000000-0000-4000-8000-0000000004a2','Approved, artist on old terms','approved','{00000000-0000-4000-8000-0000000004a2/works/c3/1.jpg}',null,'EUR',true,false,'');
insert into featured_items (kind, item_id, position) values ('artwork', '00000000-0000-4000-8000-0000000004c1', 99);
insert into team_members (user_id, name, email, role, active) values
 ('00000000-0000-4000-8000-0000000004a4', 'P4 Viewer', 'p4-viewer@test.invalid', 'viewer', true),
 ('00000000-0000-4000-8000-0000000004a5', 'P4 Sales', 'p4-sales@test.invalid', 'sales', true);
insert into team_session_checks (session_id, user_id, code_hash, expires_at, verified_at) values
 ('00000000-0000-4000-8000-0000000004f4', '00000000-0000-4000-8000-0000000004a4', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000004f5', '00000000-0000-4000-8000-0000000004a5', 'x', now() + interval '1 hour', now());

-- ---------------------------------------------------------------------------
-- 3. Visitors: only eligible records and fields, no unchosen prices
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.ok('A private price is not public, on the artwork or on the homepage',
  exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000004c1' and price is null and currency is null)
  and exists (select 1 from public_featured_artworks where id = '00000000-0000-4000-8000-0000000004c1' and price is null));
select pg_temp.ok('An artwork waiting for review cannot be opened by its address',
  not exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000004c2'));
select pg_temp.ok('An artist on old terms and their artworks cannot be opened by address',
  not exists (select 1 from public_artists where id = '00000000-0000-4000-8000-0000000004a2')
  and not exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000004c3'));
select pg_temp.ok('Photographs of hidden items are not public',
  not is_public_media('00000000-0000-4000-8000-0000000004a1/works/c2/1.jpg')
  and not is_public_media('00000000-0000-4000-8000-0000000004a2/avatar.jpg')
  and not is_public_media('00000000-0000-4000-8000-0000000004a2/works/c3/1.jpg'));
select pg_temp.ok('Photographs of public items are public',
  is_public_media('00000000-0000-4000-8000-0000000004a1/avatar.jpg') and is_public_media('00000000-0000-4000-8000-0000000004a1/works/c1/1.jpg'));
do $$ begin
  begin
    perform create_inquiry('00000000-0000-4000-8000-0000000004a1', 'other', null, 'A visitor trying to call this directly.');
    perform pg_temp.ok('Visitors cannot call member functions', false);
  exception when insufficient_privilege then perform pg_temp.ok('Visitors cannot call member functions', true);
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Artists cannot approve themselves or touch others' work
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000004a1');
do $$ begin
  begin
    update artworks set status = 'approved' where id = '00000000-0000-4000-8000-0000000004c2';
    perform pg_temp.ok('An artist cannot approve their own artwork', false);
  exception when insufficient_privilege then perform pg_temp.ok('An artist cannot approve their own artwork', true);
  end;
  begin
    update artists set profile_status = 'approved' where id = '00000000-0000-4000-8000-0000000004a1';
    perform pg_temp.ok('An artist cannot approve their own profile', false);
  exception when insufficient_privilege then perform pg_temp.ok('An artist cannot approve their own profile', true);
  end;
  begin
    update artists set terms_version = '2099-01-01' where id = '00000000-0000-4000-8000-0000000004a1';
    perform pg_temp.ok('An artist cannot write the terms record directly', false);
  exception when insufficient_privilege then perform pg_temp.ok('An artist cannot write the terms record directly', true);
  end;
end $$;
update artworks set title = 'Taken over' where id = '00000000-0000-4000-8000-0000000004c3';
select pg_temp.ok('An artist cannot see another artist''s private record', (select count(*) from artists where id = '00000000-0000-4000-8000-0000000004a2') = 0);
reset role;
select pg_temp.ok('An artist cannot change another artist''s artwork', (select title from artworks where id = '00000000-0000-4000-8000-0000000004c3') = 'Approved, artist on old terms');

-- ---------------------------------------------------------------------------
-- 5. Members, viewers and sales staff stay within their role
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000004a3');
select pg_temp.ok('A member cannot read artist records (emails, legal names, links)', (select count(*) from artists) = 0);
do $$ begin
  begin
    perform review_item('artwork', '00000000-0000-4000-8000-0000000004c2', 'approved', '');
    perform pg_temp.ok('A member cannot use review functions', false);
  exception when insufficient_privilege then perform pg_temp.ok('A member cannot use review functions', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000004a4', '00000000-0000-4000-8000-0000000004f4');
select pg_temp.ok('A viewer can read applications', (select count(*) from applications where reference = 'TEST-P4-1') = 1);
select pg_temp.ok('A viewer cannot see sales records', (select count(*) from project_requests) = 0);
do $$ begin
  begin
    perform review_item('artwork', '00000000-0000-4000-8000-0000000004c2', 'approved', '');
    perform pg_temp.ok('A viewer cannot approve', false);
  exception when insufficient_privilege then perform pg_temp.ok('A viewer cannot approve', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000004a5', '00000000-0000-4000-8000-0000000004f5');
do $$ begin
  begin
    perform review_item('artwork', '00000000-0000-4000-8000-0000000004c2', 'approved', '');
    perform pg_temp.ok('The sales role cannot approve artworks', false);
  exception when insufficient_privilege then perform pg_temp.ok('The sales role cannot approve artworks', true);
  end;
  begin
    perform feature_item('artwork', '00000000-0000-4000-8000-0000000004c1');
    perform pg_temp.ok('The sales role cannot change the homepage', false);
  exception when insufficient_privilege then perform pg_temp.ok('The sales role cannot change the homepage', true);
  end;
end $$;
reset role;

do $$
declare passed int; total int; failed text;
begin
  select count(*) filter (where result = 'PASS'), count(*) into passed, total from t_results;
  select string_agg(check_name, '; ' order by n) into failed from t_results where result <> 'PASS';
  raise exception 'PHASE 4 TEST FINISHED, nothing was saved. % of % checks passed.%',
    passed, total, coalesce(' FAILED: ' || failed, ' All good.');
end $$;
