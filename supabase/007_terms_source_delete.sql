-- =============================================================================
-- M.E.E.T. update 007: artist terms, where registrations come from, and
-- removing deleted applications from the Sheet copy.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.
-- =============================================================================

alter table applications add column if not exists source text not null default '';
alter table artists add column if not exists terms_version text not null default '';
alter table artists add column if not exists terms_accepted_at timestamptz;

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
grant execute on function accept_terms(text) to authenticated;

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
