-- =============================================================================
-- M.E.E.T. update 013:
-- 1. Revenue figures: founders see them on every request; sales team members
--    only on the requests assigned to them. Enforced by the database: the
--    figures can no longer be read from the table directly, only through
--    project_money() and project_money_report(), which apply the rule.
--    The history entries that record figures follow the same rule.
-- 2. Client milestones: the steps the client sees ticked are only those the
--    team marks as completed. Nothing is ticked automatically.
-- Nothing is deleted. Safe to run more than once.
-- Paste into Supabase > SQL Editor > New query > Run.
-- Then run supabase/tests/phase6_revenue_milestones_test.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Client milestones (stored on the request)
-- ---------------------------------------------------------------------------
alter table project_requests add column if not exists client_milestones text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 2. Revenue figures: read access by column
--    Every column except the figures stays readable by the team (row level
--    security still decides which rows). Columns added later must be granted
--    here too, or the console cannot read them.
-- ---------------------------------------------------------------------------
revoke select on project_requests from authenticated;
grant select (id, reference, member_id, client_name, client_type, client_organization, client_country, description, artwork_type,
  budget, budget_undecided, timeline, timeline_undecided, location, style_refs, quantity_dims, status, not_confirmed_reason,
  not_confirmed_note, assigned_to, confirmed_at, created_at, updated_at, kind, purpose, disciplines_wanted, files, waiting_on,
  next_action, next_action_due, client_milestones) on project_requests to authenticated;

-- The figures of one request, for founders and the assigned sales team member.
create or replace function project_money(p_id uuid)
returns table (currency text, estimated_value numeric, fee_terms text, final_value numeric, final_revenue numeric,
               payment_status text, revenue_notes text)
language sql stable security definer set search_path = public as $$
  select r.currency, r.estimated_value, r.fee_terms, r.final_value, r.final_revenue, r.payment_status, r.revenue_notes
  from project_requests r
  where r.id = p_id and can_manage_project(p_id)
$$;

-- All figures, for the founders' reports.
create or replace function project_money_report()
returns table (id uuid, status project_status, client_country text, currency text, estimated_value numeric, final_value numeric,
               final_revenue numeric, payment_status text, not_confirmed_reason text)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.client_country, r.currency, r.estimated_value, r.final_value, r.final_revenue, r.payment_status, r.not_confirmed_reason
  from project_requests r
  where is_founder()
$$;

-- History entries that record figures ("money") follow the same rule.
drop policy if exists sales_read on project_events;
create policy sales_read on project_events for select to authenticated
  using (is_sales() and (kind <> 'money' or can_manage_project(project_id)));

-- ---------------------------------------------------------------------------
-- 3. Marking client milestones
-- ---------------------------------------------------------------------------
create or replace function set_client_milestones(p_id uuid, p_steps text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this request.' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct s), '{}') into v from unnest(coalesce(p_steps, '{}')) s;
  if exists (select 1 from unnest(v) s where s not in ('received', 'under_review', 'finding_artists', 'preparing_proposal', 'proposal_ready', 'in_discussion', 'confirmed')) then
    raise exception 'Unknown step.' using errcode = '22023';
  end if;
  update project_requests set client_milestones = v where id = p_id;
  perform project_event(p_id, 'milestones', jsonb_build_object('steps', to_jsonb(v)));
end $$;

-- The client's view now includes the completed steps the team marked.
create or replace function my_request_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r project_requests; v_contact text;
begin
  select * into r from project_requests where id = p_id and member_id = auth.uid();
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  select split_part(name, ' ', 1) into v_contact from team_members where user_id = r.assigned_to and active;
  return jsonb_build_object(
    'client_status', project_client_status(r.status),
    'milestones', to_jsonb(r.client_milestones),
    'contact', coalesce(v_contact, ''),
    'nominated', coalesce((select jsonb_agg(jsonb_build_object('artist_id', a.artist_id, 'name', ar.display_name) order by ar.display_name)
       from project_artists a join artists ar on ar.id = a.artist_id where a.project_id = r.id and a.nominated_by_client), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'version', x.version, 'status', x.status,
       'creative_direction', x.creative_direction, 'artists', x.artists, 'budget', x.budget, 'timeline', x.timeline,
       'message', x.message, 'client_response', x.client_response, 'sent_at', x.sent_at, 'decided_at', x.decided_at) order by x.version desc)
       from project_proposals x where x.project_id = r.id and x.status <> 'draft'), '[]'::jsonb),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('body', u.body, 'at', u.created_at) order by u.created_at desc)
       from project_updates u where u.project_id = r.id), '[]'::jsonb),
    'files', coalesce(to_jsonb(r.files), '[]'::jsonb)
  );
end $$;

revoke execute on function project_money(uuid), project_money_report(), set_client_milestones(uuid, text[]) from public, anon;
grant execute on function project_money(uuid), project_money_report(), set_client_milestones(uuid, text[]) to authenticated;
