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
  source                  text not null default '',
  consent_version         text not null,
  consent_at              timestamptz not null,
  possible_duplicate      boolean not null default false,
  reviewer                uuid references team_members(user_id) on delete set null,
  decided_by              uuid references team_members(user_id) on delete set null,
  decided_at              timestamptz,
  decision_note           text not null default '',
  artist_id               uuid references auth.users(id) on delete set null,
  invited_at              timestamptz,
  notified_at             timestamptz,
  updated_at              timestamptz not null default now()
);
create index if not exists applications_email_idx on applications (lower(email));
create index if not exists applications_status_idx on applications (status, created_at desc);

-- References count up: MEET-0001, MEET-0002, ...
create sequence if not exists application_ref_seq start 1;

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
  published        boolean not null default false,   -- obsolete since update 008 (visibility follows approvals)
  terms_version    text not null default '',
  terms_accepted_at timestamptz,
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
  v_practice text; v_web text; v_social text; v_more text; v_tech text; v_heard text; v_source text; v_links text[] := '{}';
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
  -- Where the visitor came from, e.g. 'qr-dubai' from the printed QR card.
  v_source   := left(regexp_replace(lower(coalesce(payload->>'source','')), '[^a-z0-9-]', '', 'g'), 40);

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
    v_ref := 'MEET-' || lpad(nextval('application_ref_seq')::text, 4, '0');
    exit when not exists (select 1 from applications where reference = v_ref);
  end loop;

  insert into applications (reference, full_name, artist_name, email, country, city, primary_discipline,
    discipline_other, practice, website, social, additional_disciplines, techniques, interest_commissions,
    interest_collaboration, portfolio_links, heard_about, source, consent_version, consent_at, possible_duplicate)
  values (v_ref, v_full, v_artist, v_email, v_country, v_city, v_disc, v_other, v_practice, v_web, v_social,
    v_more, v_tech, coalesce((payload->>'interest_commissions')::boolean, false),
    coalesce((payload->>'interest_collaboration')::boolean, false), v_links, v_heard, v_source,
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

-- The artist agrees to the Artist terms once (again when the terms change).
create or replace function accept_terms(p_version text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from artists where id = auth.uid()) then
    raise exception 'no studio for this account' using errcode = '42501';
  end if;
  update artists set terms_version = left(p_version, 20), terms_accepted_at = now() where id = auth.uid();
  perform write_audit('artist.terms_accepted', 'artist', auth.uid()::text, jsonb_build_object('version', left(p_version, 20)));
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
  review_item(text, uuid, review_status, text), set_team_member(uuid, team_role, boolean),
  accept_terms(text) to authenticated;
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
declare url text; secret text; reviewer_name text; body jsonb;
begin
  select value into url from app_config where key = 'sheet_webhook_url';
  select value into secret from app_config where key = 'sheet_webhook_secret';
  if url is null or secret is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    -- Erasure: remove the row from the Sheet copy too.
    body := jsonb_build_object('secret', secret, 'reference', old.reference, 'deleted', true);
  else
    select name into reviewer_name from team_members where user_id = new.reviewer;
    body := jsonb_build_object(
      'secret', secret,
      'reference', new.reference, 'status', new.status, 'created_at', new.created_at,
      'full_name', new.full_name, 'artist_name', new.artist_name, 'email', new.email,
      'country', new.country, 'city', new.city, 'primary_discipline', new.primary_discipline,
      'discipline_other', new.discipline_other, 'practice', new.practice, 'website', new.website,
      'social', new.social, 'additional_disciplines', new.additional_disciplines, 'techniques', new.techniques,
      'interest_commissions', new.interest_commissions, 'interest_collaboration', new.interest_collaboration,
      'portfolio_links', array_to_string(new.portfolio_links, E'\n'), 'heard_about', new.heard_about,
      'source', new.source,
      'possible_duplicate', new.possible_duplicate, 'reviewer', coalesce(reviewer_name, ''),
      'decided_at', new.decided_at, 'decision_note', new.decision_note, 'invited_at', new.invited_at);
  end if;
  perform net.http_post(url := url, body := body, headers := '{"Content-Type":"application/json"}'::jsonb);
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);   -- the Sheet is a mirror: never block the database
end $$;

