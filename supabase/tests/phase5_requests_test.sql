-- =============================================================================
-- Phase 5 test: commissions, collaborations and projects; proposals and the
-- client's decision; client updates; next action; artist help requests;
-- artist materials; directory order; homepage draft and publish; pinned
-- featured items. Run in Supabase > SQL Editor AFTER update 012.
-- Everything happens inside one transaction that is cancelled at the end:
-- no test data is kept, no emails are sent, nothing real is changed.
-- Supabase then shows a red message that starts with "PHASE 5 TEST FINISHED"
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
create or replace function pg_temp.act(uid text, sid text default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sid)::text, true)
$$;

-- ---------------------------------------------------------------------------
-- Sample people: three members, two artists (one public), three team members
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values
 ('00000000-0000-4000-8000-0000000005a1', 'p5-personal@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"personal","full_name":"Personal Five","country":"Lebanon","phone":"+961 1 234 567"}'),
 ('00000000-0000-4000-8000-0000000005a2', 'p5-pro@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"professional","full_name":"Pro Five","country":"France","professional_role":"Interior designer","company_name":"Atelier P5"}'),
 ('00000000-0000-4000-8000-0000000005a3', 'p5-biz@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"business","full_name":"Biz Five","country":"United Arab Emirates","business_name":"Hotel P5","contact_person":"Biz Five","business_type":"Hotel"}'),
 ('00000000-0000-4000-8000-0000000005b1', 'p5-artist@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000005b2', 'p5-hidden@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000005e1', 'p5-founder@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000005e2', 'p5-sales@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000005e3', 'p5-ops@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');

insert into applications (id, reference, full_name, artist_name, email, country, city, primary_discipline, practice, consent_version, consent_at, status, artist_id) values
 ('00000000-0000-4000-8000-0000000005c1','TEST-P5-1','Artist P5','Public P5','p5-artist@test.invalid','Japan','Kyoto','Ceramics','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000005b1'),
 ('00000000-0000-4000-8000-0000000005c2','TEST-P5-2','Hidden P5','Hidden P5','p5-hidden@test.invalid','Japan','Kyoto','Ceramics','Test practice text long enough for checks.','t',now(),'approved','00000000-0000-4000-8000-0000000005b2');
insert into artists (id, application_id, email, legal_name, display_name, craft, techniques, bio, profile_status, terms_version, terms_accepted_at) values
 ('00000000-0000-4000-8000-0000000005b1','00000000-0000-4000-8000-0000000005c1','p5-artist@test.invalid','Legal','Public P5','Ceramics','Raku','Bio','approved',(select value from app_config where key='terms_version_current'),now()),
 ('00000000-0000-4000-8000-0000000005b2','00000000-0000-4000-8000-0000000005c2','p5-hidden@test.invalid','Legal','Hidden P5','Ceramics','','Bio','submitted',(select value from app_config where key='terms_version_current'),now());
insert into artworks (id, artist_id, title, status, images, price_on_request, feedback) values
 ('00000000-0000-4000-8000-0000000005d1','00000000-0000-4000-8000-0000000005b1','Public work P5','approved','{}',true,'');

insert into team_members (user_id, name, email, role, active) values
 ('00000000-0000-4000-8000-0000000005e1', 'Founder Five', 'p5-founder@test.invalid', 'founder', true),
 ('00000000-0000-4000-8000-0000000005e2', 'Sales Five', 'p5-sales@test.invalid', 'sales', true),
 ('00000000-0000-4000-8000-0000000005e3', 'Ops Five', 'p5-ops@test.invalid', 'operations', true);
insert into team_session_checks (session_id, user_id, code_hash, expires_at, verified_at) values
 ('00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-0000000005e1', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000005f2', '00000000-0000-4000-8000-0000000005e2', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000005f3', '00000000-0000-4000-8000-0000000005e3', 'x', now() + interval '1 hour', now());

-- ---------------------------------------------------------------------------
-- 1. Creating requests
-- ---------------------------------------------------------------------------
set local role anon;
do $$ begin
  begin
    perform create_project_request('{"kind":"commission"}'::jsonb);
    perform pg_temp.ok('Visitors cannot send requests', false);
  exception when insufficient_privilege then perform pg_temp.ok('Visitors cannot send requests', true);
  end;
