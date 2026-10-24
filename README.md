# M.E.E.T. platform

Public artist registration, the private team console, and the artist studio.

- `site/`: everything Netlify publishes. Public pages: `/`, `/join`, `/privacy`. Private: `/signin`, `/welcome`, `/reset`, `/team`, `/studio`, `/prototype`.
- `netlify/functions/`: approvals, invitations and emails (holds the secrets).
- `netlify/edge-functions/prototype-gate.ts`: lets only signed-in team members open `/prototype`.
- `supabase/schema.sql`: database tables, security rules and functions.
- `google/sheet-sync.gs`: keeps a Google Sheet copy of applications.
- `tools/`: rebuilds the country and city list (`python3 tools/build_places.py`).

Setup steps are in [SETUP.md](SETUP.md).

To preview pages on this Mac: `cd site && python3 -m http.server 8090`, then open http://127.0.0.1:8090. Saving, sign-in and emails only work once Supabase and Netlify are set up.

## Public data (Phase 1)

Approved content is readable by anyone through two read-only views. Nothing else is public.

| View | Contains | Rule |
| --- | --- | --- |
| `public_artists` | artist name, city, country, disciplines, techniques, bio, picture paths | account approved, profile approved, current Artist terms agreed |
| `public_artworks` | title, year, materials, size, edition, price, description, photo paths | artwork approved and its artist is public |

Read them with the public key, for example `GET {SUPABASE_URL}/rest/v1/public_artists?select=*`.
Photos of public items can be fetched with a signed URL from the `artist-media` bucket; all other photos stay private.
Legal names, emails, social links, websites, feedback and review notes are never in these views.
The test `supabase/tests/phase1_publishing_test.sql` checks these rules inside a cancelled transaction.
