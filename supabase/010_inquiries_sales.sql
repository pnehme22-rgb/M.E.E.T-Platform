-- =============================================================================
-- M.E.E.T. update 010 (Phase 3): artist inquiries, project requests, the
-- Sales dashboard, follow-ups, revenue records and public price choices.
-- Requires updates 008 and 009. Safe to run more than once.
-- Paste into Supabase > SQL Editor > New query > Run.
-- Nothing is deleted. Existing artworks keep their prices private until the
-- artist chooses to show them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A sales role. Sales team members work in the Sales dashboard; elsewhere
--    in the console they can look but not change anything.
-- ---------------------------------------------------------------------------
alter type team_role add value if not exists 'sales';

create or replace function is_team_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select is_team() and coalesce(my_role()::text not in ('viewer', 'sales'), false)
$$;

-- Founders (administrators) and sales team members.
create or replace function is_sales() returns boolean
language sql stable security definer set search_path = public as $$
  select is_team() and coalesce(my_role()::text in ('founder', 'sales'), false)
$$;
grant execute on function is_sales() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Artwork prices: shown publicly only when the artist chooses to.
--    Existing artworks start with "not shown" (price_public = false).
-- ---------------------------------------------------------------------------
alter table artworks add column if not exists price_public boolean not null default false;
comment on column artworks.price_public is
  'The artist chose to show this price publicly. Price on request always wins.';
grant insert (price_public), update (price_public) on artworks to authenticated;

create or replace function artwork_price_choice() returns trigger
language plpgsql as $$
begin
  if new.price_on_request then new.price_public := false; end if;
  return new;
end $$;
drop trigger if exists artworks_price_choice on artworks;
create trigger artworks_price_choice before insert or update on artworks
  for each row execute function artwork_price_choice();

-- Changing the price choice, like any change, sends an approved artwork back to review.
drop trigger if exists artworks_edit_reset on artworks;
create trigger artworks_edit_reset before update of title, year, materials, height, width, depth, unit, edition_type,
  edition_size, price, price_on_request, price_public, currency, description, images on artworks
  for each row execute function artist_artwork_edit_resets_review();