drop trigger if exists applications_to_sheet on applications;
create trigger applications_to_sheet after insert or update or delete on applications
  for each row execute function push_application_to_sheet();

-- ---------------------------------------------------------------------------
-- Email alert to the team for each new application. The database tells the
-- site's /api/new-application function, which emails every active team
-- member once (it only acts on fresh, not-yet-notified applications).
-- ---------------------------------------------------------------------------
create or replace function alert_team_new_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text;
begin
  select value into site from app_config where key = 'site_url';
  perform net.http_post(
    url := coalesce(site, 'https://meetstudio.art') || '/api/new-application',
    body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;   -- an alert must never block saving an application
end $$;

drop trigger if exists applications_alert_team on applications;
create trigger applications_alert_team after insert on applications
  for each row execute function alert_team_new_application();

-- Email the team when an artist sends their profile or an artwork for review.
alter table artists  add column if not exists submit_notified_at timestamptz;
alter table artworks add column if not exists submit_notified_at timestamptz;

-- When something becomes "submitted", tell the site's /api/studio-activity
-- function, which emails the team once per submission.
create or replace function alert_team_studio_submit() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text; kind text;
begin
  kind := case when tg_table_name = 'artists' then 'profile' else 'artwork' end;
  select value into site from app_config where key = 'site_url';
  perform net.http_post(
    url := coalesce(site, 'https://meetstudio.art') || '/api/studio-activity',
    body := jsonb_build_object('type', kind, 'id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;   -- an alert must never block the artist's action
end $$;

drop trigger if exists artists_alert_submit on artists;
create trigger artists_alert_submit after update of profile_status on artists
  for each row when (new.profile_status = 'submitted' and old.profile_status is distinct from 'submitted')
  execute function alert_team_studio_submit();

drop trigger if exists artworks_alert_submit on artworks;
create trigger artworks_alert_submit after update of status on artworks
  for each row when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function alert_team_studio_submit();

-- ---------------------------------------------------------------------------
-- Public publishing (Phase 1): approved artists and approved artworks are
-- readable by everyone through two safe views. See update 008 for the rules.
-- ---------------------------------------------------------------------------
-- The Artist terms version whose agreement permits publication. Artists who
-- agreed to an older version are asked to agree again in their studio, and
-- stay unpublished until they do.
insert into app_config (key, value) values ('terms_version_current', '2026-10-24')
on conflict (key) do update set value = excluded.value;

-- The old launch flag is no longer used: visibility now follows approvals.
comment on column artists.published is
  'Obsolete since update 008. Public visibility is derived from approvals; see the public_artists view.';

-- ---------------------------------------------------------------------------
-- Public views. They run with the view owner's rights (so visitors never get
-- access to the underlying tables) and expose only safe columns.
-- ---------------------------------------------------------------------------
create or replace view public_artists
with (security_invoker = false) as
select
  a.id,
  a.display_name,
  a.country,
  a.city,
  a.craft              as main_discipline,
  a.other_disciplines,
  a.techniques,
  a.bio,
  a.avatar_path,
  a.cover_path,
  a.reviewed_at        as approved_at
from artists a
join applications ap on ap.id = a.application_id
where ap.status = 'approved'
  and a.profile_status = 'approved'
  and a.terms_accepted_at is not null
  and a.terms_version = (select value from app_config where key = 'terms_version_current');

create or replace view public_artworks
with (security_invoker = false) as
select
  w.id,
  w.artist_id,
  w.title,
  w.year,
  w.materials,
  w.height,
  w.width,
  w.depth,
  w.unit,
  w.edition_type,
  w.edition_size,
  w.price,
  w.price_on_request,
  w.currency,
  w.description,
  w.images,
  w.reviewed_at        as approved_at
from artworks w
join public_artists p on p.id = w.artist_id
where w.status = 'approved';

revoke all on public_artists, public_artworks from public, anon, authenticated;
grant select on public_artists, public_artworks to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public photographs: visitors may read only the files that belong to a
-- public artist (profile picture, cover) or to a public artwork. Every other
-- file in the private bucket stays private. Existing owner/team rules remain.
-- ---------------------------------------------------------------------------
create or replace function is_public_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public_artists where avatar_path = p_name or cover_path = p_name)
      or exists (select 1 from public_artworks where p_name = any(images))
$$;
revoke all on function is_public_media(text) from public;
grant execute on function is_public_media(text) to anon, authenticated;

drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'artist-media' and public.is_public_media(name));

