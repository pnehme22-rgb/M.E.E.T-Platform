-- =============================================================================
-- Phase 2 test: member accounts, permissions, traditions and homepage selection.
-- Run in Supabase > SQL Editor AFTER updates 008, 009 and 010.
-- Everything happens inside one transaction that is cancelled at the end:
-- no test data is kept, no emails are sent, nothing real is changed.
-- Supabase then shows a red message that starts with "PHASE 2 TEST FINISHED"
-- and says how many checks passed. That red message is expected.
-- =============================================================================
begin;

create temp table t_results (n serial, check_name text, result text) on commit drop;
grant all on t_results to anon, authenticated;
grant usage, select on sequence t_results_n_seq to anon, authenticated;

create or replace function pg_temp.ok(name text, passed boolean) returns void language sql as $$
  insert into t_results (check_name, result) values (name, case when passed then 'PASS' else 'FAIL' end)
$$;

-- ---------------------------------------------------------------------------
-- 1. Sign-ups (Supabase creates the login; the database creates the account)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values
 ('00000000-0000-4000-8000-0000000002a1', 'p2-personal@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"personal","full_name":"Personal Person","country":"Lebanon","phone":"","company_name":"Should be ignored"}'),
 ('00000000-0000-4000-8000-0000000002a2', 'p2-pro@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"professional","full_name":"Pro Person","country":"France","phone":"+33 6 12 34 56 78","professional_role":"Interior designer","company_name":"Atelier Test","professional_website":"atelier.example"}'),
 ('00000000-0000-4000-8000-0000000002a3', 'p2-biz@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"business","full_name":"Biz Person","country":"United Arab Emirates","business_name":"Test Hotel","contact_person":"Contact Person","business_type":"Hotel","business_website":""}'),
 ('00000000-0000-4000-8000-0000000002a4', 'p2-invited@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"name":"Invited artist"}');

select pg_temp.ok('Personal sign-up creates a Personal account',
  exists (select 1 from member_accounts where id = '00000000-0000-4000-8000-0000000002a1' and account_type = 'personal' and country = 'Lebanon'));
select pg_temp.ok('Personal account ignores fields of other account types',
  (select company_name from member_accounts where id = '00000000-0000-4000-8000-0000000002a1') = '');
select pg_temp.ok('Professional sign-up keeps role, company and website',
  exists (select 1 from member_accounts where id = '00000000-0000-4000-8000-0000000002a2' and account_type = 'professional'
          and professional_role = 'Interior designer' and company_name = 'Atelier Test' and professional_website = 'https://atelier.example'));
select pg_temp.ok('Business sign-up keeps organization, contact and type (website optional)',
  exists (select 1 from member_accounts where id = '00000000-0000-4000-8000-0000000002a3' and account_type = 'business'
          and business_name = 'Test Hotel' and contact_person = 'Contact Person' and business_type = 'Hotel' and business_website = ''));
select pg_temp.ok('Invited artists and team members get no member account',
  not exists (select 1 from member_accounts where id = '00000000-0000-4000-8000-0000000002a4'));
select pg_temp.ok('Email is stored once, from the login',
  (select email from member_accounts where id = '00000000-0000-4000-8000-0000000002a2') = 'p2-pro@test.invalid');

-- Missing required fields are refused by the database itself.
do $$
declare cases text[][] := array[
  ['Professional without company is refused', '{"account_type":"professional","full_name":"X","country":"Peru","professional_role":"Architect"}'],
  ['Business without contact person is refused', '{"account_type":"business","full_name":"X","country":"Peru","business_name":"B","business_type":"Gallery"}'],
  ['Sign-up without country is refused', '{"account_type":"personal","full_name":"X"}'],
  ['Sign-up without full name is refused', '{"account_type":"personal","country":"Peru"}'],
  ['Phone with letters is refused', '{"account_type":"personal","full_name":"X","country":"Peru","phone":"call me"}']];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
      values (gen_random_uuid(), 'p2-bad' || i || '@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', cases[i][2]::jsonb);
      perform pg_temp.ok(cases[i][1], false);
    exception when others then
      perform pg_temp.ok(cases[i][1], true);
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. What a signed-in member can and cannot do
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);

select pg_temp.ok('Member reads their own account', (select count(*) from member_accounts where id = '00000000-0000-4000-8000-0000000002a2') = 1);
select pg_temp.ok('Member cannot see other members', (select count(*) from member_accounts where id <> '00000000-0000-4000-8000-0000000002a2') = 0);
select pg_temp.ok('Member sees their own account type', my_account_type() = 'professional');

