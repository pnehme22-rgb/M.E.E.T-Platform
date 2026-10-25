-- =============================================================================
-- M.E.E.T. update 012: commissions, collaborations and projects as one
-- coordinated request system; proposals the client accepts in their account;
-- client updates; waiting state and next action; artist help requests;
-- artist materials and team-curated directory order; homepage drafts that the
-- team edits, previews and publishes; pinned featured items.
--
-- Nothing is deleted. Existing project requests become kind "project" and
-- keep their status, notes, artists, follow-ups and figures.
-- Safe to run more than once. Paste into Supabase > SQL Editor > New query > Run.
-- Then run supabase/tests/phase5_requests_test.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Request kinds and a more detailed internal pipeline
--    Internal: new → in_review → contacted (coordinating artists) →
--    preparing_proposal → proposal_sent → negotiation → confirmed | not_confirmed
-- ---------------------------------------------------------------------------
alter type project_status add value if not exists 'in_review' after 'new';
alter type project_status add value if not exists 'preparing_proposal' after 'contacted';

alter table project_requests add column if not exists kind text not null default 'project';
alter table project_requests drop constraint if exists project_requests_kind_check;
alter table project_requests add constraint project_requests_kind_check check (kind in ('commission', 'collaboration', 'project'));
alter table project_requests add column if not exists purpose text not null default '' check (char_length(purpose) <= 1000);
alter table project_requests add column if not exists disciplines_wanted text not null default '' check (char_length(disciplines_wanted) <= 500);
alter table project_requests add column if not exists files text[] not null default '{}' check (cardinality(files) <= 5);
alter table project_requests add column if not exists waiting_on text not null default 'team';
alter table project_requests drop constraint if exists project_requests_waiting_check;
alter table project_requests add constraint project_requests_waiting_check check (waiting_on in ('team', 'artist', 'client', 'nobody'));
alter table project_requests add column if not exists next_action text not null default '' check (char_length(next_action) <= 300);
alter table project_requests add column if not exists next_action_due date;
create index if not exists project_requests_kind_idx on project_requests (kind, status, created_at desc);

-- What the client sees. Never further along than the internal status.
create or replace function project_client_status(s project_status) returns text
language plpgsql immutable as $$
begin
  return case s::text
    when 'new' then 'received'
    when 'in_review' then 'under_review'
    when 'contacted' then 'finding_artists'
    when 'preparing_proposal' then 'preparing_proposal'
    when 'proposal_sent' then 'proposal_ready'
    when 'negotiation' then 'in_discussion'
    when 'confirmed' then 'confirmed'
    when 'not_confirmed' then 'closed'
    else 'in_discussion' end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Artists on a request: nominated by the client, considered, contacted,
--    their answer (availability, price, timing), alternatives, recommendation.
-- ---------------------------------------------------------------------------
alter table project_artists drop constraint if exists project_artists_state_check;
alter table project_artists add constraint project_artists_state_check
  check (state in ('nominated', 'considered', 'contacted', 'available', 'unavailable', 'declined', 'recommended'));
alter table project_artists add column if not exists nominated_by_client boolean not null default false;
alter table project_artists add column if not exists is_alternative boolean not null default false;
alter table project_artists add column if not exists price_note text not null default '' check (char_length(price_note) <= 300);
alter table project_artists add column if not exists timeline_note text not null default '' check (char_length(timeline_note) <= 300);
alter table project_artists add column if not exists response_note text not null default '' check (char_length(response_note) <= 2000);
alter table project_artists add column if not exists contacted_at timestamptz;
alter table project_artists add column if not exists responded_at timestamptz;

