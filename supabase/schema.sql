-- =============================================================================
-- M.E.E.T. platform database (Supabase / Postgres)
-- Paste this whole file into Supabase › SQL Editor › New query, then Run.
-- It is safe to run again: every object is created only if missing.
--
-- Security model
--   anon (public visitors) : may only call submit_application(). Nothing else.
--   artists (signed in)    : read and edit only their own profile, works and files.
--   team (signed in + email code) : review everything. Founders also manage the team.
--   service role           : used only by Netlify functions (invites, emails).
-- =============================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type app_status as enum ('new','in_review','more_info','approved','declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_status as enum ('draft','submitted','changes_requested','approved','declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type team_role as enum ('founder','operations','verification','partnerships','viewer');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists team_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        team_role not null default 'viewer',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists applications (
  id                      uuid primary key default gen_random_uuid(),
  reference               text not null unique,
  created_at              timestamptz not null default now(),
  status                  app_status not null default 'new',
  full_name               text not null,
  artist_name             text not null,
  email                   text not null,
  country                 text not null,
  city                    text not null default '',
  primary_discipline      text not null,
  discipline_other        text not null default '',
  practice                text not null,
  website                 text not null default '',
  social                  text not null default '',
  additional_disciplines  text not null default '',
  techniques              text not null default '',
  interest_commissions    boolean not null default false,
  interest_collaboration  boolean not null default false,
  portfolio_links         text[] not null default '{}',
  heard_about             text not null default '',
  consent_version         text not null,
  consent_at              timestamptz not null,
  possible_duplicate      boolean not null default false,
  reviewer                uuid references team_members(user_id) on delete set null,
  decided_by              uuid references team_members(user_id) on delete set null,
  decided_at              timestamptz,
  decision_note           text not null default '',
  artist_id               uuid references auth.users(id) on delete set null,
  invited_at              timestamptz,
  updated_at              timestamptz not null default now()
);
create index if not exists applications_email_idx on applications (lower(email));
create index if not exists applications_status_idx on applications (status, created_at desc);

create table if not exists application_notes (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications(id) on delete cascade,
  author          uuid not null default auth.uid() references team_members(user_id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);

create table if not exists artists (
  id               uuid primary key references auth.users(id) on delete cascade,
  application_id   uuid references applications(id) on delete set null,
  email            text not null,
  legal_name       text not null default '',
  display_name     text not null default '',
  country          text not null default '',
  city             text not null default '',
  craft            text not null default '',
  other_disciplines text not null default '',
  techniques       text not null default '',
  bio              text not null default '' check (char_length(bio) <= 1500),
  instagram        text not null default '',
  website          text not null default '',
  other_link       text not null default '',
  avatar_path      text not null default '',
  cover_path       text not null default '',
  profile_status   review_status not null default 'draft',
  feedback         text not null default '',
  submitted_at     timestamptz,
  reviewed_by      uuid references team_members(user_id) on delete set null,
  reviewed_at      timestamptz,
  published        boolean not null default false,   -- stays false until the official launch
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists artworks (
  id               uuid primary key default gen_random_uuid(),
  artist_id        uuid not null default auth.uid() references artists(id) on delete cascade,
  title            text not null default '' check (char_length(title) <= 160),
  year             int check (year is null or year between 1900 and 2100),
  materials        text not null default '' check (char_length(materials) <= 300),
  height           numeric check (height is null or height > 0),
  width            numeric check (width is null or width > 0),
  depth            numeric check (depth is null or depth > 0),
  unit             text not null default 'cm' check (unit in ('cm','in')),
  edition_type     text not null default 'One of a kind' check (edition_type in ('One of a kind','Limited edition','Open edition')),
  edition_size     int check (edition_size is null or edition_size between 1 and 10000),
  price            numeric check (price is null or price >= 0),
  price_on_request boolean not null default false,
  currency         text not null default 'AED' check (currency in ('AED','USD','EUR','GBP','SAR')),
  description      text not null default '' check (char_length(description) <= 1500),
  images           text[] not null default '{}' check (cardinality(images) <= 6),
  status           review_status not null default 'draft',
  feedback         text not null default '',
  submitted_at     timestamptz,
  reviewed_by      uuid references team_members(user_id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists artworks_artist_idx on artworks (artist_id, created_at desc);
create index if not exists artworks_status_idx on artworks (status);

create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor        uuid,
  actor_name   text not null default '',
  action       text not null,
  target_type  text not null default '',
  target_id    text not null default '',
  detail       jsonb not null default '{}'
);
create index if not exists audit_log_at_idx on audit_log (at desc);

-- Private plumbing (never exposed through the API)
create table if not exists submission_log (
  ip  text not null,
  at  timestamptz not null default now()
);
create index if not exists submission_log_idx on submission_log (ip, at);

create table if not exists app_config (
  key    text primary key,
  value  text not null
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function my_role() returns team_role
language sql stable security definer set search_path = public as $$
  select role from team_members where user_id = auth.uid() and active
$$;

-- Team sign-in sessions confirmed with an emailed 6-digit code.
create table if not exists team_session_checks (
  session_id   uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  sent_count   int not null default 1,
  sent_at      timestamptz not null default now(),
  verified_at  timestamptz
);
create index if not exists team_session_checks_user_idx on team_session_checks (user_id, sent_at desc);
alter table team_session_checks enable row level security;
revoke all on team_session_checks from anon, authenticated;

-- Team access: an active team member whose current sign-in session has been
-- confirmed with an emailed code (valid for 30 days on that device).
create or replace function session_confirmed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_session_checks
    where session_id = nullif(auth.jwt()->>'session_id','')::uuid
      and user_id = auth.uid()
      and verified_at is not null
      and verified_at > now() - interval '30 days')
$$;

create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where user_id = auth.uid() and active)
     and session_confirmed()
$$;

create or replace function is_founder() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where user_id = auth.uid() and active and role = 'founder')
     and session_confirmed()
$$;

-- Team members who may change things (viewers only read).
create or replace function is_team_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select is_team() and my_role() <> 'viewer'
$$;

create or replace function write_audit(p_action text, p_type text, p_id text, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, actor_name, action, target_type, target_id, detail)
  values (auth.uid(),
          coalesce((select name from team_members where user_id = auth.uid()),
                   (select display_name from artists where id = auth.uid()), ''),
          p_action, p_type, p_id, coalesce(p_detail, '{}'));
end $$;

create or replace function clean_line(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(t,''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function clean_block(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(replace(coalesce(t,''), E'\r', ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
           E'\n{3,}', E'\n\n', 'g'))
$$;

-- Accept "example.com" or a full http(s) address. Returns '' when empty, null when invalid.
create or replace function normalise_url(t text) returns text
language plpgsql immutable as $$
declare u text := btrim(coalesce(t,''));
begin
  if u = '' then return ''; end if;
  if u !~* '^[a-z][a-z0-9+.-]*://' then u := 'https://' || u; end if;
  if u !~* '^https?://[^/\s<>"'']+\.[^/\s<>"'']+' or u ~ '[\s<>"'']' then return null; end if;
  return u;
end $$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists applications_touch on applications;
create trigger applications_touch before update on applications for each row execute function touch_updated_at();
drop trigger if exists artists_touch on artists;
create trigger artists_touch before update on artists for each row execute function touch_updated_at();
drop trigger if exists artworks_touch on artworks;
create trigger artworks_touch before update on artworks for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Public registration (the only thing anonymous visitors can do)
-- ---------------------------------------------------------------------------
create or replace function submit_application(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  disciplines text[] := array[
    'Ceramics and pottery','Textiles, weaving and embroidery','Woodworking and carving','Glass',
    'Metalwork and jewellery','Painting','Drawing and illustration','Printmaking','Calligraphy and lettering',
    'Sculpture','Photography','Film and moving image','Digital art','Installation','Performance',
    'Leather, basketry and natural fibres','Other'];
  e jsonb := '{}';
  v_ip text;
  v_full text; v_artist text; v_email text; v_country text; v_city text; v_disc text; v_other text;
  v_practice text; v_web text; v_social text; v_more text; v_tech text; v_heard text; v_links text[] := '{}';
  l text; nl text; v_ref text; v_dup boolean;
begin
  -- Honeypot: people never fill this. Pretend success, store nothing.
  if clean_line(payload->>'company_website') <> '' then
    return jsonb_build_object('ok', true, 'reference', 'MEET-' || upper(substr(md5(random()::text),1,6)));
  end if;

  -- A person needs a few seconds to fill the form; scripted bots usually do not wait.
  if coalesce(case when payload->>'elapsed_ms' ~ '^\d{1,12}$' then (payload->>'elapsed_ms')::bigint end, 0) < 3000 then
    return jsonb_build_object('ok', false, 'code', 'fast', 'message', 'That was very quick. Please wait a few seconds and send again.');
  end if;

  -- Per-connection limit (generous: an exhibition tablet sends many artists from one address).
  v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'), ',', 1);
  delete from submission_log where at < now() - interval '1 day';
  if (select count(*) from submission_log where submission_log.ip = v_ip and at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'code', 'rate', 'message',
      'We have received many applications from this connection in the last hour. Please try again later.');
  end if;

  v_full     := clean_line(payload->>'full_name');
  v_artist   := clean_line(payload->>'artist_name');
  v_email    := lower(clean_line(payload->>'email'));
  v_country  := clean_line(payload->>'country');
  v_city     := clean_line(payload->>'city');
  v_disc     := clean_line(payload->>'primary_discipline');
  v_other    := clean_line(payload->>'discipline_other');
  v_practice := clean_block(payload->>'practice');
  v_social   := clean_line(payload->>'social');
  v_more     := clean_line(payload->>'additional_disciplines');
  v_tech     := clean_line(payload->>'techniques');
  v_heard    := clean_line(payload->>'heard_about');

  if v_full = '' then e := e || '{"full_name":"Please enter your full name."}'; end if;
  if v_artist = '' then e := e || '{"artist_name":"Please enter your professional or artist name. It can be the same as your full name."}'; end if;
  if v_email = '' then e := e || '{"email":"Please enter your email address."}';
  elsif v_email !~ '^[^@\s<>"'']{1,64}@[^@\s<>"'']+\.[^@\s<>"'']{2,}$' then
    e := e || '{"email":"This email address does not look complete. Please check it, for example name@studio.com"}'; end if;
  if v_country = '' then e := e || '{"country":"Please tell us which country you are based in."}'; end if;
  if v_disc = '' then e := e || '{"primary_discipline":"Please choose your main discipline."}';
  elsif not (v_disc = any(disciplines)) then e := e || '{"primary_discipline":"Please choose a discipline from the list, or choose Other and describe it."}'; end if;
  if v_disc = 'Other' and v_other = '' then e := e || '{"discipline_other":"Please describe your discipline in a few words."}'; end if;
  if v_disc <> 'Other' then v_other := ''; end if;
  if v_practice = '' then e := e || '{"practice":"Please describe your practice in a few sentences."}';
  elsif char_length(v_practice) < 40 then e := e || '{"practice":"Please tell us a little more, at least a couple of sentences (40 characters or more)."}'; end if;

  if char_length(v_full) > 120 then e := e || '{"full_name":"Please keep this under 120 characters."}'; end if;
  if char_length(v_artist) > 120 then e := e || '{"artist_name":"Please keep this under 120 characters."}'; end if;
  if char_length(v_email) > 254 then e := e || '{"email":"Please keep this under 254 characters."}'; end if;
  if char_length(v_country) > 80 then e := e || '{"country":"Please keep this under 80 characters."}'; end if;
  if char_length(v_city) > 80 then e := e || '{"city":"Please keep this under 80 characters."}'; end if;
  if char_length(v_other) > 120 then e := e || '{"discipline_other":"Please keep this under 120 characters."}'; end if;
  if char_length(v_practice) > 1500 then e := e || '{"practice":"Please keep this under 1500 characters."}'; end if;
  if char_length(v_social) > 300 then e := e || '{"social":"Please keep this under 300 characters."}'; end if;
  if char_length(v_more) > 400 then e := e || '{"additional_disciplines":"Please keep this under 400 characters."}'; end if;
  if char_length(v_tech) > 400 then e := e || '{"techniques":"Please keep this under 400 characters."}'; end if;
  v_heard := left(v_heard, 120);

  v_web := normalise_url(payload->>'website');
  if v_web is null or char_length(v_web) > 300 then
    e := e || '{"website":"Please enter a full web address, for example https://yourname.com"}'; v_web := ''; end if;

  for l in select btrim(x) from regexp_split_to_table(coalesce(payload->>'portfolio_links',''), E'\n') as x loop
    continue when l = '';
    nl := normalise_url(l);
    if nl is null or char_length(nl) > 300 then
      e := e || jsonb_build_object('portfolio_links', 'One of these links is not a full web address: ' || left(l, 60));
      exit;
    end if;
    v_links := v_links || nl;
  end loop;
  if cardinality(v_links) > 6 then e := e || '{"portfolio_links":"Please share up to 6 links."}'; end if;

  if coalesce((payload->>'consent_privacy')::boolean, false) is not true then
    e := e || '{"consent_privacy":"Please confirm that you have read the privacy notice so we can store your application."}'; end if;

  if e <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Please check the highlighted fields.', 'errors', e);
  end if;

  insert into submission_log (ip) values (v_ip);
  v_dup := exists (select 1 from applications where lower(email) = v_email);

  loop
    v_ref := 'MEET-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from applications where reference = v_ref);
  end loop;

  insert into applications (reference, full_name, artist_name, email, country, city, primary_discipline,
    discipline_other, practice, website, social, additional_disciplines, techniques, interest_commissions,
    interest_collaboration, portfolio_links, heard_about, consent_version, consent_at, possible_duplicate)
  values (v_ref, v_full, v_artist, v_email, v_country, v_city, v_disc, v_other, v_practice, v_web, v_social,
    v_more, v_tech, coalesce((payload->>'interest_commissions')::boolean, false),
    coalesce((payload->>'interest_collaboration')::boolean, false), v_links, v_heard,
    '2026-10-20', now(), v_dup);

  return jsonb_build_object('ok', true, 'reference', v_ref);
end $$;

-- ---------------------------------------------------------------------------
-- Team actions on applications (approve runs in a Netlify function, because
-- creating the artist's login needs the service role)
-- ---------------------------------------------------------------------------
create or replace function set_application_status(p_id uuid, p_status app_status, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status = 'approved' then raise exception 'use the approve action' using errcode = '22023'; end if;
  update applications
     set status = p_status,
         decision_note = case when p_status in ('declined','more_info') then left(clean_block(p_note), 4000) else decision_note end,
         decided_by = case when p_status in ('declined','more_info') then auth.uid() else decided_by end,
         decided_at = case when p_status in ('declined','more_info') then now() else decided_at end
   where id = p_id;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  perform write_audit('application.' || p_status::text, 'application', p_id::text,
                      jsonb_build_object('note', left(coalesce(p_note,''), 500)));
end $$;

create or replace function assign_application(p_id uuid, p_reviewer uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reviewer is not null and not exists (select 1 from team_members where user_id = p_reviewer and active) then
    raise exception 'unknown reviewer' using errcode = '22023'; end if;
  update applications set reviewer = p_reviewer,
         status = case when status = 'new' then 'in_review'::app_status else status end
   where id = p_id;
  perform write_audit('application.assign', 'application', p_id::text, jsonb_build_object('reviewer', p_reviewer));
end $$;

create or replace function add_application_note(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into application_notes (application_id, author, body) values (p_id, auth.uid(), left(clean_block(p_body), 4000));
  perform write_audit('application.note', 'application', p_id::text, '{}');
end $$;

-- ---------------------------------------------------------------------------
-- Artist studio: the artist edits content; status changes only through these
-- ---------------------------------------------------------------------------
-- Changing an approved or submitted item sends it back to draft so the team
-- always reviews what will eventually be shown. Saving without changes does not.
create or replace function artist_profile_edit_resets_review() returns trigger
language plpgsql as $$
begin
  if auth.uid() = new.id and not is_team() and new.profile_status in ('submitted','approved')
     and (to_jsonb(new) - array['profile_status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at','published'])
         is distinct from
         (to_jsonb(old) - array['profile_status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at','published']) then
    new.profile_status := 'draft';
  end if;
  return new;
end $$;

create or replace function artist_artwork_edit_resets_review() returns trigger
language plpgsql as $$
begin
  if auth.uid() = new.artist_id and not is_team() and new.status in ('submitted','approved')
     and (to_jsonb(new) - array['status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at'])
         is distinct from
         (to_jsonb(old) - array['status','feedback','submitted_at','reviewed_by','reviewed_at','updated_at']) then
    new.status := 'draft';
  end if;
  return new;
end $$;

drop trigger if exists artists_edit_reset on artists;
create trigger artists_edit_reset before update of display_name, legal_name, country, city, craft, other_disciplines, techniques, bio,
  instagram, website, other_link, avatar_path, cover_path on artists
  for each row execute function artist_profile_edit_resets_review();

drop trigger if exists artworks_edit_reset on artworks;
create trigger artworks_edit_reset before update of title, year, materials, height, width, depth, unit, edition_type,
  edition_size, price, price_on_request, currency, description, images on artworks
  for each row execute function artist_artwork_edit_resets_review();

create or replace function submit_profile() returns void
language plpgsql security definer set search_path = public as $$
declare a artists;
begin
  select * into a from artists where id = auth.uid();
  if not found then raise exception 'no studio for this account' using errcode = '42501'; end if;
  if a.display_name = '' or a.craft = '' or char_length(a.bio) < 40 or a.avatar_path = '' then
    raise exception 'Please add your name, main discipline, a biography of at least 40 characters and a profile picture.' using errcode = '22023';
  end if;
  update artists set profile_status = 'submitted', submitted_at = now() where id = auth.uid();
  perform write_audit('profile.submit', 'artist', auth.uid()::text, '{}');
end $$;

create or replace function submit_artwork(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w artworks;
begin
  select * into w from artworks where id = p_id and artist_id = auth.uid();
  if not found then raise exception 'artwork not found' using errcode = 'P0002'; end if;
  if w.title = '' or cardinality(w.images) < 1 then
    raise exception 'Please add a title and at least one photograph.' using errcode = '22023';
  end if;
  if not w.price_on_request and w.price is null then
    raise exception 'Please add a price, or choose price on request.' using errcode = '22023';
  end if;
  update artworks set status = 'submitted', submitted_at = now() where id = p_id;
  perform write_audit('artwork.submit', 'artwork', p_id::text, jsonb_build_object('title', w.title));
end $$;

-- Team review of a profile or an artwork. Emails are sent by the Netlify function.
create or replace function review_item(p_type text, p_id uuid, p_decision review_status, p_feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_decision not in ('approved','changes_requested','declined') then raise exception 'bad decision' using errcode = '22023'; end if;
  if p_type = 'profile' then
    update artists set profile_status = p_decision, feedback = left(clean_block(p_feedback), 4000),
           reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  elsif p_type = 'artwork' then
    update artworks set status = p_decision, feedback = left(clean_block(p_feedback), 4000),
           reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  else
    raise exception 'bad type' using errcode = '22023';
  end if;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform write_audit(p_type || '.' || p_decision::text, p_type, p_id::text, jsonb_build_object('feedback', left(coalesce(p_feedback,''), 500)));
end $$;

-- Founders manage roles; nobody can lock themselves out.
create or replace function set_team_member(p_user uuid, p_role team_role, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_founder() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_user = auth.uid() and (p_role <> 'founder' or not p_active) then
    raise exception 'You cannot remove your own founder access.' using errcode = '22023'; end if;
  update team_members set role = p_role, active = p_active where user_id = p_user;
  perform write_audit('team.update', 'team_member', p_user::text, jsonb_build_object('role', p_role, 'active', p_active));
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table team_members      enable row level security;
alter table applications      enable row level security;
alter table application_notes enable row level security;
alter table artists           enable row level security;
alter table artworks          enable row level security;
alter table audit_log         enable row level security;
alter table submission_log    enable row level security;
alter table app_config        enable row level security;

-- Start from nothing, then grant exactly what each role needs.
revoke all on team_members, applications, application_notes, artists, artworks, audit_log, submission_log, app_config
  from anon, authenticated;
revoke all on function submit_application(jsonb) from public;

grant select on team_members, applications, application_notes, audit_log to authenticated;
grant select on artists, artworks to authenticated;
grant update (display_name, legal_name, country, city, craft, other_disciplines, techniques, bio, instagram, website, other_link,
              avatar_path, cover_path) on artists to authenticated;
grant insert (title, year, materials, height, width, depth, unit, edition_type, edition_size, price,
              price_on_request, currency, description, images) on artworks to authenticated;
grant update (title, year, materials, height, width, depth, unit, edition_type, edition_size, price,
              price_on_request, currency, description, images) on artworks to authenticated;
grant delete on artworks to authenticated;

drop policy if exists team_read_members on team_members;
create policy team_read_members on team_members for select to authenticated
  using (is_team() or user_id = auth.uid());

drop policy if exists team_read_apps on applications;
create policy team_read_apps on applications for select to authenticated using (is_team());

drop policy if exists team_read_notes on application_notes;
create policy team_read_notes on application_notes for select to authenticated using (is_team());

drop policy if exists team_read_audit on audit_log;
create policy team_read_audit on audit_log for select to authenticated using (is_team());

drop policy if exists read_artists on artists;
create policy read_artists on artists for select to authenticated using (id = auth.uid() or is_team());
drop policy if exists own_update_artist on artists;
create policy own_update_artist on artists for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists read_artworks on artworks;
create policy read_artworks on artworks for select to authenticated using (artist_id = auth.uid() or is_team());
drop policy if exists own_insert_artwork on artworks;
create policy own_insert_artwork on artworks for insert to authenticated
  with check (artist_id = auth.uid() and exists (select 1 from artists where id = auth.uid()));
drop policy if exists own_update_artwork on artworks;
create policy own_update_artwork on artworks for update to authenticated
  using (artist_id = auth.uid()) with check (artist_id = auth.uid());
drop policy if exists own_delete_artwork on artworks;
create policy own_delete_artwork on artworks for delete to authenticated
  using (artist_id = auth.uid() and status <> 'approved');

grant execute on function submit_application(jsonb) to anon, authenticated;
grant execute on function my_role(), session_confirmed(), is_team(), is_founder(), is_team_editor() to authenticated;
grant execute on function set_application_status(uuid, app_status, text), assign_application(uuid, uuid),
  add_application_note(uuid, text), submit_profile(), submit_artwork(uuid),
  review_item(text, uuid, review_status, text), set_team_member(uuid, team_role, boolean) to authenticated;
revoke execute on function write_audit(text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private file storage for artist photographs
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artist-media', 'artist-media', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'artist-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_team()));
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'artist-media' and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.artists where id = auth.uid()));
drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'artist-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'artist-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Google Sheet mirror: every new or changed application is posted to the
-- Apps Script web app. Set the two values once (see SETUP.md):
--   insert into app_config values ('sheet_webhook_url', 'https://script.google.com/macros/s/.../exec');
--   insert into app_config values ('sheet_webhook_secret', 'a-long-random-string');
-- ---------------------------------------------------------------------------
create or replace function push_application_to_sheet() returns trigger
language plpgsql security definer set search_path = public as $$
declare url text; secret text; reviewer_name text;
begin
  select value into url from app_config where key = 'sheet_webhook_url';
  select value into secret from app_config where key = 'sheet_webhook_secret';
  if url is null or secret is null then return new; end if;
  select name into reviewer_name from team_members where user_id = new.reviewer;
  perform net.http_post(
    url := url,
    body := jsonb_build_object(
      'secret', secret,
      'reference', new.reference, 'status', new.status, 'created_at', new.created_at,
      'full_name', new.full_name, 'artist_name', new.artist_name, 'email', new.email,
      'country', new.country, 'city', new.city, 'primary_discipline', new.primary_discipline,
      'discipline_other', new.discipline_other, 'practice', new.practice, 'website', new.website,
      'social', new.social, 'additional_disciplines', new.additional_disciplines, 'techniques', new.techniques,
      'interest_commissions', new.interest_commissions, 'interest_collaboration', new.interest_collaboration,
      'portfolio_links', array_to_string(new.portfolio_links, E'\n'), 'heard_about', new.heard_about,
      'possible_duplicate', new.possible_duplicate, 'reviewer', coalesce(reviewer_name, ''),
      'decided_at', new.decided_at, 'decision_note', new.decision_note, 'invited_at', new.invited_at),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;   -- the Sheet is a mirror: never block saving an application
end $$;

drop trigger if exists applications_to_sheet on applications;
create trigger applications_to_sheet after insert or update on applications
  for each row execute function push_application_to_sheet();

-- ---------------------------------------------------------------------------
-- FIRST FOUNDER (run once, after creating your login in Authentication › Users):
--   insert into team_members (user_id, name, email, role)
--   select id, 'Pia Maria Nehme', email, 'founder' from auth.users where email = 'YOUR-LOGIN-EMAIL';
-- ---------------------------------------------------------------------------
