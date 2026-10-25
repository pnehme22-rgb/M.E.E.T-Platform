-- =============================================================================
-- Phase 6 test: revenue figures only for founders and the assigned sales team
-- member; client milestones only as the team marks them. Run in Supabase >
-- SQL Editor AFTER update 013. Everything happens inside one transaction that
-- is cancelled at the end: nothing is kept, no emails are sent.
-- Supabase then shows a red message that starts with "PHASE 6 TEST FINISHED".
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

insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values
 ('00000000-0000-4000-8000-0000000006a1', 'p6-pro@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"professional","full_name":"Pro Six","country":"France","professional_role":"Designer","company_name":"Atelier P6"}'),
 ('00000000-0000-4000-8000-0000000006a2', 'p6-other@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
  '{"account_type":"personal","full_name":"Other Six","country":"Lebanon"}'),
 ('00000000-0000-4000-8000-0000000006e1', 'p6-founder@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000006e2', 'p6-sales1@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
 ('00000000-0000-4000-8000-0000000006e3', 'p6-sales2@test.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');
insert into team_members (user_id, name, email, role, active) values
 ('00000000-0000-4000-8000-0000000006e1', 'Founder Six', 'p6-founder@test.invalid', 'founder', true),
 ('00000000-0000-4000-8000-0000000006e2', 'Sales Assigned', 'p6-sales1@test.invalid', 'sales', true),
 ('00000000-0000-4000-8000-0000000006e3', 'Sales Other', 'p6-sales2@test.invalid', 'sales', true);
insert into team_session_checks (session_id, user_id, code_hash, expires_at, verified_at) values
 ('00000000-0000-4000-8000-0000000006f1', '00000000-0000-4000-8000-0000000006e1', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000006f2', '00000000-0000-4000-8000-0000000006e2', 'x', now() + interval '1 hour', now()),
 ('00000000-0000-4000-8000-0000000006f3', '00000000-0000-4000-8000-0000000006e3', 'x', now() + interval '1 hour', now());

-- A request with figures, assigned to Sales Assigned.
insert into project_requests (id, member_id, client_name, client_type, client_country, kind, description, artwork_type, budget_undecided, timeline_undecided,
                              assigned_to, currency, estimated_value, fee_terms)
values ('00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-0000000006a1', 'Pro Six', 'professional', 'France', 'commission',
        'A test request with figures for phase six.', 'Vase', true, true, '00000000-0000-4000-8000-0000000006e2', 'USD', 4321, '10 percent');
insert into project_events (project_id, actor, actor_name, kind, detail)
values ('00000000-0000-4000-8000-0000000006c1', '00000000-0000-4000-8000-0000000006e1', 'Founder Six', 'money', '{"estimated_value": 4321}');

-- ---------------------------------------------------------------------------
-- 1. Revenue figures
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000006e3', '00000000-0000-4000-8000-0000000006f3');
do $$ begin
  begin
    perform estimated_value from project_requests where id = '00000000-0000-4000-8000-0000000006c1';
    perform pg_temp.ok('Figures cannot be read from the table directly', false);
  exception when insufficient_privilege then perform pg_temp.ok('Figures cannot be read from the table directly', true);
  end;
end $$;
select pg_temp.ok('A sales member sees the request itself',
  exists (select 1 from project_requests where id = '00000000-0000-4000-8000-0000000006c1'));
select pg_temp.ok('A sales member not assigned to it gets no figures',
  (select count(*) from project_money('00000000-0000-4000-8000-0000000006c1')) = 0);
select pg_temp.ok('A sales member not assigned to it cannot see figure history',
  not exists (select 1 from project_events where project_id = '00000000-0000-4000-8000-0000000006c1' and kind = 'money'));
select pg_temp.ok('A sales member gets nothing from the founders'' report', (select count(*) from project_money_report()) = 0);
do $$ begin
  begin
    perform update_project_money('00000000-0000-4000-8000-0000000006c1', '{"currency":"USD","estimated_value":"1"}'::jsonb);
    perform pg_temp.ok('A sales member not assigned to it cannot change figures', false);
  exception when insufficient_privilege then perform pg_temp.ok('A sales member not assigned to it cannot change figures', true);
  end;
  begin
    perform set_client_milestones('00000000-0000-4000-8000-0000000006c1', array['received']);
    perform pg_temp.ok('A sales member not assigned to it cannot mark milestones', false);
  exception when insufficient_privilege then perform pg_temp.ok('A sales member not assigned to it cannot mark milestones', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000006e2', '00000000-0000-4000-8000-0000000006f2');
select pg_temp.ok('The assigned sales member sees the figures',
  (select estimated_value from project_money('00000000-0000-4000-8000-0000000006c1')) = 4321);
select pg_temp.ok('The assigned sales member sees the figure history',
  exists (select 1 from project_events where project_id = '00000000-0000-4000-8000-0000000006c1' and kind = 'money'));

select pg_temp.act('00000000-0000-4000-8000-0000000006e1', '00000000-0000-4000-8000-0000000006f1');
select pg_temp.ok('A founder sees the figures', (select fee_terms from project_money('00000000-0000-4000-8000-0000000006c1')) = '10 percent');
select pg_temp.ok('A founder sees the request in the report',
  exists (select 1 from project_money_report() where id = '00000000-0000-4000-8000-0000000006c1' and estimated_value = 4321));

select pg_temp.act('00000000-0000-4000-8000-0000000006a1');
select pg_temp.ok('The client gets no figures', (select count(*) from project_money('00000000-0000-4000-8000-0000000006c1')) = 0);

-- ---------------------------------------------------------------------------
-- 2. Client milestones
-- ---------------------------------------------------------------------------
select pg_temp.ok('Nothing is ticked before the team marks it',
  jsonb_array_length(my_request_detail('00000000-0000-4000-8000-0000000006c1')->'milestones') = 0);
reset role;
update project_requests set status = 'proposal_sent' where id = '00000000-0000-4000-8000-0000000006c1';
set local role authenticated;
select pg_temp.act('00000000-0000-4000-8000-0000000006a1');
select pg_temp.ok('A later status does not tick earlier steps',
  jsonb_array_length(my_request_detail('00000000-0000-4000-8000-0000000006c1')->'milestones') = 0
  and my_request_detail('00000000-0000-4000-8000-0000000006c1')->>'client_status' = 'proposal_ready');

select pg_temp.act('00000000-0000-4000-8000-0000000006e2', '00000000-0000-4000-8000-0000000006f2');
select set_client_milestones('00000000-0000-4000-8000-0000000006c1', array['received', 'under_review']);
do $$ begin
  begin
    perform set_client_milestones('00000000-0000-4000-8000-0000000006c1', array['paid']);
    perform pg_temp.ok('An unknown step is refused', false);
  exception when invalid_parameter_value then perform pg_temp.ok('An unknown step is refused', true);
  end;
end $$;

select pg_temp.act('00000000-0000-4000-8000-0000000006a1');
select pg_temp.ok('The client sees exactly the steps the team marked',
  my_request_detail('00000000-0000-4000-8000-0000000006c1')->'milestones' @> '["received","under_review"]'::jsonb
  and jsonb_array_length(my_request_detail('00000000-0000-4000-8000-0000000006c1')->'milestones') = 2);
select pg_temp.act('00000000-0000-4000-8000-0000000006a2');
do $$ begin
  begin
    perform my_request_detail('00000000-0000-4000-8000-0000000006c1');
    perform pg_temp.ok('Another member cannot open the request', false);
  exception when no_data_found then perform pg_temp.ok('Another member cannot open the request', true);
  end;
end $$;
reset role;
select pg_temp.ok('Marking milestones is in the request history',
  exists (select 1 from project_events where project_id = '00000000-0000-4000-8000-0000000006c1' and kind = 'milestones'));

do $$
declare passed int; total int; failed text;
begin
  select count(*) filter (where result = 'PASS'), count(*) into passed, total from t_results;
  select string_agg(check_name, '; ' order by n) into failed from t_results where result <> 'PASS';
  raise exception 'PHASE 6 TEST FINISHED, nothing was saved. % of % checks passed.%',
    passed, total, coalesce(' FAILED: ' || failed, ' All good.');
end $$;