-- The original function now accepts every team state (not "nominated", which only the client sets).
create or replace function set_project_artist(p_id uuid, p_artist uuid, p_state text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform update_project_artist(p_id, p_artist, jsonb_build_object('state', p_state, 'reason', p_reason));
end $$;

create or replace function update_project_artist(p_id uuid, p_artist uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cur project_artists; v_state text := coalesce(p->>'state', ''); v_exists boolean;
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  select * into cur from project_artists where project_id = p_id and artist_id = p_artist;
  v_exists := found;
  if not v_exists then
    if not exists (select 1 from public_artists where id = p_artist) then
      raise exception 'Only artists with a public, approved profile can be added.' using errcode = '22023';
    end if;
    if v_state = '' then v_state := 'considered'; end if;
  elsif v_state = '' then
    v_state := cur.state;
  end if;
  if v_state not in ('considered', 'contacted', 'available', 'unavailable', 'declined', 'recommended')
     and not (v_exists and v_state = 'nominated') then
    raise exception 'Unknown choice.' using errcode = '22023';
  end if;
  insert into project_artists (project_id, artist_id, state, reason, added_by, is_alternative, price_note, timeline_note, response_note,
                               contacted_at, responded_at)
  values (p_id, p_artist, v_state, left(clean_block(coalesce(p->>'reason', '')), 2000), auth.uid(),
          coalesce((p->>'is_alternative')::boolean, false),
          left(clean_line(coalesce(p->>'price_note', '')), 300), left(clean_line(coalesce(p->>'timeline_note', '')), 300),
          left(clean_block(coalesce(p->>'response_note', '')), 2000),
          case when v_state = 'contacted' then now() end,
          case when v_state in ('available', 'unavailable', 'declined') then now() end)
  on conflict (project_id, artist_id) do update set
    state = excluded.state,
    reason = case when p ? 'reason' then excluded.reason else project_artists.reason end,
    is_alternative = case when p ? 'is_alternative' then excluded.is_alternative else project_artists.is_alternative end,
    price_note = case when p ? 'price_note' then excluded.price_note else project_artists.price_note end,
    timeline_note = case when p ? 'timeline_note' then excluded.timeline_note else project_artists.timeline_note end,
    response_note = case when p ? 'response_note' then excluded.response_note else project_artists.response_note end,
    contacted_at = case when excluded.state = 'contacted' then coalesce(project_artists.contacted_at, now()) else project_artists.contacted_at end,
    responded_at = case when excluded.state in ('available', 'unavailable', 'declined') and excluded.state <> project_artists.state then now() else project_artists.responded_at end,
    updated_at = now();
  perform project_event(p_id, 'artist_' || v_state, jsonb_build_object('artist', p_artist,
    'name', (select display_name from artists where id = p_artist)));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Creating a request: commission (any member), collaboration (any member,
--    with the artists the client would like to bring together) and project
--    (Professional and Business & Organization, with optional nominated
--    artists and supporting files).
-- ---------------------------------------------------------------------------
create or replace function create_project_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m member_accounts; r project_requests;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'project');
  v_desc text := clean_block(p->>'description');
  v_type text := clean_line(p->>'artwork_type');
  v_budget text := clean_line(p->>'budget');
  v_timeline text := clean_line(p->>'timeline');
  v_bu boolean := coalesce((p->>'budget_undecided')::boolean, false);
  v_tu boolean := coalesce((p->>'timeline_undecided')::boolean, false);
  v_artists uuid[] := '{}';
  v_files text[] := '{}';
  v_a uuid; v_f text;
begin
  if v_kind not in ('commission', 'collaboration', 'project') then raise exception 'Unknown request type.' using errcode = '22023'; end if;
  select * into m from member_accounts where id = auth.uid();
  if not found then raise exception 'Requests are sent from a M.E.E.T. member account.' using errcode = '42501'; end if;
  if v_kind = 'project' and m.account_type not in ('professional', 'business') then
    raise exception 'Project requests are for Professional and Business & Organization accounts.' using errcode = '42501';
  end if;
  if m.deletion_requested_at is not null then
    raise exception 'This account is being deleted, so it cannot send requests.' using errcode = '42501';
  end if;
  if char_length(v_desc) < 20 then raise exception 'Please describe your idea in at least 20 characters.' using errcode = '22023'; end if;
  if char_length(v_desc) > 4000 then raise exception 'Please keep the description under 4,000 characters.' using errcode = '22023'; end if;
  if v_kind = 'collaboration' and char_length(v_type) < 2 then v_type := 'Artist collaboration'; end if;
  if char_length(v_type) < 2 then
    raise exception '%', case when v_kind = 'project' then 'Please tell us the type of project or space.' else 'Please tell us what type of artwork you have in mind.' end using errcode = '22023';
  end if;
  if v_bu then v_budget := ''; elsif v_budget = '' then raise exception 'Please give an estimated budget, or tick "Not decided yet".' using errcode = '22023'; end if;
  if v_tu then v_timeline := ''; elsif v_timeline = '' then raise exception 'Please give a timeline, or tick "Not decided yet".' using errcode = '22023'; end if;

  if jsonb_typeof(p->'artists') = 'array' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_artists from jsonb_array_elements_text(p->'artists') x;
  end if;
  if cardinality(v_artists) > 6 then raise exception 'Please choose up to six artists.' using errcode = '22023'; end if;
  foreach v_a in array v_artists loop
    if not exists (select 1 from public_artists where id = v_a) then
      raise exception 'One of the artists you chose is not available at the moment.' using errcode = '22023';
    end if;
  end loop;
  if v_kind = 'collaboration' and cardinality(v_artists) < 1 then
    raise exception 'Please choose at least one artist you would like to work with.' using errcode = '22023';
  end if;

  if jsonb_typeof(p->'files') = 'array' then
    if v_kind <> 'project' then raise exception 'Files can be added to project requests only.' using errcode = '22023'; end if;
    select coalesce(array_agg(x), '{}') into v_files from jsonb_array_elements_text(p->'files') x;
  end if;
  if cardinality(v_files) > 5 then raise exception 'Please add up to five files.' using errcode = '22023'; end if;
  foreach v_f in array v_files loop
    if split_part(v_f, '/', 1) <> m.id::text
       or not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = v_f) then
      raise exception 'One of the files could not be found. Please add it again.' using errcode = '22023';
    end if;
  end loop;

  if exists (select 1 from project_requests where member_id = m.id and created_at > now() - interval '2 minutes') then
    raise exception 'Your request has already been sent. Please wait a moment before sending another.' using errcode = '22023';
  end if;
  if (select count(*) from project_requests where member_id = m.id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have sent several requests today. Please write to us if you need more.' using errcode = '22023';
  end if;

  insert into project_requests (member_id, client_name, client_type, client_organization, client_country, kind,
      description, artwork_type, budget, budget_undecided, timeline, timeline_undecided, location, style_refs, quantity_dims,
      purpose, disciplines_wanted, files)
  values (m.id, m.full_name, m.account_type,
      case when m.account_type = 'business' then m.business_name when m.account_type = 'professional' then m.company_name else '' end,
      m.country, v_kind,
      v_desc, left(v_type, 200), left(v_budget, 200), v_bu, left(v_timeline, 200), v_tu,
      left(clean_line(p->>'location'), 200), left(clean_block(p->>'style_refs'), 2000), left(clean_block(p->>'quantity_dims'), 1000),
      left(clean_block(p->>'purpose'), 1000), left(clean_line(p->>'disciplines_wanted'), 500), v_files)
  returning * into r;
  foreach v_a in array v_artists loop
    insert into project_artists (project_id, artist_id, state, nominated_by_client) values (r.id, v_a, 'nominated', true);
  end loop;
  perform project_event(r.id, 'created', jsonb_build_object('kind', v_kind, 'artists', cardinality(v_artists), 'files', cardinality(v_files)));
  return jsonb_build_object('id', r.id, 'reference', r.reference, 'kind', v_kind);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Waiting state and next action
-- ---------------------------------------------------------------------------
create or replace function set_project_next(p_id uuid, p_waiting text, p_action text, p_due date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  if p_waiting not in ('team', 'artist', 'client', 'nobody') then raise exception 'Unknown waiting state.' using errcode = '22023'; end if;
  update project_requests set waiting_on = p_waiting, next_action = left(clean_line(coalesce(p_action, '')), 300), next_action_due = p_due
  where id = p_id;
  perform project_event(p_id, 'next', jsonb_build_object('waiting_on', p_waiting, 'action', left(clean_line(coalesce(p_action, '')), 300), 'due', p_due));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Proposals: prepared by the team (drafts stay internal), sent to the
--    client, and accepted, refined or declined by the client in their account.
-- ---------------------------------------------------------------------------
create table if not exists project_proposals (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references project_requests(id) on delete cascade,
  version            int not null,
  status             text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'changes_requested', 'declined', 'withdrawn')),
  creative_direction text not null default '' check (char_length(creative_direction) <= 4000),
  artists            jsonb not null default '[]',
  budget             text not null default '' check (char_length(budget) <= 500),
  timeline           text not null default '' check (char_length(timeline) <= 500),
  message            text not null default '' check (char_length(message) <= 4000),
  client_response    text not null default '' check (char_length(client_response) <= 2000),
  created_by         uuid references team_members(user_id) on delete set null,
  sent_by            uuid references team_members(user_id) on delete set null,
  sent_at            timestamptz,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, version)
);
drop trigger if exists project_proposals_touch on project_proposals;
create trigger project_proposals_touch before update on project_proposals for each row execute function touch_updated_at();