-- Is this artist publicly visible right now? (used by the team console)
create or replace function artist_is_public(p_artist uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public_artists where id = p_artist)
$$;
revoke all on function artist_is_public(uuid) from public;
grant execute on function artist_is_public(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- FIRST FOUNDER (run once, after creating your login in Authentication › Users):
--   insert into team_members (user_id, name, email, role)
--   select id, 'Pia Maria Nehme', email, 'founder' from auth.users where email = 'YOUR-LOGIN-EMAIL';
-- ---------------------------------------------------------------------------

-- =============================================================================
-- Phase 2 (update 009): member accounts, public discovery and homepage selection.
-- =============================================================================
-- ---------------------------------------------------------------------------
-- 1. Member accounts (Personal, Professional, Business & Organization)
--    These are separate from artists (who join through the application and
--    approval process) and from the team. All three use the same Supabase
--    logins: one person = one login.
-- ---------------------------------------------------------------------------
do $$ begin
  create type account_type as enum ('personal', 'professional', 'business');
exception when duplicate_object then null; end $$;

create table if not exists member_accounts (
  id                    uuid primary key references auth.users(id) on delete cascade,
  account_type          account_type not null,
  email                 text not null,
  full_name             text not null check (char_length(full_name) between 1 and 120),
  country               text not null check (char_length(country) between 1 and 80),
  phone                 text not null default '' check (phone = '' or phone ~ '^[+()0-9 .-]{6,40}$'),
  professional_role     text not null default '' check (char_length(professional_role) <= 120),
  company_name          text not null default '' check (char_length(company_name) <= 160),
  professional_website  text not null default '' check (char_length(professional_website) <= 300),
  business_name         text not null default '' check (char_length(business_name) <= 160),
  contact_person        text not null default '' check (char_length(contact_person) <= 120),
  business_type         text not null default '' check (char_length(business_type) <= 120),
  business_website      text not null default '' check (char_length(business_website) <= 300),
  deletion_requested_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Type-specific required fields (websites are optional).
  constraint member_type_fields check (
    (account_type <> 'professional' or (professional_role <> '' and company_name <> ''))
    and (account_type <> 'business' or (business_name <> '' and contact_person <> '' and business_type <> ''))
  )
);
create index if not exists member_accounts_type_idx on member_accounts (account_type, created_at desc);

drop trigger if exists member_accounts_touch on member_accounts;
create trigger member_accounts_touch before update on member_accounts for each row execute function touch_updated_at();

-- The account type can never be changed by the member (only the database
-- owner, e.g. a founder running SQL, could change it deliberately).
create or replace function member_account_type_locked() returns trigger
language plpgsql as $$
begin
  if new.account_type is distinct from old.account_type and current_user in ('authenticated', 'anon') then
    raise exception 'The account type cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists member_account_type_lock on member_accounts;
create trigger member_account_type_lock before update on member_accounts
  for each row execute function member_account_type_locked();

-- Every save is tidied and checked here, whatever the browser sent: single
-- lines of text, and website addresses that are real http(s) links.
create or replace function member_accounts_clean() returns trigger
language plpgsql as $$
declare pro text := normalise_url(new.professional_website); biz text := normalise_url(new.business_website);
begin
  if pro is null or biz is null then
    raise exception 'Please enter a full web address, for example https://studio.com' using errcode = '22023';
  end if;
  new.professional_website := pro;
  new.business_website := biz;
  new.full_name := clean_line(new.full_name);
  new.country := clean_line(new.country);
  new.phone := clean_line(new.phone);
  new.professional_role := clean_line(new.professional_role);
  new.company_name := clean_line(new.company_name);
  new.business_name := clean_line(new.business_name);
  new.contact_person := clean_line(new.contact_person);
  new.business_type := clean_line(new.business_type);
  return new;
end $$;
drop trigger if exists member_accounts_tidy on member_accounts;
create trigger member_accounts_tidy before insert or update on member_accounts
  for each row execute function member_accounts_clean();

alter table member_accounts enable row level security;
revoke all on member_accounts from anon, authenticated;
grant select on member_accounts to authenticated;
-- Members may edit these columns of their own row only. account_type, email,
-- deletion_requested_at and the dates are not editable by members.
grant update (full_name, country, phone, professional_role, company_name, professional_website,
              business_name, contact_person, business_type, business_website) on member_accounts to authenticated;

drop policy if exists member_read on member_accounts;
create policy member_read on member_accounts for select to authenticated
  using (id = auth.uid() or is_team());
drop policy if exists member_update_own on member_accounts;
create policy member_update_own on member_accounts for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- When someone signs up through /signup, Supabase creates their login and this
-- trigger creates their member account from the sign-up form. Invited artists
-- and team members carry no account_type, so they are untouched.
create or replace function handle_new_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); t text := m->>'account_type';
  pro_site text; biz_site text;