create or replace function submit_artwork(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w artworks;
begin
  select * into w from artworks where id = p_id and artist_id = auth.uid();
  if not found then raise exception 'artwork not found' using errcode = 'P0002'; end if;
  if w.title = '' or cardinality(w.images) < 1 then
    raise exception 'Please add a title and at least one photograph.' using errcode = '22023';
  end if;
  if not w.price_on_request and not w.price_public then
    raise exception 'Please choose how the price appears: show the price, or price on request.' using errcode = '22023';
  end if;
  if w.price_public and w.price is null then
    raise exception 'Please add the price you want to show.' using errcode = '22023';
  end if;
  update artworks set status = 'submitted', submitted_at = now() where id = p_id;
  perform write_audit('artwork.submit', 'artwork', p_id::text, jsonb_build_object('title', w.title));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cultural traditions stay private (the Artist terms do not cover them as
--    a public field yet). They are kept for the team, removed from the public
--    view, and editing them no longer hides a public profile.
-- ---------------------------------------------------------------------------
create or replace function artist_profile_edit_resets_review() returns trigger
language plpgsql as $$
begin
  if auth.uid() = new.id and not is_team() and new.profile_status in ('submitted','approved')
     and (to_jsonb(new) - array['profile_status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at','published','traditions'])
         is distinct from
         (to_jsonb(old) - array['profile_status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at','published','traditions']) then
    new.profile_status := 'draft';
  end if;
  return new;
end $$;
drop trigger if exists artists_edit_reset on artists;
create trigger artists_edit_reset before update of display_name, legal_name, country, city, craft, other_disciplines,
  techniques, bio, instagram, website, other_link, avatar_path, cover_path on artists
  for each row execute function artist_profile_edit_resets_review();

-- Public views, rebuilt: no traditions, and a price only when the artist chose to show it.
drop view if exists public_featured_artworks;
drop view if exists public_featured_artists;
drop view if exists public_artworks;
drop view if exists public_artists;

create view public_artists
with (security_invoker = false) as
select
  a.id, a.display_name, a.country, a.city, a.craft as main_discipline, a.other_disciplines,
  a.techniques, a.bio, a.avatar_path, a.cover_path, a.reviewed_at as approved_at
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
select f.position, p.*
from featured_items f join public_artists p on p.id = f.item_id
where f.kind = 'artist';

create view public_featured_artworks
with (security_invoker = false) as
select f.position, w.*, p.display_name as artist_name
from featured_items f
join public_artworks w on w.id = f.item_id
join public_artists p on p.id = w.artist_id
where f.kind = 'artwork';

revoke all on public_artists, public_artworks, public_featured_artists, public_featured_artworks from public, anon, authenticated;
grant select on public_artists, public_artworks, public_featured_artists, public_featured_artworks to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Artist inquiries: a member writes to an artist through M.E.E.T.
--    The artist sees the member's name, account type and country, never
--    their email or phone. The member never sees the artist's contact details.
-- ---------------------------------------------------------------------------
do $$ begin
  create type inquiry_status as enum ('new', 'viewed', 'responded', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists artist_inquiries (
  id              uuid primary key default gen_random_uuid(),
  artist_id       uuid not null references artists(id) on delete cascade,
  member_id       uuid not null references member_accounts(id) on delete cascade,
  member_name     text not null,
  member_type     account_type not null,
  member_country  text not null default '',
  topic           text not null check (topic in ('artwork', 'commission', 'collaboration', 'other')),
  artwork_id      uuid references artworks(id) on delete set null,
  artwork_title   text not null default '',
  message         text not null check (char_length(message) between 20 and 2000),
  status          inquiry_status not null default 'new',
  response        text not null default '' check (char_length(response) <= 2000),
  viewed_at       timestamptz,
  responded_at    timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists artist_inquiries_artist_idx on artist_inquiries (artist_id, created_at desc);
create index if not exists artist_inquiries_member_idx on artist_inquiries (member_id, created_at desc);
drop trigger if exists artist_inquiries_touch on artist_inquiries;
create trigger artist_inquiries_touch before update on artist_inquiries for each row execute function touch_updated_at();

alter table artist_inquiries enable row level security;
revoke all on artist_inquiries from anon, authenticated;
grant select on artist_inquiries to authenticated;
drop policy if exists inquiry_read on artist_inquiries;
create policy inquiry_read on artist_inquiries for select to authenticated
  using (member_id = auth.uid() or artist_id = auth.uid() or is_team());

create or replace function create_inquiry(p_artist uuid, p_topic text, p_artwork uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m member_accounts; v_id uuid; v_title text := ''; v_msg text := clean_block(p_message);
begin
  select * into m from member_accounts where id = auth.uid();
  if not found then raise exception 'Inquiries are sent from a M.E.E.T. member account.' using errcode = '42501'; end if;
  if m.deletion_requested_at is not null then
    raise exception 'This account is being deleted, so it cannot send inquiries.' using errcode = '42501';
  end if;
  if not exists (select 1 from public_artists where id = p_artist) then
    raise exception 'This artist is not available for inquiries at the moment.' using errcode = '22023';
  end if;
  if p_topic is null or p_topic not in ('artwork', 'commission', 'collaboration', 'other') then
    raise exception 'Please choose what your inquiry is about.' using errcode = '22023';
  end if;
  if p_artwork is not null then
    select title into v_title from public_artworks where id = p_artwork and artist_id = p_artist;
    if not found then raise exception 'This artwork is not available at the moment.' using errcode = '22023'; end if;
  end if;
  if char_length(v_msg) < 20 then raise exception 'Please write a message of at least 20 characters.' using errcode = '22023'; end if;
  if char_length(v_msg) > 2000 then raise exception 'Please keep your message under 2,000 characters.' using errcode = '22023'; end if;
  if exists (select 1 from artist_inquiries where member_id = m.id and artist_id = p_artist and created_at > now() - interval '10 minutes') then
    raise exception 'You have just sent an inquiry to this artist. Please wait for their reply.' using errcode = '22023';
  end if;
  if (select count(*) from artist_inquiries where member_id = m.id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have sent many inquiries today. Please try again tomorrow.' using errcode = '22023';
  end if;
  insert into artist_inquiries (artist_id, member_id, member_name, member_type, member_country, topic, artwork_id, artwork_title, message)
  values (p_artist, m.id, m.full_name, m.account_type, m.country, p_topic, p_artwork, coalesce(v_title, ''), v_msg)
  returning id into v_id;
  perform write_audit('inquiry.created', 'inquiry', v_id::text, jsonb_build_object('artist', p_artist, 'topic', p_topic));
  return v_id;
end $$;

-- The artist opens, closes or reopens an inquiry. "Responded" is set only by replying.
create or replace function set_inquiry_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare i artist_inquiries;
begin
  select * into i from artist_inquiries where id = p_id and artist_id = auth.uid();
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status = 'viewed' and i.status = 'new' then
    update artist_inquiries set status = 'viewed', viewed_at = now() where id = p_id;
  elsif p_status = 'closed' and i.status <> 'closed' then
    update artist_inquiries set status = 'closed', closed_at = now(), viewed_at = coalesce(viewed_at, now()) where id = p_id;
  elsif p_status = 'open' and i.status = 'closed' then
    update artist_inquiries set status = case when responded_at is not null then 'responded'::inquiry_status else 'viewed'::inquiry_status end,
      closed_at = null where id = p_id;
  else
    return;
  end if;
  perform write_audit('inquiry.' || p_status, 'inquiry', p_id::text, '{}');
end $$;

-- The artist answers once, through M.E.E.T. The member receives it by email and in their account.
create or replace function respond_inquiry(p_id uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare i artist_inquiries; v text := clean_block(p_response);
begin
  select * into i from artist_inquiries where id = p_id and artist_id = auth.uid();
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if i.responded_at is not null then raise exception 'You have already replied to this inquiry.' using errcode = '22023'; end if;
  if char_length(v) < 10 then raise exception 'Please write a reply of at least 10 characters.' using errcode = '22023'; end if;
  if char_length(v) > 2000 then raise exception 'Please keep your reply under 2,000 characters.' using errcode = '22023'; end if;
  update artist_inquiries set response = v, status = 'responded', responded_at = now(),
    viewed_at = coalesce(viewed_at, now()), closed_at = null where id = p_id;
  perform write_audit('inquiry.responded', 'inquiry', p_id::text, '{}');
end $$;

grant execute on function create_inquiry(uuid, text, uuid, text), set_inquiry_status(uuid, text),
  respond_inquiry(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Project requests (Professional and Business & Organization members)
--    and the sales pipeline. Members see their own requests through
--    my_project_requests() only; the tables are for the sales team.
-- ---------------------------------------------------------------------------
do $$ begin
  create type project_status as enum ('new', 'contacted', 'proposal_sent', 'negotiation', 'confirmed', 'not_confirmed');
exception when duplicate_object then null; end $$;

create sequence if not exists project_ref_seq;

create table if not exists project_requests (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique default ('PRJ-' || lpad(nextval('project_ref_seq')::text, 4, '0')),
  member_id            uuid references member_accounts(id) on delete set null,
  client_name          text not null,
  client_type          account_type not null,
  client_organization  text not null default '',
  client_country       text not null default '',
  description          text not null check (char_length(description) between 20 and 4000),
  artwork_type         text not null check (char_length(artwork_type) between 2 and 200),
  budget               text not null default '' check (char_length(budget) <= 200),
  budget_undecided     boolean not null default false,
  timeline             text not null default '' check (char_length(timeline) <= 200),
  timeline_undecided   boolean not null default false,
  location             text not null default '' check (char_length(location) <= 200),
  style_refs           text not null default '' check (char_length(style_refs) <= 2000),
  quantity_dims        text not null default '' check (char_length(quantity_dims) <= 1000),
  status               project_status not null default 'new',
  not_confirmed_reason text check (not_confirmed_reason is null or not_confirmed_reason in
                         ('budget', 'timeline', 'changed_mind', 'no_response', 'match', 'requirements', 'other')),
  not_confirmed_note   text not null default '' check (char_length(not_confirmed_note) <= 1000),
  assigned_to          uuid references team_members(user_id) on delete set null,
  currency             text not null default '' check (currency = '' or currency ~ '^[A-Z]{3}$'),
  estimated_value      numeric check (estimated_value is null or estimated_value >= 0),
  fee_terms            text not null default '' check (char_length(fee_terms) <= 300),
  final_value          numeric check (final_value is null or final_value >= 0),
  final_revenue        numeric check (final_revenue is null or final_revenue >= 0),
  payment_status       text not null default 'not_recorded' check (payment_status in
                         ('not_recorded', 'not_due', 'awaiting', 'partly_paid', 'paid', 'not_applicable')),
  revenue_notes        text not null default '' check (char_length(revenue_notes) <= 2000),
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint project_budget_given check (budget <> '' or budget_undecided),
  constraint project_timeline_given check (timeline <> '' or timeline_undecided)
);
create index if not exists project_requests_status_idx on project_requests (status, created_at desc);
create index if not exists project_requests_member_idx on project_requests (member_id, created_at desc);
drop trigger if exists project_requests_touch on project_requests;
create trigger project_requests_touch before update on project_requests for each row execute function touch_updated_at();

create table if not exists project_notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project_requests(id) on delete cascade,
  author      uuid references team_members(user_id) on delete set null,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create table if not exists project_artists (
  project_id  uuid not null references project_requests(id) on delete cascade,
  artist_id   uuid not null references artists(id) on delete cascade,
  state       text not null check (state in ('considered', 'recommended')),
  reason      text not null default '' check (char_length(reason) <= 2000),
  added_by    uuid references team_members(user_id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (project_id, artist_id)
);

create table if not exists project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references project_requests(id) on delete cascade,
  title        text not null check (char_length(title) between 2 and 200),
  assigned_to  uuid references team_members(user_id) on delete set null,
  due_on       date not null,
  done         boolean not null default false,
  done_at      timestamptz,
  notes        text not null default '' check (char_length(notes) <= 2000),
  created_by   uuid references team_members(user_id) on delete set null,
  reminded_on  date,
  created_at   timestamptz not null default now()
);
create index if not exists project_tasks_due_idx on project_tasks (done, due_on);

create table if not exists project_events (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references project_requests(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text not null default '',
  kind        text not null,
  detail      jsonb not null default '{}'
);
create index if not exists project_events_idx on project_events (project_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['project_requests', 'project_notes', 'project_artists', 'project_tasks', 'project_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists sales_read on %I', t);
    execute format('create policy sales_read on %I for select to authenticated using (is_sales())', t);
  end loop;
end $$;

create or replace function project_event(p_project uuid, p_kind text, p_detail jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into project_events (project_id, actor, actor_name, kind, detail)
  values (p_project, auth.uid(), coalesce((select name from team_members where user_id = auth.uid()), ''), p_kind, coalesce(p_detail, '{}'));
end $$;
revoke execute on function project_event(uuid, text, jsonb) from public, anon, authenticated;

-- What the client sees: a simple status, never the internal pipeline.
create or replace function project_client_status(s project_status) returns text
language sql immutable as $$
  select case s when 'new' then 'received' when 'confirmed' then 'confirmed' when 'not_confirmed' then 'closed' else 'in_discussion' end
$$;

create or replace function create_project_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m member_accounts; r project_requests;
  v_desc text := clean_block(p->>'description');
  v_type text := clean_line(p->>'artwork_type');
  v_budget text := clean_line(p->>'budget');
  v_timeline text := clean_line(p->>'timeline');
  v_bu boolean := coalesce((p->>'budget_undecided')::boolean, false);
  v_tu boolean := coalesce((p->>'timeline_undecided')::boolean, false);
begin
  select * into m from member_accounts where id = auth.uid();
  if not found or m.account_type not in ('professional', 'business') then
    raise exception 'Project requests are for Professional and Business & Organization accounts.' using errcode = '42501';
  end if;
  if m.deletion_requested_at is not null then
    raise exception 'This account is being deleted, so it cannot send requests.' using errcode = '42501';
  end if;
  if char_length(v_desc) < 20 then raise exception 'Please describe the project in at least 20 characters.' using errcode = '22023'; end if;
  if char_length(v_desc) > 4000 then raise exception 'Please keep the description under 4,000 characters.' using errcode = '22023'; end if;
  if char_length(v_type) < 2 then raise exception 'Please tell us what type of artwork you are looking for.' using errcode = '22023'; end if;
  if v_bu then v_budget := ''; elsif v_budget = '' then raise exception 'Please give an estimated budget, or tick "Not decided yet".' using errcode = '22023'; end if;
  if v_tu then v_timeline := ''; elsif v_timeline = '' then raise exception 'Please give a timeline, or tick "Not decided yet".' using errcode = '22023'; end if;
  if exists (select 1 from project_requests where member_id = m.id and created_at > now() - interval '2 minutes') then
    raise exception 'Your request has already been sent. Please wait a moment before sending another.' using errcode = '22023';
  end if;
  if (select count(*) from project_requests where member_id = m.id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have sent several requests today. Please write to us if you need more.' using errcode = '22023';
  end if;
  insert into project_requests (member_id, client_name, client_type, client_organization, client_country,
      description, artwork_type, budget, budget_undecided, timeline, timeline_undecided, location, style_refs, quantity_dims)
  values (m.id, m.full_name, m.account_type,
      case when m.account_type = 'business' then m.business_name else m.company_name end, m.country,
      v_desc, left(v_type, 200), left(v_budget, 200), v_bu, left(v_timeline, 200), v_tu,
      left(clean_line(p->>'location'), 200), left(clean_block(p->>'style_refs'), 2000), left(clean_block(p->>'quantity_dims'), 1000))
  returning * into r;
  perform project_event(r.id, 'created', '{}');
  return jsonb_build_object('id', r.id, 'reference', r.reference);
end $$;

create or replace function my_project_requests()
returns table (id uuid, reference text, created_at timestamptz, updated_at timestamptz, artwork_type text, description text,
               budget text, budget_undecided boolean, timeline text, timeline_undecided boolean, location text,
               style_refs text, quantity_dims text, client_status text)
language sql stable security definer set search_path = public as $$
  select r.id, r.reference, r.created_at, r.updated_at, r.artwork_type, r.description, r.budget, r.budget_undecided,
         r.timeline, r.timeline_undecided, r.location, r.style_refs, r.quantity_dims, project_client_status(r.status)
  from project_requests r
  where r.member_id = auth.uid()
  order by r.created_at desc
$$;

-- Founders manage every project. Sales team members manage the projects
-- assigned to them, and may take an unassigned project.
create or replace function can_manage_project(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_founder() or (is_sales() and exists (select 1 from project_requests where id = p_id and assigned_to = auth.uid()))
$$;

create or replace function set_project_status(p_id uuid, p_status text, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r project_requests; v_new project_status; v_note text := clean_block(p_note);
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  select * into r from project_requests where id = p_id for update;
  begin v_new := p_status::project_status;
  exception when others then raise exception 'Unknown status.' using errcode = '22023'; end;
  if v_new = 'not_confirmed' then
    if p_reason is null or p_reason not in ('budget', 'timeline', 'changed_mind', 'no_response', 'match', 'requirements', 'other') then
      raise exception 'Please choose why the project was not confirmed.' using errcode = '22023';
    end if;
    if p_reason = 'other' and char_length(v_note) < 3 then
      raise exception 'Please explain the reason.' using errcode = '22023';
    end if;
  end if;
  if v_new = r.status and v_new <> 'not_confirmed' then
    return jsonb_build_object('changed', false);
  end if;
  update project_requests set
    status = v_new,
    not_confirmed_reason = case when v_new = 'not_confirmed' then p_reason end,
    not_confirmed_note = case when v_new = 'not_confirmed' then left(v_note, 1000) else '' end,
    confirmed_at = case when v_new = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end
  where id = p_id;
  perform project_event(p_id, case when r.status = 'not_confirmed' and v_new <> 'not_confirmed' then 'reopened' else 'status' end,
    jsonb_build_object('from', r.status, 'to', v_new, 'reason', p_reason, 'note', left(v_note, 1000)));
  return jsonb_build_object('changed', true, 'from', r.status, 'to', v_new,
    'client_from', project_client_status(r.status), 'client_to', project_client_status(v_new),
    'member_id', r.member_id, 'reference', r.reference);
end $$;

create or replace function assign_project(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r project_requests;
begin
  select * into r from project_requests where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (is_founder() or (is_sales() and r.assigned_to is null and p_user = auth.uid())) then
    raise exception 'Only founders can reassign projects. You can take a project nobody is working on yet.' using errcode = '42501';
  end if;
  if p_user is not null and not exists (select 1 from team_members where user_id = p_user and active and role::text in ('founder', 'sales')) then
    raise exception 'Projects can be assigned to founders and sales team members only.' using errcode = '22023';
  end if;
  update project_requests set assigned_to = p_user where id = p_id;
  perform project_event(p_id, 'assigned', jsonb_build_object('from', r.assigned_to, 'to', p_user,
    'to_name', (select name from team_members where user_id = p_user)));
end $$;

create or replace function add_project_note(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := clean_block(p_body);
begin
  if not is_sales() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v = '' then raise exception 'Write a note first.' using errcode = '22023'; end if;
  insert into project_notes (project_id, author, body) values (p_id, auth.uid(), left(v, 4000));
end $$;

-- Record an artist the team considered or recommends, and why. Internal only:
-- nothing here is ever sent to the client automatically.
create or replace function set_project_artist(p_id uuid, p_artist uuid, p_state text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  if p_state not in ('considered', 'recommended') then raise exception 'Unknown choice.' using errcode = '22023'; end if;
  if not exists (select 1 from public_artists where id = p_artist) then
    raise exception 'Only artists with a public, approved profile can be matched.' using errcode = '22023';
  end if;
  insert into project_artists (project_id, artist_id, state, reason, added_by)
  values (p_id, p_artist, p_state, left(clean_block(p_reason), 2000), auth.uid())
  on conflict (project_id, artist_id) do update set state = excluded.state, reason = excluded.reason, updated_at = now();
  perform project_event(p_id, 'artist_' || p_state, jsonb_build_object('artist', p_artist,
    'name', (select display_name from artists where id = p_artist)));
end $$;

create or replace function remove_project_artist(p_id uuid, p_artist uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  delete from project_artists where project_id = p_id and artist_id = p_artist;
  perform project_event(p_id, 'artist_removed', jsonb_build_object('artist', p_artist,
    'name', (select display_name from artists where id = p_artist)));
end $$;

create or replace function add_project_task(p_id uuid, p_title text, p_assignee uuid, p_due date, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := clean_line(p_title);
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  if char_length(v) < 2 then raise exception 'Please describe the follow-up.' using errcode = '22023'; end if;
  if p_due is null then raise exception 'Please choose a due date.' using errcode = '22023'; end if;
  if p_assignee is not null and not exists (select 1 from team_members where user_id = p_assignee and active and role::text in ('founder', 'sales')) then
    raise exception 'Follow-ups can be assigned to founders and sales team members only.' using errcode = '22023';
  end if;
  insert into project_tasks (project_id, title, assigned_to, due_on, notes, created_by)
  values (p_id, left(v, 200), coalesce(p_assignee, auth.uid()), p_due, left(clean_block(p_notes), 2000), auth.uid());
  perform project_event(p_id, 'task_added', jsonb_build_object('title', left(v, 200), 'due', p_due));
end $$;

create or replace function set_project_task_done(p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t project_tasks;
begin
  select * into t from project_tasks where id = p_task;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (can_manage_project(t.project_id) or (is_sales() and t.assigned_to = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update project_tasks set done = p_done, done_at = case when p_done then now() end where id = p_task;
  perform project_event(t.project_id, case when p_done then 'task_done' else 'task_reopened' end, jsonb_build_object('title', t.title));
end $$;

create or replace function delete_project_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t project_tasks;
begin
  select * into t from project_tasks where id = p_task;
  if not found then return; end if;
  if not can_manage_project(t.project_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from project_tasks where id = p_task;
  perform project_event(t.project_id, 'task_deleted', jsonb_build_object('title', t.title));
end $$;

-- Project value and M.E.E.T. revenue, recorded by hand. Nothing is calculated
-- from a rate: the agreed fee is written down as agreed. Final figures can only
-- be recorded for confirmed projects.
create or replace function update_project_money(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r project_requests;
  v_cur text := upper(btrim(coalesce(p->>'currency', '')));
  v_est numeric; v_fv numeric; v_fr numeric;
  v_pay text := coalesce(p->>'payment_status', 'not_recorded');
begin
  if not can_manage_project(p_id) then raise exception 'Only founders or the assigned team member can change this project.' using errcode = '42501'; end if;
  select * into r from project_requests where id = p_id;
  begin
    v_est := nullif(p->>'estimated_value', '')::numeric;
    v_fv := nullif(p->>'final_value', '')::numeric;
    v_fr := nullif(p->>'final_revenue', '')::numeric;
  exception when others then raise exception 'Please enter amounts as numbers, without the currency.' using errcode = '22023'; end;
  if v_cur <> '' and v_cur !~ '^[A-Z]{3}$' then raise exception 'Please use a three-letter currency code, for example AED or EUR.' using errcode = '22023'; end if;
  if (v_est is not null or v_fv is not null or v_fr is not null) and v_cur = '' then
    raise exception 'Please choose the currency for these amounts.' using errcode = '22023';
  end if;
  if (v_fv is not null or v_fr is not null) and r.status <> 'confirmed' then
    raise exception 'Final project value and final M.E.E.T. revenue can be recorded once the project is confirmed.' using errcode = '22023';
  end if;
  if v_pay not in ('not_recorded', 'not_due', 'awaiting', 'partly_paid', 'paid', 'not_applicable') then
    raise exception 'Unknown payment status.' using errcode = '22023';
  end if;
  update project_requests set currency = v_cur, estimated_value = v_est, fee_terms = left(clean_line(p->>'fee_terms'), 300),
    final_value = v_fv, final_revenue = v_fr, payment_status = v_pay, revenue_notes = left(clean_block(p->>'revenue_notes'), 2000)
  where id = p_id;
  perform project_event(p_id, 'money', jsonb_build_object('currency', v_cur, 'estimated_value', v_est, 'final_value', v_fv,
    'final_revenue', v_fr, 'payment_status', v_pay));
end $$;

grant execute on function create_project_request(jsonb), my_project_requests(), can_manage_project(uuid),
  set_project_status(uuid, text, text, text), assign_project(uuid, uuid), add_project_note(uuid, text),
  set_project_artist(uuid, uuid, text, text), remove_project_artist(uuid, uuid),
  add_project_task(uuid, text, uuid, date, text), set_project_task_done(uuid, boolean), delete_project_task(uuid),
  update_project_money(uuid, jsonb) to authenticated;