end $$;
reset role;

set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000005a1');
do $$
declare r jsonb;
begin
  begin
    perform create_project_request(jsonb_build_object('kind', 'project', 'description', 'A project from a personal account here.', 'artwork_type', 'Lobby', 'budget_undecided', true, 'timeline_undecided', true));
    perform pg_temp.ok('A Personal account cannot send a project brief', false);
  exception when insufficient_privilege then perform pg_temp.ok('A Personal account cannot send a project brief', true);
  end;
  begin
    perform create_project_request(jsonb_build_object('kind', 'collaboration', 'description', 'Bring two practices together on a screen.', 'budget_undecided', true, 'timeline_undecided', true));
    perform pg_temp.ok('A collaboration needs at least one chosen artist', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A collaboration needs at least one chosen artist', true);
  end;
  begin
    perform create_project_request(jsonb_build_object('kind', 'collaboration', 'description', 'Bring two practices together on a screen.', 'budget_undecided', true, 'timeline_undecided', true,
      'artists', jsonb_build_array('00000000-0000-4000-8000-0000000005b2')));
    perform pg_temp.ok('An artist who is not public cannot be chosen', false);
  exception when invalid_parameter_value then perform pg_temp.ok('An artist who is not public cannot be chosen', true);
  end;
  r := create_project_request(jsonb_build_object('kind', 'commission', 'description', 'A large vase for our entrance hall, in blue tones.', 'artwork_type', 'Ceramic vase',
      'budget', 'USD 2,000', 'timeline_undecided', true, 'artists', jsonb_build_array('00000000-0000-4000-8000-0000000005b1')));
  insert into t_ids values ('com', (r->>'id')::uuid);
  perform pg_temp.ok('A Personal account sends a commission idea with a chosen artist', r->>'kind' = 'commission');
end $$;
select pg_temp.ok('The client sees their commission as received, with no answer needed',
  (select client_status = 'received' and not needs_answer from my_project_requests() where id = (select v from t_ids where k = 'com')));

select pg_temp.act('00000000-0000-4000-8000-0000000005a2');
do $$
declare r jsonb;
begin
  r := create_project_request(jsonb_build_object('kind', 'collaboration', 'description', 'Ceramics and textile together for a restaurant wall.', 'disciplines_wanted', 'Ceramics, textile',
      'budget', 'EUR 6,000', 'timeline', 'Spring', 'artists', jsonb_build_array('00000000-0000-4000-8000-0000000005b1')));
  insert into t_ids values ('col', (r->>'id')::uuid);
  perform pg_temp.ok('A Professional member sends a collaboration request', r->>'kind' = 'collaboration');
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000005a3');
do $$
declare r jsonb;
begin
  begin
    perform create_project_request(jsonb_build_object('kind', 'project', 'description', 'Artworks for twelve guest rooms and the lobby.', 'artwork_type', 'Hotel',
      'budget_undecided', true, 'timeline_undecided', true, 'files', jsonb_build_array('00000000-0000-4000-8000-0000000005a1/someone-else.pdf')));
    perform pg_temp.ok('A file from another person cannot be attached', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A file from another person cannot be attached', true);
  end;
  r := create_project_request(jsonb_build_object('kind', 'project', 'description', 'Artworks for twelve guest rooms and the lobby.', 'artwork_type', 'Hotel',
      'purpose', 'Welcome guests with local craft', 'budget_undecided', true, 'timeline', 'Opening in June'));
  insert into t_ids values ('prj', (r->>'id')::uuid);
  perform pg_temp.ok('A Business member sends a project brief', r->>'kind' = 'project');
end $$;
select pg_temp.ok('Members cannot read the request tables directly', (select count(*) from project_requests) = 0 and (select count(*) from project_proposals) = 0);
reset role;

select pg_temp.ok('The chosen artist is recorded as nominated by the client',
  exists (select 1 from project_artists where project_id = (select v from t_ids where k = 'col') and nominated_by_client and state = 'nominated'));

-- ---------------------------------------------------------------------------
-- 2. Coordination: artists, next action, proposals, client decision
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000005e2', '00000000-0000-4000-8000-0000000005f2');
do $$ begin
  begin
    perform save_proposal((select v from t_ids where k = 'col'), null, '{"creative_direction":"x"}'::jsonb);
    perform pg_temp.ok('A sales member cannot change a request not assigned to them', false);
  exception when insufficient_privilege then perform pg_temp.ok('A sales member cannot change a request not assigned to them', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000005e3', '00000000-0000-4000-8000-0000000005f3');
do $$ begin
  begin
    perform post_project_update((select v from t_ids where k = 'col'), 'An update from operations.');
    perform pg_temp.ok('Operations cannot share updates with clients', false);
  exception when insufficient_privilege then perform pg_temp.ok('Operations cannot share updates with clients', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000005f1');
select update_project_artist((select v from t_ids where k = 'col'), '00000000-0000-4000-8000-0000000005b1',
  '{"state":"available","price_note":"SECRET-PRICE-NOTE","timeline_note":"8 weeks","response_note":"Happy to join"}'::jsonb);
select pg_temp.ok('The team records an artist''s availability and price',
  exists (select 1 from project_artists where project_id = (select v from t_ids where k = 'col') and state = 'available' and price_note = 'SECRET-PRICE-NOTE' and responded_at is not null and nominated_by_client));
select set_project_next((select v from t_ids where k = 'col'), 'artist', 'Confirm the second artist', current_date + 3);
select pg_temp.ok('The next action and waiting state are recorded',
  exists (select 1 from project_requests where id = (select v from t_ids where k = 'col') and waiting_on = 'artist' and next_action = 'Confirm the second artist'));
do $$
declare pid uuid;
begin
  begin
    perform set_project_next((select v from t_ids where k = 'col'), 'everyone', '', null);
    perform pg_temp.ok('An unknown waiting state is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('An unknown waiting state is refused', true);
  end;
  begin
    perform save_proposal((select v from t_ids where k = 'col'), null, jsonb_build_object('artists', jsonb_build_array(jsonb_build_object('artist_id', '00000000-0000-4000-8000-0000000005b2'))));
    perform pg_temp.ok('A proposal cannot include an artist who is not public', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A proposal cannot include an artist who is not public', true);
  end;
  pid := save_proposal((select v from t_ids where k = 'col'), null, jsonb_build_object('creative_direction', 'Short',
    'artists', jsonb_build_array(jsonb_build_object('artist_id', '00000000-0000-4000-8000-0000000005b1', 'contribution', 'Glazed tiles'))));
  insert into t_ids values ('prop1', pid);
  begin
    perform send_proposal(pid);
    perform pg_temp.ok('An incomplete proposal cannot be sent', false);
  exception when invalid_parameter_value then perform pg_temp.ok('An incomplete proposal cannot be sent', true);
  end;
  perform save_proposal((select v from t_ids where k = 'col'), pid, jsonb_build_object('creative_direction', 'Glazed tiles framed by woven panels across the wall.',
    'budget', 'EUR 5,800', 'timeline', '10 weeks', 'message', 'Here is our first proposal.',
    'artists', jsonb_build_array(jsonb_build_object('artist_id', '00000000-0000-4000-8000-0000000005b1', 'contribution', 'Glazed tiles', 'materials', 'Stoneware'))));
end $$;
select pg_temp.ok('A proposal draft is saved, with the artist''s name taken from the profile',
  (select artists->0->>'name' from project_proposals where id = (select v from t_ids where k = 'prop1')) = 'Public P5');

select pg_temp.act('00000000-0000-4000-8000-0000000005a2');
select pg_temp.ok('The client does not see a draft proposal',
  jsonb_array_length(my_request_detail((select v from t_ids where k = 'col'))->'proposals') = 0);

select pg_temp.act('00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000005f1');
select send_proposal((select v from t_ids where k = 'prop1'));
select pg_temp.ok('Sending a proposal sets "Proposal sent" and waits for the client',
  exists (select 1 from project_requests where id = (select v from t_ids where k = 'col') and status = 'proposal_sent' and waiting_on = 'client'));
select post_project_update((select v from t_ids where k = 'col'), 'Your proposal is ready in your account.');

select pg_temp.act('00000000-0000-4000-8000-0000000005a1');
do $$ begin
  begin
    perform respond_proposal((select v from t_ids where k = 'prop1'), 'accept', '');
    perform pg_temp.ok('Another member cannot answer the proposal', false);
  exception when insufficient_privilege then perform pg_temp.ok('Another member cannot answer the proposal', true);
  end;
  begin
    perform my_request_detail((select v from t_ids where k = 'col'));
    perform pg_temp.ok('Another member cannot open the request', false);
  exception when no_data_found then perform pg_temp.ok('Another member cannot open the request', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000005a2');
select pg_temp.ok('The client sees "Proposal ready" and that an answer is needed',
  (select client_status = 'proposal_ready' and needs_answer from my_project_requests() where id = (select v from t_ids where k = 'col')));
select pg_temp.ok('The client sees the sent proposal and the update',
  jsonb_array_length(my_request_detail((select v from t_ids where k = 'col'))->'proposals') = 1
  and jsonb_array_length(my_request_detail((select v from t_ids where k = 'col'))->'updates') = 1);
select pg_temp.ok('Internal artist answers and prices never reach the client',
  position('SECRET-PRICE-NOTE' in my_request_detail((select v from t_ids where k = 'col'))::text) = 0);
do $$ begin
  begin
    perform respond_proposal((select v from t_ids where k = 'prop1'), 'changes', 'short');
    perform pg_temp.ok('Asking for changes needs a message', false);
  exception when invalid_parameter_value then perform pg_temp.ok('Asking for changes needs a message', true);
  end;
end $$;
select respond_proposal((select v from t_ids where k = 'prop1'), 'changes', 'Could the woven panels be in warmer colours?');
select pg_temp.ok('Asking for changes puts the request in discussion, waiting for the team',
  (select client_status from my_project_requests() where id = (select v from t_ids where k = 'col')) = 'in_discussion');
reset role;
select pg_temp.ok('The client''s request for changes is recorded on the proposal',
  exists (select 1 from project_proposals where id = (select v from t_ids where k = 'prop1') and status = 'changes_requested' and client_response like 'Could the woven%'));

set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000005f1');
do $$
declare pid uuid;
begin
  pid := save_proposal((select v from t_ids where k = 'col'), null, jsonb_build_object('creative_direction', 'Glazed tiles framed by woven panels in ochre and rust.',
    'budget', 'EUR 6,000', 'timeline', '10 weeks', 'artists', jsonb_build_array(jsonb_build_object('artist_id', '00000000-0000-4000-8000-0000000005b1', 'contribution', 'Glazed tiles'))));
  insert into t_ids values ('prop2', pid);
  perform send_proposal(pid);
end $$;
select pg_temp.ok('A revised proposal gets the next version number',
  (select version from project_proposals where id = (select v from t_ids where k = 'prop2')) = 2);

select pg_temp.act('00000000-0000-4000-8000-0000000005a2');
select respond_proposal((select v from t_ids where k = 'prop2'), 'accept', '');
select pg_temp.ok('Accepting the proposal confirms the request',
  (select client_status from my_project_requests() where id = (select v from t_ids where k = 'col')) = 'confirmed');
do $$ begin
  begin
    perform respond_proposal((select v from t_ids where k = 'prop2'), 'decline', '');
    perform pg_temp.ok('A proposal cannot be answered twice', false);
  exception when invalid_parameter_value then perform pg_temp.ok('A proposal cannot be answered twice', true);
  end;
end $$;
reset role;
select pg_temp.ok('The decision is in the request history',
  exists (select 1 from project_events where project_id = (select v from t_ids where k = 'col') and kind = 'client_accepted'));

-- ---------------------------------------------------------------------------
-- 3. Artist help requests and materials
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000005a1');
do $$ begin
  begin
    perform create_artist_request('other', 'I am a member, not an artist.');
    perform pg_temp.ok('Members cannot use the artists'' help requests', false);
  exception when insufficient_privilege then perform pg_temp.ok('Members cannot use the artists'' help requests', true);
  end;
end $$;
select pg_temp.act('00000000-0000-4000-8000-0000000005b1');
select create_artist_request('collaboration', 'I would love to work with a glass artist.');
select pg_temp.ok('An artist asks the team for help', (select count(*) from artist_requests) = 1);
select pg_temp.act('00000000-0000-4000-8000-0000000005b2');
select pg_temp.ok('Another artist cannot read it', (select count(*) from artist_requests) = 0);
select pg_temp.act('00000000-0000-4000-8000-0000000005e3', '00000000-0000-4000-8000-0000000005f3');
select set_artist_request((select id from artist_requests where artist_id = '00000000-0000-4000-8000-0000000005b1'), 'closed', 'Replied by email');
select pg_temp.ok('The team marks it as answered',
  (select status from artist_requests where artist_id = '00000000-0000-4000-8000-0000000005b1') = 'closed');

-- ---------------------------------------------------------------------------
-- 4. Public website: directory order, featured items, homepage
-- ---------------------------------------------------------------------------
select set_directory_order(array['00000000-0000-4000-8000-0000000005b1']::uuid[]);
select pin_featured('artist', '00000000-0000-4000-8000-0000000005b1', true);
select feature_item('artist', '00000000-0000-4000-8000-0000000005b1');
select pin_featured('artist', '00000000-0000-4000-8000-0000000005b1', true);
select save_site_draft('home', '{"sections":[{"id":"hero","enabled":true,"title":"P5-DRAFT-MARKER"}]}'::jsonb);

select pg_temp.act('00000000-0000-4000-8000-0000000005e2', '00000000-0000-4000-8000-0000000005f2');
do $$ begin
  begin
    perform save_site_draft('home', '{"sections":[]}'::jsonb);
    perform pg_temp.ok('Sales members cannot edit the homepage', false);
  exception when insufficient_privilege then perform pg_temp.ok('Sales members cannot edit the homepage', true);
  end;
end $$;
select pg_temp.act('00000000-0000-4000-8000-0000000005a1');
select pg_temp.ok('Members cannot read the homepage draft', (select count(*) from site_pages) = 0);
reset role;

set local role anon;
select pg_temp.ok('Visitors see the team''s directory order', (select directory_rank from public_artists where id = '00000000-0000-4000-8000-0000000005b1') = 1);
select pg_temp.ok('Visitors see the artist as a pinned featured artist', exists (select 1 from public_featured_artists where id = '00000000-0000-4000-8000-0000000005b1' and pinned));
select pg_temp.ok('An unpublished draft never reaches visitors',
  not exists (select 1 from public_site_pages where content::text like '%P5-DRAFT-MARKER%'));
reset role;

set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000005e3', '00000000-0000-4000-8000-0000000005f3');
select publish_site_page('home');
reset role;
set local role anon;
select pg_temp.ok('After publishing, visitors see the new homepage',
  exists (select 1 from public_site_pages where key = 'home' and content::text like '%P5-DRAFT-MARKER%'));
reset role;

-- Last, because it hides the artist: editing materials sends an approved profile back to review.
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000005b1');
update artists set materials = 'Stoneware, porcelain' where id = '00000000-0000-4000-8000-0000000005b1';
reset role;
select pg_temp.ok('Changing materials sends an approved profile back to review',
  (select profile_status from artists where id = '00000000-0000-4000-8000-0000000005b1') = 'draft');

-- Finish by stopping the transaction on purpose: every test row is discarded.
do $$
declare passed int; total int; failed text;
begin
  select count(*) filter (where result = 'PASS'), count(*) into passed, total from t_results;
  select string_agg(check_name, '; ' order by n) into failed from t_results where result <> 'PASS';
  raise exception 'PHASE 5 TEST FINISHED, nothing was saved. % of % checks passed.%',
    passed, total, coalesce(' FAILED: ' || failed, ' All good.');
end $$;