begin
  if t is null or t not in ('personal', 'professional', 'business') then return new; end if;
  pro_site := coalesce(normalise_url(m->>'professional_website'), '');
  biz_site := coalesce(normalise_url(m->>'business_website'), '');
  insert into member_accounts (id, account_type, email, full_name, country, phone,
      professional_role, company_name, professional_website,
      business_name, contact_person, business_type, business_website)
  values (new.id, t::account_type, lower(new.email),
      left(clean_line(m->>'full_name'), 120), left(clean_line(m->>'country'), 80), left(clean_line(m->>'phone'), 40),
      case when t = 'professional' then left(clean_line(m->>'professional_role'), 120) else '' end,
      case when t = 'professional' then left(clean_line(m->>'company_name'), 160) else '' end,
      case when t = 'professional' then left(pro_site, 300) else '' end,
      case when t = 'business' then left(clean_line(m->>'business_name'), 160) else '' end,
      case when t = 'business' then left(clean_line(m->>'contact_person'), 120) else '' end,
      case when t = 'business' then left(clean_line(m->>'business_type'), 120) else '' end,
      case when t = 'business' then left(biz_site, 300) else '' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created_member on auth.users;
create trigger on_auth_user_created_member after insert on auth.users
  for each row execute function handle_new_member();

-- The signed-in person's member account type (null for artists and team).
-- Later phases use this to decide what each account type may do.
create or replace function my_account_type() returns account_type
language sql stable security definer set search_path = public as $$
  select account_type from member_accounts where id = auth.uid()
$$;
grant execute on function my_account_type() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cultural traditions (optional, supplied by the artist in their studio)
-- ---------------------------------------------------------------------------
alter table artists add column if not exists traditions text not null default ''
  check (char_length(traditions) <= 400);
grant update (traditions) on artists to authenticated;

-- Editing traditions, like any other profile field, returns the profile to review.
drop trigger if exists artists_edit_reset on artists;
create trigger artists_edit_reset before update of display_name, legal_name, country, city, craft, other_disciplines,
  techniques, traditions, bio, instagram, website, other_link, avatar_path, cover_path on artists
  for each row execute function artist_profile_edit_resets_review();

-- Public artist view, now with traditions (same rules as update 008).
create or replace view public_artists
with (security_invoker = false) as
select
  a.id, a.display_name, a.country, a.city, a.craft as main_discipline, a.other_disciplines,
  a.techniques, a.bio, a.avatar_path, a.cover_path, a.reviewed_at as approved_at, a.traditions
from artists a
join applications ap on ap.id = a.application_id
where ap.status = 'approved'
  and a.profile_status = 'approved'
  and a.terms_accepted_at is not null
  and a.terms_version = (select value from app_config where key = 'terms_version_current');
grant select on public_artists to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Homepage featured content, chosen by the team.
--    Only public artists and public artworks can be featured, and a featured
--    item disappears from the homepage by itself if it stops being public.
-- ---------------------------------------------------------------------------
create table if not exists featured_items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('artist', 'artwork')),
  item_id     uuid not null,
  position    int not null default 0,
  created_by  uuid references team_members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, item_id)
);
alter table featured_items enable row level security;
revoke all on featured_items from anon, authenticated;
grant select on featured_items to authenticated;
drop policy if exists featured_team_read on featured_items;
create policy featured_team_read on featured_items for select to authenticated using (is_team());