-- Updates the team shares with the client at milestones (one way, by the team).
create table if not exists project_updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project_requests(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_by  uuid references team_members(user_id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists project_updates_idx on project_updates (project_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['project_proposals', 'project_updates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists sales_read on %I', t);
    execute format('create policy sales_read on %I for select to authenticated using (is_sales())', t);
  end loop;
end $$;

create or replace function save_proposal(p_project uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cur project_proposals; v_id uuid := p_id; v_artists jsonb := '[]'; e jsonb; v_name text;
begin
  if not can_manage_project(p_project) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  if jsonb_typeof(p->'artists') = 'array' then
    if jsonb_array_length(p->'artists') > 8 then raise exception 'A proposal can include up to eight artists.' using errcode = '22023'; end if;
    for e in select * from jsonb_array_elements(p->'artists') loop
      select display_name into v_name from public_artists where id = (e->>'artist_id')::uuid;
      if v_name is null then raise exception 'Only artists with a public, approved profile can be proposed.' using errcode = '22023'; end if;
      v_artists := v_artists || jsonb_build_array(jsonb_build_object('artist_id', e->>'artist_id', 'name', v_name,
        'contribution', left(clean_block(coalesce(e->>'contribution', '')), 1000),
        'materials', left(clean_line(coalesce(e->>'materials', '')), 300),
        'price', left(clean_line(coalesce(e->>'price', '')), 200)));
    end loop;
  end if;
  if v_id is null then
    insert into project_proposals (project_id, version, created_by, creative_direction, artists, budget, timeline, message)
    values (p_project, coalesce((select max(version) + 1 from project_proposals where project_id = p_project), 1), auth.uid(),
      left(clean_block(coalesce(p->>'creative_direction', '')), 4000), v_artists,
      left(clean_line(coalesce(p->>'budget', '')), 500), left(clean_line(coalesce(p->>'timeline', '')), 500),
      left(clean_block(coalesce(p->>'message', '')), 4000))
    returning id into v_id;
    perform project_event(p_project, 'proposal_draft', jsonb_build_object('version', (select version from project_proposals where id = v_id)));
  else
    select * into cur from project_proposals where id = v_id and project_id = p_project for update;
    if not found then raise exception 'Proposal not found.' using errcode = 'P0002'; end if;
    if cur.status <> 'draft' then raise exception 'This proposal has been sent. Prepare a revised proposal instead.' using errcode = '22023'; end if;
    update project_proposals set creative_direction = left(clean_block(coalesce(p->>'creative_direction', '')), 4000), artists = v_artists,
      budget = left(clean_line(coalesce(p->>'budget', '')), 500), timeline = left(clean_line(coalesce(p->>'timeline', '')), 500),
      message = left(clean_block(coalesce(p->>'message', '')), 4000)
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function delete_proposal_draft(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cur project_proposals;
begin
  select * into cur from project_proposals where id = p_id;
  if not found then return; end if;
  if not can_manage_project(cur.project_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if cur.status <> 'draft' then raise exception 'Only drafts can be deleted.' using errcode = '22023'; end if;
  delete from project_proposals where id = p_id;
end $$;

-- Send a draft to the client. An earlier proposal still waiting for an answer is withdrawn.
create or replace function send_proposal(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur project_proposals; r project_requests;
begin
  select * into cur from project_proposals where id = p_id for update;
  if not found then raise exception 'Proposal not found.' using errcode = 'P0002'; end if;
  if not can_manage_project(cur.project_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  if cur.status <> 'draft' then raise exception 'This proposal has already been sent.' using errcode = '22023'; end if;
  if char_length(cur.creative_direction) < 20 then raise exception 'Please describe the creative direction (at least 20 characters).' using errcode = '22023'; end if;
  if jsonb_array_length(cur.artists) < 1 then raise exception 'Please add at least one artist to the proposal.' using errcode = '22023'; end if;
  if cur.budget = '' or cur.timeline = '' then raise exception 'Please add the estimated budget and the timeline.' using errcode = '22023'; end if;
  select * into r from project_requests where id = cur.project_id for update;
  if r.member_id is null then raise exception 'The client''s account has been deleted.' using errcode = '22023'; end if;
  if r.status::text in ('confirmed', 'not_confirmed') then raise exception 'Reopen the request before sending a new proposal.' using errcode = '22023'; end if;
  update project_proposals set status = 'withdrawn' where project_id = cur.project_id and status = 'sent';
  update project_proposals set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = p_id;
  update project_requests set status = 'proposal_sent', waiting_on = 'client' where id = r.id;
  perform project_event(r.id, 'proposal_sent', jsonb_build_object('version', cur.version));
  if r.status::text <> 'proposal_sent' then
    perform project_event(r.id, 'status', jsonb_build_object('from', r.status, 'to', 'proposal_sent'));
  end if;
  return jsonb_build_object('member_id', r.member_id, 'reference', r.reference, 'kind', r.kind, 'version', cur.version, 'project_id', r.id);
end $$;

create or replace function withdraw_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cur project_proposals;
begin
  select * into cur from project_proposals where id = p_id;
  if not found then raise exception 'Proposal not found.' using errcode = 'P0002'; end if;
  if not can_manage_project(cur.project_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if cur.status <> 'sent' then raise exception 'Only a proposal waiting for the client''s answer can be withdrawn.' using errcode = '22023'; end if;
  update project_proposals set status = 'withdrawn' where id = p_id;
  update project_requests set waiting_on = 'team' where id = cur.project_id;
  perform project_event(cur.project_id, 'proposal_withdrawn', jsonb_build_object('version', cur.version));
end $$;

-- The client answers a proposal in their account. Accepting confirms the request.
create or replace function respond_proposal(p_id uuid, p_decision text, p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur project_proposals; r project_requests; v text := clean_block(p_message); v_new text;
begin
  select * into cur from project_proposals where id = p_id for update;
  if not found then raise exception 'Proposal not found.' using errcode = 'P0002'; end if;
  select * into r from project_requests where id = cur.project_id for update;
  if r.member_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if cur.status <> 'sent' then raise exception 'This proposal has already been answered or replaced.' using errcode = '22023'; end if;
  if p_decision not in ('accept', 'changes', 'decline') then raise exception 'Unknown decision.' using errcode = '22023'; end if;
  if p_decision = 'changes' and char_length(v) < 10 then
    raise exception 'Please tell us what you would like to change (at least 10 characters).' using errcode = '22023';
  end if;
  if char_length(v) > 2000 then raise exception 'Please keep your message under 2,000 characters.' using errcode = '22023'; end if;
  v_new := case p_decision when 'accept' then 'accepted' when 'changes' then 'changes_requested' else 'declined' end;
  update project_proposals set status = v_new, client_response = v, decided_at = now() where id = p_id;
  if p_decision = 'accept' then
    update project_requests set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), waiting_on = 'team' where id = r.id;
  else
    update project_requests set status = 'negotiation', waiting_on = 'team' where id = r.id;
  end if;
  perform project_event(r.id, 'client_' || v_new, jsonb_build_object('version', cur.version, 'message', left(v, 1000)));
  perform project_event(r.id, 'status', jsonb_build_object('from', r.status, 'to', case when p_decision = 'accept' then 'confirmed' else 'negotiation' end));
  return jsonb_build_object('reference', r.reference, 'kind', r.kind, 'project_id', r.id, 'decision', v_new, 'version', cur.version,
    'assigned_to', r.assigned_to);
end $$;

create or replace function post_project_update(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r project_requests; v text := clean_block(p_body);
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  if char_length(v) < 5 then raise exception 'Please write the update.' using errcode = '22023'; end if;
  if char_length(v) > 2000 then raise exception 'Please keep the update under 2,000 characters.' using errcode = '22023'; end if;
  select * into r from project_requests where id = p_id;
  if r.member_id is null then raise exception 'The client''s account has been deleted.' using errcode = '22023'; end if;
  insert into project_updates (project_id, body, created_by) values (p_id, v, auth.uid());
  perform project_event(p_id, 'client_update', jsonb_build_object('text', left(v, 300)));
  return jsonb_build_object('member_id', r.member_id, 'reference', r.reference, 'kind', r.kind);
end $$;

-- ---------------------------------------------------------------------------
-- 6. What a member sees of their own requests. Internal notes, internal
--    statuses, drafts, figures and other artists' answers are never included.
-- ---------------------------------------------------------------------------
drop function if exists my_project_requests();
create function my_project_requests()
returns table (id uuid, reference text, kind text, created_at timestamptz, updated_at timestamptz, artwork_type text, description text,
               budget text, budget_undecided boolean, timeline text, timeline_undecided boolean, location text,
               style_refs text, quantity_dims text, purpose text, disciplines_wanted text, file_count int,
               client_status text, needs_answer boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.reference, r.kind, r.created_at, r.updated_at, r.artwork_type, r.description, r.budget, r.budget_undecided,
         r.timeline, r.timeline_undecided, r.location, r.style_refs, r.quantity_dims, r.purpose, r.disciplines_wanted,
         cardinality(r.files), project_client_status(r.status),
         exists (select 1 from project_proposals x where x.project_id = r.id and x.status = 'sent')
  from project_requests r
  where r.member_id = auth.uid()
  order by r.created_at desc
$$;

create or replace function my_request_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r project_requests; v_contact text;
begin
  select * into r from project_requests where id = p_id and member_id = auth.uid();
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  select split_part(name, ' ', 1) into v_contact from team_members where user_id = r.assigned_to and active;
  return jsonb_build_object(
    'client_status', project_client_status(r.status),
    'contact', coalesce(v_contact, ''),
    'nominated', coalesce((select jsonb_agg(jsonb_build_object('artist_id', a.artist_id, 'name', ar.display_name) order by ar.display_name)
       from project_artists a join artists ar on ar.id = a.artist_id where a.project_id = r.id and a.nominated_by_client), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'version', x.version, 'status', x.status,
       'creative_direction', x.creative_direction, 'artists', x.artists, 'budget', x.budget, 'timeline', x.timeline,
       'message', x.message, 'client_response', x.client_response, 'sent_at', x.sent_at, 'decided_at', x.decided_at) order by x.version desc)
       from project_proposals x where x.project_id = r.id and x.status <> 'draft'), '[]'::jsonb),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('body', u.body, 'at', u.created_at) order by u.created_at desc)
       from project_updates u where u.project_id = r.id), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'status', project_client_status((e.detail->>'to')::project_status)) order by e.at)
       from project_events e where e.project_id = r.id and e.kind in ('status', 'reopened') and e.detail ? 'to'), '[]'::jsonb),
    'files', coalesce(to_jsonb(r.files), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 7. Artists: materials on the profile, team-curated directory order,
--    and requests for help from the M.E.E.T. team.
-- ---------------------------------------------------------------------------
alter table artists add column if not exists materials text not null default '' check (char_length(materials) <= 300);
alter table artists add column if not exists directory_rank int;
grant update (materials) on artists to authenticated;

create or replace function artist_profile_edit_resets_review() returns trigger
language plpgsql as $$
begin
  if auth.uid() = new.id and not is_team() and new.profile_status in ('submitted','approved')
     and (to_jsonb(new) - array['profile_status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at','published','traditions','directory_rank'])
         is distinct from
         (to_jsonb(old) - array['profile_status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at','published','traditions','directory_rank']) then
    new.profile_status := 'draft';
  end if;
  return new;
end $$;
drop trigger if exists artists_edit_reset on artists;
create trigger artists_edit_reset before update of display_name, legal_name, country, city, craft, other_disciplines,
  techniques, materials, bio, instagram, website, other_link, avatar_path, cover_path on artists
  for each row execute function artist_profile_edit_resets_review();

create or replace function set_directory_order(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  update artists set directory_rank = null where directory_rank is not null and not (id = any(coalesce(p_ids, '{}')));
  update artists a set directory_rank = o.n from unnest(coalesce(p_ids, '{}')) with ordinality o(id, n) where a.id = o.id;
  perform write_audit('directory.order', 'artist', '', jsonb_build_object('count', cardinality(coalesce(p_ids, '{}'))));
end $$;

create table if not exists artist_requests (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references artists(id) on delete cascade,
  topic       text not null check (topic in ('profile', 'artworks', 'inquiry', 'collaboration', 'other')),
  message     text not null check (char_length(message) between 10 and 2000),
  status      text not null default 'open' check (status in ('open', 'closed')),
  team_note   text not null default '' check (char_length(team_note) <= 2000),
  handled_by  uuid references team_members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists artist_requests_idx on artist_requests (status, created_at desc);
alter table artist_requests enable row level security;
revoke all on artist_requests from anon, authenticated;
grant select on artist_requests to authenticated;
drop policy if exists artist_requests_read on artist_requests;
create policy artist_requests_read on artist_requests for select to authenticated using (artist_id = auth.uid() or is_team());

create or replace function create_artist_request(p_topic text, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v text := clean_block(p_message); v_id uuid;
begin
  if not exists (select 1 from artists where id = auth.uid()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_topic is null or p_topic not in ('profile', 'artworks', 'inquiry', 'collaboration', 'other') then
    raise exception 'Please choose what you need help with.' using errcode = '22023';
  end if;
  if char_length(v) < 10 then raise exception 'Please write at least 10 characters.' using errcode = '22023'; end if;
  if char_length(v) > 2000 then raise exception 'Please keep your message under 2,000 characters.' using errcode = '22023'; end if;
  if (select count(*) from artist_requests where artist_id = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have sent several messages today. We will reply as soon as we can.' using errcode = '22023';
  end if;
  insert into artist_requests (artist_id, topic, message) values (auth.uid(), p_topic, v) returning id into v_id;
  perform write_audit('artist_request.created', 'artist_request', v_id::text, jsonb_build_object('topic', p_topic));
  return v_id;
end $$;

create or replace function set_artist_request(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('open', 'closed') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update artist_requests set status = p_status,
    team_note = case when coalesce(btrim(p_note), '') = '' then team_note else left(clean_block(p_note), 2000) end, handled_by = auth.uid(),
    closed_at = case when p_status = 'closed' then now() end
  where id = p_id;
  perform write_audit('artist_request.' || p_status, 'artist_request', p_id::text, '{}');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Featured items: pinned items always show; the rest rotate.
-- ---------------------------------------------------------------------------
alter table featured_items add column if not exists pinned boolean not null default false;

create or replace function pin_featured(p_kind text, p_id uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  update featured_items set pinned = coalesce(p_pinned, false) where kind = p_kind and item_id = p_id;
  perform write_audit(case when p_pinned then 'featured.pin' else 'featured.unpin' end, p_kind, p_id::text, '{}');
end $$;

create or replace function set_featured_order(p_kind text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  update featured_items f set position = o.n from unnest(coalesce(p_ids, '{}')) with ordinality o(id, n)
  where f.kind = p_kind and f.item_id = o.id;
end $$;

-- Public views rebuilt with materials, directory order and pinned flags.
drop view if exists public_featured_artworks;
drop view if exists public_featured_artists;
drop view if exists public_artworks;
drop view if exists public_artists;

create view public_artists
with (security_invoker = false) as
select
  a.id, a.display_name, a.country, a.city, a.craft as main_discipline, a.other_disciplines,
  a.techniques, a.bio, a.avatar_path, a.cover_path, a.reviewed_at as approved_at, a.materials, a.directory_rank
from artists a
join applications ap on ap.id = a.application_id
where ap.status = 'approved'
  and a.profile_status = 'approved'
  and a.terms_accepted_at is not null
  and a.terms_version = (select value from app_config where key = 'terms_version_current');

create view public_artworks
with (security_invoker = false) as
select
  w.id, w.artist_id, w.title, w.year, w.materials, w.height, w.width, w.depth, w.unit,
  w.edition_type, w.edition_size,
  case when w.price_public and not w.price_on_request then w.price end as price,
  w.price_on_request,
  case when w.price_public and not w.price_on_request and w.price is not null then w.currency end as currency,
  w.description, w.images, w.reviewed_at as approved_at
from artworks w
join public_artists p on p.id = w.artist_id
where w.status = 'approved';

create view public_featured_artists
with (security_invoker = false) as
select f.position, f.pinned, p.*
from featured_items f join public_artists p on p.id = f.item_id
where f.kind = 'artist';

create view public_featured_artworks
with (security_invoker = false) as
select f.position, f.pinned, w.*, p.display_name as artist_name
from featured_items f
join public_artworks w on w.id = f.item_id
join public_artists p on p.id = w.artist_id
where f.kind = 'artwork';

revoke all on public_artists, public_artworks, public_featured_artists, public_featured_artworks from public, anon, authenticated;
grant select on public_artists, public_artworks, public_featured_artists, public_featured_artworks to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Homepage content: a draft the team edits and previews, and the published
--    version the public website reads. Publishing keeps a copy of each version.
-- ---------------------------------------------------------------------------
create table if not exists site_pages (
  key               text primary key check (key in ('home')),
  draft             jsonb not null default '{}',
  published         jsonb,
  version           int not null default 0,
  draft_updated_at  timestamptz,
  draft_updated_by  uuid references team_members(user_id) on delete set null,
  published_at      timestamptz,
  published_by      uuid references team_members(user_id) on delete set null
);
create table if not exists site_page_versions (
  id            bigint generated always as identity primary key,
  key           text not null,
  version       int not null,
  content       jsonb not null,
  published_at  timestamptz not null default now(),
  published_by  uuid references team_members(user_id) on delete set null
);
insert into site_pages (key) values ('home') on conflict (key) do nothing;

alter table site_pages enable row level security;
alter table site_page_versions enable row level security;
revoke all on site_pages, site_page_versions from anon, authenticated;
grant select on site_pages, site_page_versions to authenticated;
drop policy if exists site_pages_team_read on site_pages;
create policy site_pages_team_read on site_pages for select to authenticated using (is_team());
drop policy if exists site_versions_team_read on site_page_versions;
create policy site_versions_team_read on site_page_versions for select to authenticated using (is_team());

create or replace view public_site_pages
with (security_invoker = false) as
select key, published as content, published_at, version from site_pages where published is not null;
revoke all on public_site_pages from public, anon, authenticated;
grant select on public_site_pages to anon, authenticated;

create or replace function save_site_draft(p_key text, p_content jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_content) <> 'object' or jsonb_typeof(p_content->'sections') <> 'array' then
    raise exception 'The page content is not valid.' using errcode = '22023';
  end if;
  if octet_length(p_content::text) > 200000 then raise exception 'The page content is too large.' using errcode = '22023'; end if;
  update site_pages set draft = p_content, draft_updated_at = now(), draft_updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'Unknown page.' using errcode = '22023'; end if;
end $$;

create or replace function publish_site_page(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare s site_pages;
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from site_pages where key = p_key for update;
  if not found then raise exception 'Unknown page.' using errcode = '22023'; end if;
  if jsonb_typeof(s.draft->'sections') <> 'array' then raise exception 'Save a draft before publishing.' using errcode = '22023'; end if;
  update site_pages set published = s.draft, version = s.version + 1, published_at = now(), published_by = auth.uid() where key = p_key;
  insert into site_page_versions (key, version, content, published_by) values (p_key, s.version + 1, s.draft, auth.uid());
  perform write_audit('site.publish', 'page', p_key, jsonb_build_object('version', s.version + 1));
  return s.version + 1;
end $$;

create or replace function discard_site_draft(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  update site_pages set draft = coalesce(published, '{}'::jsonb), draft_updated_at = now(), draft_updated_by = auth.uid() where key = p_key;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Files: homepage images (public, uploaded by team editors) and project
--     brief attachments (private: the member who uploaded them and the sales team).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-files', 'request-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists site_media_insert on storage.objects;
create policy site_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and public.is_team_editor());
drop policy if exists site_media_update on storage.objects;
create policy site_media_update on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and public.is_team_editor());
drop policy if exists site_media_delete on storage.objects;
create policy site_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and public.is_team_editor());

drop policy if exists request_files_insert on storage.objects;
create policy request_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'request-files' and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.member_accounts where id = auth.uid()));
drop policy if exists request_files_read on storage.objects;
create policy request_files_read on storage.objects for select to authenticated
  using (bucket_id = 'request-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_sales()));
drop policy if exists request_files_delete on storage.objects;
create policy request_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'request-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 11. Who may call the new functions (visitors may call none of them)
-- ---------------------------------------------------------------------------
revoke execute on function project_client_status(project_status), set_project_artist(uuid, uuid, text, text),
  update_project_artist(uuid, uuid, jsonb), create_project_request(jsonb), set_project_next(uuid, text, text, date),
  save_proposal(uuid, uuid, jsonb), delete_proposal_draft(uuid), send_proposal(uuid), withdraw_proposal(uuid),
  respond_proposal(uuid, text, text), post_project_update(uuid, text), my_project_requests(), my_request_detail(uuid),
  set_directory_order(uuid[]), create_artist_request(text, text), set_artist_request(uuid, text, text),
  pin_featured(text, uuid, boolean), set_featured_order(text, uuid[]), save_site_draft(text, jsonb),
  publish_site_page(text), discard_site_draft(text) from public, anon;
grant execute on function project_client_status(project_status), set_project_artist(uuid, uuid, text, text),
  update_project_artist(uuid, uuid, jsonb), create_project_request(jsonb), set_project_next(uuid, text, text, date),
  save_proposal(uuid, uuid, jsonb), delete_proposal_draft(uuid), send_proposal(uuid), withdraw_proposal(uuid),
  respond_proposal(uuid, text, text), post_project_update(uuid, text), my_project_requests(), my_request_detail(uuid),
  set_directory_order(uuid[]), create_artist_request(text, text), set_artist_request(uuid, text, text),
  pin_featured(text, uuid, boolean), set_featured_order(text, uuid[]), save_site_draft(text, jsonb),
  publish_site_page(text), discard_site_draft(text) to authenticated;
