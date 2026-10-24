-- =============================================================================
-- Phase 1 publishing test. Run in Supabase > SQL Editor AFTER update 008.
-- Everything happens inside one transaction that is cancelled at the end:
-- no test data is kept, no emails are sent, nothing real is changed.
-- Supabase then shows a red message that starts with "PHASE 1 TEST FINISHED"
-- and says how many checks passed. That red message is expected.
-- =============================================================================
begin;

create temp table t_results (n serial, check_name text, result text) on commit drop;
grant all on t_results to anon;
grant usage, select on sequence t_results_n_seq to anon;

-- Sample accounts (rolled back at the end)
insert into auth.users (id, email, aud, role, instance_id)
values ('00000000-0000-4000-8000-0000000000a1', 'p1-approved@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
       ('00000000-0000-4000-8000-0000000000a2', 'p1-pending@test.invalid',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
       ('00000000-0000-4000-8000-0000000000a3', 'p1-oldterms@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
       ('00000000-0000-4000-8000-0000000000a4', 'p1-declined@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into applications (id, reference, full_name, artist_name, email, country, city, primary_discipline, practice, consent_version, consent_at, status, artist_id)
values
 ('00000000-0000-4000-8000-0000000000b1','TEST-P1-1','Approved Person','Approved Artist','p1-approved@test.invalid','Lebanon','Beirut','Glass','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000000a1'),
 ('00000000-0000-4000-8000-0000000000b2','TEST-P1-2','Pending Person','Pending Artist','p1-pending@test.invalid','Lebanon','Beirut','Glass','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000000a2'),
 ('00000000-0000-4000-8000-0000000000b3','TEST-P1-3','Old Terms Person','Old Terms Artist','p1-oldterms@test.invalid','Lebanon','Beirut','Glass','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000000a3'),
 ('00000000-0000-4000-8000-0000000000b4','TEST-P1-4','Declined Person','Declined Account','p1-declined@test.invalid','Lebanon','Beirut','Glass','Test practice text long enough for checks.','t',now(),'declined','00000000-0000-4000-8000-0000000000a4');

insert into artists (id, application_id, email, legal_name, display_name, craft, bio, instagram, website, profile_status, terms_version, terms_accepted_at, avatar_path)
values
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1','p1-approved@test.invalid','Secret Legal Name','Approved Artist','Glass','Bio','@private_handle','https://private.example','approved','2026-10-24',now(),'00000000-0000-4000-8000-0000000000a1/avatar.jpg'),
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000b2','p1-pending@test.invalid','Pending Legal','Pending Artist','Glass','Bio','','','submitted','2026-10-24',now(),''),
 ('00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-0000000000b3','p1-oldterms@test.invalid','Old Legal','Old Terms Artist','Glass','Bio','','','approved','2026-10-21',now(),''),
 ('00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-0000000000b4','p1-declined@test.invalid','Declined Legal','Declined Account','Glass','Bio','','','approved','2026-10-24',now(),'');

insert into artworks (id, artist_id, title, status, images, price_on_request, feedback)
values
 ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1','Approved work of approved artist','approved','{00000000-0000-4000-8000-0000000000a1/works/c1/1.jpg}',true,''),
 ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000a1','Submitted work of approved artist','submitted','{00000000-0000-4000-8000-0000000000a1/works/c2/1.jpg}',true,'private feedback'),
 ('00000000-0000-4000-8000-0000000000c3','00000000-0000-4000-8000-0000000000a1','Declined work of approved artist','declined','{}',true,''),
 ('00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000a2','Approved work of pending artist','approved','{}',true,''),
 ('00000000-0000-4000-8000-0000000000c5','00000000-0000-4000-8000-0000000000a3','Approved work of old-terms artist','approved','{}',true,''),
 ('00000000-0000-4000-8000-0000000000c6','00000000-0000-4000-8000-0000000000a4','Approved work of declined account','approved','{}',true,'');

-- Everything below runs as an anonymous visitor (the public internet).
set local role anon;

insert into t_results (check_name, result) select 'Approved artist is public',
  case when exists (select 1 from public_artists where id = '00000000-0000-4000-8000-0000000000a1') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Profile not yet approved stays hidden',
  case when not exists (select 1 from public_artists where id = '00000000-0000-4000-8000-0000000000a2') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Artist who has not agreed to current terms stays hidden',
  case when not exists (select 1 from public_artists where id = '00000000-0000-4000-8000-0000000000a3') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Declined account stays hidden',
  case when not exists (select 1 from public_artists where id = '00000000-0000-4000-8000-0000000000a4') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Approved artwork of approved artist is public',
  case when exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000000c1') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Submitted artwork of approved artist stays hidden',
  case when not exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000000c2') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Declined artwork stays hidden',
  case when not exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000000c3') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Approved artworks of hidden artists stay hidden',
  case when not exists (select 1 from public_artworks where id in ('00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000c5','00000000-0000-4000-8000-0000000000c6')) then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Public view has no private columns',
  case when not exists (
    select 1 from information_schema.columns
    where table_name in ('public_artists','public_artworks')
      and column_name in ('email','legal_name','instagram','website','other_link','feedback','profile_status','status','published','reviewed_by')
  ) then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Public photo rule: approved artwork photo allowed',
  case when is_public_media('00000000-0000-4000-8000-0000000000a1/works/c1/1.jpg') then 'PASS' else 'FAIL' end;
insert into t_results (check_name, result) select 'Public photo rule: unapproved artwork photo refused',
  case when not is_public_media('00000000-0000-4000-8000-0000000000a1/works/c2/1.jpg') then 'PASS' else 'FAIL' end;

-- Visitors must still be refused the private tables themselves.
do $$ begin
  begin
    perform 1 from artists limit 1;
    insert into t_results (check_name, result) values ('Visitors cannot read the artists table', 'FAIL');
  exception when insufficient_privilege then
    insert into t_results (check_name, result) values ('Visitors cannot read the artists table', 'PASS');
  end;
  begin
    perform 1 from artworks limit 1;
    insert into t_results (check_name, result) values ('Visitors cannot read the artworks table', 'FAIL');
  exception when insufficient_privilege then
    insert into t_results (check_name, result) values ('Visitors cannot read the artworks table', 'PASS');
  end;
end $$;

-- Approving an artwork (what the team's Approve button does) publishes it at once.
reset role;
update artworks set status = 'approved' where id = '00000000-0000-4000-8000-0000000000c2';
set local role anon;
insert into t_results (check_name, result) select 'Approving an artwork makes it public automatically',
  case when exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000000c2') then 'PASS' else 'FAIL' end;

-- An artist editing an approved artwork sends it back for review (existing rule) and hides it.
reset role;
update artworks set status = 'draft' where id = '00000000-0000-4000-8000-0000000000c1';
set local role anon;
insert into t_results (check_name, result) select 'Artwork back in review is hidden again',
  case when not exists (select 1 from public_artworks where id = '00000000-0000-4000-8000-0000000000c1') then 'PASS' else 'FAIL' end;

reset role;

-- Finish by stopping the transaction on purpose: Supabase shows this message,
-- and every test row (and any alert email or Sheet update they queued) is discarded.
do $$
declare passed int; total int; failed text;
begin
  select count(*) filter (where result = 'PASS'), count(*) into passed, total from t_results;
  select string_agg(check_name, '; ' order by n) into failed from t_results where result <> 'PASS';
  raise exception 'PHASE 1 TEST FINISHED, nothing was saved. % of % checks passed.%',
    passed, total, coalesce(' FAILED: ' || failed, ' All good.');
end $$;
