# M.E.E.T. launch readiness (Phase 4, 24 October 2026)

Status words: **Verified** (tested and passed), **Built, not verified** (implemented, test still to run), **Blocked** (needs a decision, credentials or configuration), **Broken** (none open at the time of writing).

## Technical checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Public pages, directory, profiles, artwork pages | Verified | Live pages load real data at desktop and phone widths; no horizontal overflow |
| Only eligible artists and artworks are public | Verified | SQL tests Phase 1 (15/15), Phase 2 (42/42), Phase 3 (53/53); live API probe |
| Private tables closed to visitors | Verified | Live probe: all 16 private tables refuse the public key |
| Public fields only (no email, legal name, links, traditions) | Verified | Live probe of the four public views |
| Artwork prices public only by the artist's choice | Verified | Phase 3 test; live probe returns no unchosen price |
| Unpublished items blocked by direct address | Verified | Phase 4 test; artist and artwork pages show "not available" |
| Visitors limited to the public website's functions | Verified | Update 011 run; Phase 4 test (22/22); live probe: permission denied |
| Artists cannot approve themselves; review rules on edit | Verified | Phase 4 test (22/22); Phase 2 test |
| Role limits (viewer, sales, member) | Verified | Phase 3 test (53/53, rerun after update 011); Phase 4 test (22/22) |
| Secrets not in the website code | Verified | Code scan: only the public key in the browser; server keys in Netlify settings |
| Server functions refuse unsigned requests | Verified | Live: every private function answers 401 without a sign-in; health check founders only |
| Member sign-up, confirmation, sign-in, password reset | Built, not verified | Needs a real email test (sign-ups were switched off at last check) |
| Artist inquiry and reply, with emails | Built, not verified | Needs a real email test with test accounts |
| Project request, sales pipeline, client emails | Built, not verified | Needs a real email test with test accounts |
| Follow-up reminder emails (daily 06:00 UTC) | Built, not verified | Netlify scheduled function; check Netlify › Logs › Functions › followup-reminders |
| Backups | Partly in place | Weekly CSV export of applications, artists and members (manual). Inquiries and sales records have no export yet |

## Operational actions
1. Turn on Supabase sign-ups (Authentication › Sign In / Providers › User Signups) when members should be able to register.
2. Run the real-email journeys in the Phase 4 report with test addresses you control.
3. Change the Google Sheet shared secret: it was stored in the private repository until 24 October 2026. Set a new value in the Supabase webhook and in the Apps Script (`DEFAULT_SECRET` or the `SECRET` property), then redeploy the script.
4. Keep the weekly CSV export; consider Supabase's paid plan for automatic daily backups before wider launch.

## Legal and business decisions (not legally approved)
- **Artist terms** (version 2026-10-24): qualified review of the worldwide, free, non-exclusive promotional permission; the statement about AI training; the 30-day removal period; the printed-materials exception; the no-guarantee-of-sales wording. The terms do not yet mention public prices.
- **Member Terms of Use:** not written. Personal, Professional and Business & Organization accounts currently agree only to the privacy notice at sign-up; no terms version is recorded. Terms, an acceptance step and version recording are needed before wider launch.
- **Privacy notice:** describes member accounts, inquiries and project requests; needs the same legal review.
- **Deleted member accounts:** sales records keep the organization, country and figures under "Deleted member". Confirm this retention.
- **Cultural traditions:** stored privately, not public and not used for matching, until the Artist terms cover them, are reviewed, and artists agree again.
- **Sales staff and revenue:** sales team members can read the recorded figures on every project, not only their own. Confirm or restrict.
