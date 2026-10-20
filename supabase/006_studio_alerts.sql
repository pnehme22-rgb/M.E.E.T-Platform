-- =============================================================================
-- M.E.E.T. update 006: email the team when an artist sends their profile or an
-- artwork for review. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.
-- =============================================================================

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
