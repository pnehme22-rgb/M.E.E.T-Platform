# M.E.E.T. platform

Public artist registration, the private team console, and the artist studio.

- `site/`: everything Netlify publishes. Public pages: `/`, `/join`, `/privacy`, `/artist-terms`, `/artists`, `/artists/{id}`, `/artworks/{id}`, `/signup`. Private: `/signin`, `/welcome`, `/reset`, `/account`, `/team`, `/studio`, `/prototype`.
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

## Members and discovery (Phase 2)

- `/signup`: Personal, Professional, or Business & Organization accounts. Supabase creates the login and emails a confirmation link; the trigger `handle_new_member()` creates the `member_accounts` row from the sign-up details and the database checks the required fields for each type. No team approval is needed.
- `/account`: members edit their own details (row level security: own row only, and only the editable columns), change their password, sign out everywhere, and request deletion (`/api/account-deletion`). The account type and email cannot be changed by members. Enquiries and project requests show "coming later" until Phase 3.
- `/artists`: the public directory with combined Country, Artistic discipline, and Materials & techniques filters, built from `public_artists` and `public_artworks`. `/artists/{id}` and `/artworks/{id}` are the public profile and artwork pages (Netlify rewrites to `artist.html` and `artwork.html`). No contact details, links or prices are shown, and nothing can be bought.
- Homepage selection: the team picks public artists and artworks in Console › Homepage (`feature_item`, `unfeature_item`, `move_featured`). Visitors read `public_featured_artists` and `public_featured_artworks`, which only ever contain public items.
- Console › Members lists member accounts by type, shows deletion requests, and lets founders delete a member (`/api/delete-record`, type `member`).
- Artists can add optional cultural traditions; editing them sends an approved profile back to review like any other change.

The test `supabase/tests/phase2_accounts_test.sql` checks sign-ups, permissions, the account type lock, traditions and the homepage rules inside a cancelled transaction.

## Inquiries and sales (Phase 3)

- **Artist inquiries:** signed-in members write to a public artist from their profile (`/api/inquiry`, database function `create_inquiry`). The artist sees the member's name, account type and country, never their email or phone, and replies once from their studio; the reply is emailed to the member. Statuses: New, Viewed, Responded, Closed. The console tracks every inquiry (Artist inquiries).
- **Project requests:** Professional and Business & Organization members send requests from their account (`/api/project-request`). They see their own requests through `my_project_requests()` with a simple status (Received, In discussion, Confirmed, Closed); the sales tables are readable by founders and the `sales` role only.
- **Sales dashboard** (console › Sales): pipeline New → Contacted → Proposal Sent → Negotiation → Project Confirmed / Not Confirmed (reason required, reopening recorded); assignment; artist matching from public profiles only (disciplines, techniques, artwork materials, country; never cultural traditions); internal notes; follow-ups; value and revenue recorded by hand; country reports for founders.
- **Permissions:** founders manage everything; `sales` members see all projects and manage those assigned to them (they can take an unassigned one). The `sales` role cannot change applications, artists or members. All writes go through database functions that check this.
- **Follow-up reminders:** `followup-reminders` is a Netlify scheduled function (daily at 06:00 UTC). Check it in Netlify › Logs › Functions.
- **Prices:** an artwork's price is public only when the artist chooses "Show this price"; otherwise the public view returns no number. Existing artworks start with the price not shown.

The test `supabase/tests/phase3_sales_test.sql` checks prices, inquiries, project requests and sales permissions inside a cancelled transaction.
