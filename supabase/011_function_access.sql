-- =============================================================================
-- M.E.E.T. update 011 (Phase 4): visitors may call only the two database
-- functions the public website needs. Every other function already refused
-- visitors on its own; this removes the access itself as a second safeguard.
-- Nothing is deleted or changed in the data. Safe to run more than once.
-- Paste into Supabase > SQL Editor > New query > Run.
-- =============================================================================

revoke execute on all functions in schema public from anon, public;

-- The public website: sending an artist application, and reading the
-- photographs of public artists and artworks (storage rule media_public_read).
grant execute on function submit_application(jsonb), is_public_media(text) to anon;

-- Functions created later are not callable by visitors unless granted.
alter default privileges in schema public revoke execute on functions from anon, public;
