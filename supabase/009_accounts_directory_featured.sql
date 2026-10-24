-- =============================================================================
-- M.E.E.T. update 009 (Phase 2): member accounts, public artist discovery,
-- and homepage featured content. Requires update 008. Safe to run more than once.
-- Paste into Supabase > SQL Editor > New query > Run.
-- Nothing is deleted or re-approved.
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