update member_accounts set full_name = 'Pro Person Edited', phone = '' where id = '00000000-0000-4000-8000-0000000002a2';
select pg_temp.ok('Member edits their own details', (select full_name from member_accounts where id = '00000000-0000-4000-8000-0000000002a2') = 'Pro Person Edited');

update member_accounts set full_name = 'Hacked' where id = '00000000-0000-4000-8000-0000000002a1';
reset role;
select pg_temp.ok('Member cannot edit another member', (select full_name from member_accounts where id = '00000000-0000-4000-8000-0000000002a1') = 'Personal Person');
set local role authenticated;

do $$
begin
  begin
    update member_accounts set account_type = 'business' where id = '00000000-0000-4000-8000-0000000002a2';
    perform pg_temp.ok('Member cannot change their account type', false);
  exception when insufficient_privilege then perform pg_temp.ok('Member cannot change their account type', true);
  end;
  begin
    update member_accounts set email = 'other@test.invalid' where id = '00000000-0000-4000-8000-0000000002a2';
    perform pg_temp.ok('Member cannot change the stored email', false);
  exception when insufficient_privilege then perform pg_temp.ok('Member cannot change the stored email', true);
  end;
  begin
    update member_accounts set deletion_requested_at = null where id = '00000000-0000-4000-8000-0000000002a2';
    perform pg_temp.ok('Member cannot change deletion status directly', false);
  exception when insufficient_privilege then perform pg_temp.ok('Member cannot change deletion status directly', true);
  end;
  begin
    update member_accounts set company_name = '' where id = '00000000-0000-4000-8000-0000000002a2';
    perform pg_temp.ok('Member cannot blank a required field', false);
  exception when check_violation then perform pg_temp.ok('Member cannot blank a required field', true);
  end;
  begin
    update member_accounts set professional_website = 'javascript:alert(1)' where id = '00000000-0000-4000-8000-0000000002a2';
    perform pg_temp.ok('A website that is not a real web address is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A website that is not a real web address is refused', true);
  end;
  begin
    insert into member_accounts (id, account_type, email, full_name, country) values (gen_random_uuid(), 'personal', 'x@test.invalid', 'X', 'Peru');
    perform pg_temp.ok('Member cannot create extra accounts', false);
  exception when insufficient_privilege then perform pg_temp.ok('Member cannot create extra accounts', true);
  end;
  begin
    perform feature_item('artist', '00000000-0000-4000-8000-0000000002a2');
    perform pg_temp.ok('Member cannot use team functions (featuring)', false);
  exception when insufficient_privilege then perform pg_temp.ok('Member cannot use team functions (featuring)', true);
  end;
end $$;

-- Private tables: either refused outright or empty for a member.
do $$
declare t text; n bigint;
begin
  foreach t in array array['applications', 'application_notes', 'audit_log', 'artists', 'artworks', 'team_members', 'featured_items'] loop
    begin
      execute format('select count(*) from %I', t) into n;
      perform pg_temp.ok('Member sees nothing in ' || t, n = 0);
    exception when insufficient_privilege then
      perform pg_temp.ok('Member sees nothing in ' || t, true);
    end;
  end loop;
end $$;
reset role;

