-- =============================================================================
-- M.E.E.T. update 008 (Phase 1): public publishing foundation.
--
-- Approved artists and their individually approved artworks become publicly
-- readable automatically, through two read-only views. Nothing is deleted,
-- reset or re-approved. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.
--
-- Public rules (enforced here, in the database):
--   An artist is public when ALL are true:
--     - their account is approved      (their application status = 'approved')
--     - their profile is approved      (artists.profile_status = 'approved')
--     - they agreed to the current Artist terms, which allow publication
--   An artwork is public when its own status = 'approved' AND its artist is public.
--   Anything else (draft, submitted, changes requested, declined, an approved
--   item edited and awaiting re-review, a declined account) stays hidden.
--
-- Only presentation fields are exposed. Legal name, email, Instagram, website,
-- other links, review notes and feedback are never part of the public views.
-- =============================================================================

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
