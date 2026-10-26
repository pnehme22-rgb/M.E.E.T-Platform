-- =============================================================================
-- M.E.E.T. update 014: the team answers artists' Support messages from the
-- console. The reply is stored with the message (the artist reads it in their
-- studio and receives it by email), and the message is marked as answered.
-- The internal team note stays separate and is never shown to the artist.
-- Nothing is deleted. Safe to run more than once.
-- Paste into Supabase > SQL Editor > New query > Run.
-- =============================================================================

alter table artist_requests add column if not exists reply text not null default '' check (char_length(reply) <= 4000);
alter table artist_requests add column if not exists replied_at timestamptz;
alter table artist_requests add column if not exists replied_by uuid references team_members(user_id) on delete set null;

create or replace function answer_artist_request(p_id uuid, p_reply text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r artist_requests; v text := clean_block(p_reply);
begin
  if not is_team_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v) < 5 then raise exception 'Please write your reply to the artist.' using errcode = '22023'; end if;
  if char_length(v) > 4000 then raise exception 'Please keep the reply under 4,000 characters.' using errcode = '22023'; end if;
  update artist_requests set reply = v, replied_at = now(), replied_by = auth.uid(), status = 'closed', closed_at = now(), handled_by = auth.uid(),
    team_note = case when coalesce(btrim(p_note), '') = '' then team_note else left(clean_block(p_note), 2000) end
  where id = p_id
  returning * into r;
  if not found then raise exception 'This message no longer exists.' using errcode = 'P0002'; end if;
  perform write_audit('artist_request.answered', 'artist_request', p_id::text, '{}');
  return jsonb_build_object('artist_id', r.artist_id, 'topic', r.topic, 'message', r.message);
end $$;

revoke execute on function answer_artist_request(uuid, text, text) from public, anon;
grant execute on function answer_artist_request(uuid, text, text) to authenticated;

-- Artists may read their own messages and the team's replies, but never the
-- internal team note: read access by column. The team reads everything through
-- team_artist_requests().
revoke select on artist_requests from authenticated;
grant select (id, artist_id, topic, message, status, reply, replied_at, created_at, closed_at) on artist_requests to authenticated;

create or replace function team_artist_requests()
returns setof artist_requests
language sql stable security definer set search_path = public as $$
  select * from artist_requests where is_team() order by created_at desc limit 2000
$$;
revoke execute on function team_artist_requests() from public, anon;
grant execute on function team_artist_requests() to authenticated;
