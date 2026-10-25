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
| Member sign-up, confirmation, sign-in, password reset | Verified | Real test 25 Oct 2026: Professional sign-up with Turnstile, confirmation email (inbox), sign-in, sign-out; password reset email in inbox |
| Artist inquiry and reply, with emails | Verified | Real test 25 Oct 2026: artist, member and team emails; artist reply emailed and shown in the account |
| Project request, sales pipeline, client emails | Verified | Real test 25 Oct 2026 (PRJ-0004): team and client emails, status email "in progress" |
| Follow-up reminder emails (daily 06:00 UTC) | Partly verified | "Send due reminders now" delivered to the assigned team member; schedule registered in Netlify; first scheduled run's log still to be checked |
| Backups | Partly verified | Weekly automatic CSV export of inquiry and sales records to founders (run-now verified; first Monday run to check). Applications, artists, members: manual console exports |

| Bot protection (Cloudflare Turnstile) | Verified | Supabase refuses sign-in, reset and sign-up without a valid check; real sign-in and sign-up pass |
| Google Sheet shared secret | Verified | Rotated 25 Oct 2026; old values refused; only stored in Supabase and the live script's settings |
| Public sign-up | Open | Opened 25 Oct 2026 with email confirmation and bot protection |

## Operational actions
1. Check the logs of the first scheduled runs (followup-reminders daily 06:00 UTC; sales-export Mondays 05:00 UTC).
2. hello@meetstudio.art forwarding (ImprovMX): MX and SPF records published; confirm ImprovMX shows active and a test email arrives.
3. Decide whether to keep or remove the test records (Test Professional, PRJ-0004, two test inquiries).
4. Later: DMARC to p=quarantine with a report address; Google Postmaster Tools; Supabase paid plan for full backups.

## Legal and business decisions (not legally approved)
- **Artist terms** (version 2026-10-24): qualified review of the worldwide, free, non-exclusive promotional permission; the statement about AI training; the 30-day removal period; the printed-materials exception; the no-guarantee-of-sales wording. The terms do not yet mention public prices.
- **Member Terms of Use:** not written. Personal, Professional and Business & Organization accounts currently agree only to the privacy notice at sign-up; no terms version is recorded. Terms, an acceptance step and version recording are needed before wider launch.
- **Privacy notice:** describes member accounts, inquiries and project requests; needs the same legal review.
- **Deleted member accounts:** sales records keep the organization, country and figures under "Deleted member". Confirm this retention.
- **Cultural traditions:** stored privately, not public and not used for matching, until the Artist terms cover them, are reviewed, and artists agree again.
- **Sales staff and revenue:** sales team members can read the recorded figures on every project, not only their own. Confirm or restrict.