create or replace function feature_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind = 'artist' and not exists (select 1 from public_artists where id = p_id) then
    raise exception 'Only public artists can be featured.' using errcode = '22023';
  elsif p_kind = 'artwork' and not exists (select 1 from public_artworks where id = p_id) then
    raise exception 'Only public artworks can be featured.' using errcode = '22023';
  elsif p_kind not in ('artist', 'artwork') then
    raise exception 'bad kind' using errcode = '22023';
  end if;
  insert into featured_items (kind, item_id, position, created_by)
  values (p_kind, p_id, coalesce((select max(position) + 1 from featured_items where kind = p_kind), 0), auth.uid())
  on conflict (kind, item_id) do nothing;
  perform write_audit('featured.add', p_kind, p_id::text, '{}');
end $$;

create or replace function unfeature_item(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from featured_items where kind = p_kind and item_id = p_id;
  perform write_audit('featured.remove', p_kind, p_id::text, '{}');
end $$;

-- Move a featured item one place earlier (-1) or later (+1).
create or replace function move_featured(p_kind text, p_id uuid, p_dir int) returns void
language plpgsql security definer set search_path = public as $$
declare me featured_items; other featured_items;
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into me from featured_items where kind = p_kind and item_id = p_id;
  if not found then return; end if;
  if p_dir < 0 then
    select * into other from featured_items where kind = p_kind and position < me.position order by position desc limit 1;
  else
    select * into other from featured_items where kind = p_kind and position > me.position order by position asc limit 1;
  end if;
  if not found then return; end if;
  update featured_items set position = other.position where id = me.id;
  update featured_items set position = me.position where id = other.id;
end $$;

grant execute on function feature_item(text, uuid), unfeature_item(text, uuid), move_featured(text, uuid, int) to authenticated;

create or replace view public_featured_artists
with (security_invoker = false) as
select f.position, p.*
from featured_items f join public_artists p on p.id = f.item_id
where f.kind = 'artist';

create or replace view public_featured_artworks
with (security_invoker = false) as
select f.position, w.*, p.display_name as artist_name
from featured_items f
join public_artworks w on w.id = f.item_id
join public_artists p on p.id = w.artist_id
where f.kind = 'artwork';

revoke all on public_featured_artists, public_featured_artworks from public, anon, authenticated;
grant select on public_featured_artists, public_featured_artworks to anon, authenticated;

-- =============================================================================
-- Phase 3 (update 010): inquiries, project requests, sales, public price choice.
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