-- Visitors (not signed in) can never read member accounts.
set local role anon;
do $$
begin
  begin
    perform 1 from member_accounts limit 1;
    perform pg_temp.ok('Visitors cannot read member accounts', false);
  exception when insufficient_privilege then perform pg_temp.ok('Visitors cannot read member accounts', true);
  end;
  begin
    perform 1 from featured_items limit 1;
    perform pg_temp.ok('Visitors cannot read the homepage settings table', false);
  exception when insufficient_privilege then perform pg_temp.ok('Visitors cannot read the homepage settings table', true);
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Public profiles: traditions, edits back to review, homepage selection
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id) values
 ('00000000-0000-4000-8000-0000000002b1', 'p2-artist@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
 ('00000000-0000-4000-8000-0000000002b2', 'p2-hidden@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
insert into applications (id, reference, full_name, artist_name, email, country, city, primary_discipline, practice, consent_version, consent_at, status, artist_id) values
 ('00000000-0000-4000-8000-0000000002c1','TEST-P2-1','Artist Person','Public Artist','p2-artist@test.invalid','Japan','Kyoto','Ceramics','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000002b1'),
 ('00000000-0000-4000-8000-0000000002c2','TEST-P2-2','Hidden Person','Hidden Artist','p2-hidden@test.invalid','Japan','Kyoto','Ceramics','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000002b2');
insert into artists (id, application_id, email, legal_name, display_name, craft, bio, traditions, profile_status, terms_version, terms_accepted_at) values
 ('00000000-0000-4000-8000-0000000002b1','00000000-0000-4000-8000-0000000002c1','p2-artist@test.invalid','Legal','Public Artist','Ceramics','Bio','Kintsugi','approved',(select value from app_config where key='terms_version_current'),now()),
 ('00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002c2','p2-hidden@test.invalid','Legal','Hidden Artist','Ceramics','Bio','','approved','2026-10-21',now());
insert into artworks (id, artist_id, title, status, images, price_on_request, feedback) values
 ('00000000-0000-4000-8000-0000000002d1','00000000-0000-4000-8000-0000000002b1','Public bowl','approved','{}',true,''),
 ('00000000-0000-4000-8000-0000000002d2','00000000-0000-4000-8000-0000000002b1','Draft bowl','draft','{}',true,'');
insert into featured_items (kind, item_id, position) values
 ('artist','00000000-0000-4000-8000-0000000002b1',0), ('artist','00000000-0000-4000-8000-0000000002b2',1),
 ('artwork','00000000-0000-4000-8000-0000000002d1',0), ('artwork','00000000-0000-4000-8000-0000000002d2',1);

set local role anon;
select pg_temp.ok('Cultural traditions are not part of the public profile (since update 010)',
  not exists (select 1 from information_schema.columns where table_name = 'public_artists' and column_name = 'traditions'));
select pg_temp.ok('Homepage shows a featured public artist', exists (select 1 from public_featured_artists where id = '00000000-0000-4000-8000-0000000002b1'));
select pg_temp.ok('Homepage never shows a featured artist who is not public (old terms)', not exists (select 1 from public_featured_artists where id = '00000000-0000-4000-8000-0000000002b2'));
select pg_temp.ok('Homepage shows a featured public artwork with its artist', exists (select 1 from public_featured_artworks where id = '00000000-0000-4000-8000-0000000002d1' and artist_name = 'Public Artist'));
select pg_temp.ok('Homepage never shows a featured artwork that is not approved', not exists (select 1 from public_featured_artworks where id = '00000000-0000-4000-8000-0000000002d2'));
select pg_temp.ok('Public views still have no private columns', not exists (
  select 1 from information_schema.columns
  where table_name in ('public_artists','public_artworks','public_featured_artists','public_featured_artworks')
    and column_name in ('email','legal_name','instagram','website','other_link','feedback','profile_status','status','phone','reviewed_by','created_by')));
reset role;

-- Traditions are private (update 010): editing them keeps the profile public.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);
update artists set traditions = 'Kintsugi and raku' where id = '00000000-0000-4000-8000-0000000002b1';
reset role;
select pg_temp.ok('Editing private traditions does not hide the profile',
  (select profile_status from artists where id = '00000000-0000-4000-8000-0000000002b1') = 'approved');
-- Editing the biography does send it back to review.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);
update artists set bio = 'A changed biography' where id = '00000000-0000-4000-8000-0000000002b1';
reset role;
select pg_temp.ok('Editing the biography sends an approved profile back to review',
  (select profile_status from artists where id = '00000000-0000-4000-8000-0000000002b1') = 'draft');
set local role anon;
select pg_temp.ok('The edited profile is hidden until approved again', not exists (select 1 from public_artists where id = '00000000-0000-4000-8000-0000000002b1'));
select pg_temp.ok('Its artworks and homepage places are hidden too',
  not exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000002d1')
  and not exists (select 1 from public_featured_artists where id = '00000000-0000-4000-8000-0000000002b1'));
reset role;

-- Finish by stopping the transaction on purpose: every test row is discarded.
do $$
declare passed int; total int; failed text;
begin
  select count(*) filter (where result = 'PASS'), count(*) into passed, total from t_results;
  select string_agg(check_name, '; ' order by n) into failed from t_results where result <> 'PASS';
  raise exception 'PHASE 2 TEST FINISHED, nothing was saved. % of % checks passed.%',
    passed, total, coalesce(' FAILED: ' || failed, ' All good.');
end $$;
