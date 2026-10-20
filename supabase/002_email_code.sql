-- =============================================================================
-- M.E.E.T. update 002: team sign-in uses an emailed 6-digit code instead of an
-- authenticator app. Paste into Supabase › SQL Editor › New query › Run.
-- Safe to run more than once.
-- =============================================================================

-- One row per sign-in session of a team member. The code is stored only as a
-- hash. A session counts as "team" once its code has been confirmed.
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

grant execute on function session_confirmed(), is_team(), is_founder() to authenticated;

-- Remove authenticator-app setups made earlier, so password changes work
-- without an app code.
delete from auth.mfa_factors
where user_id in (select user_id from team_members);
