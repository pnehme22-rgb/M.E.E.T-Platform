# Legal pages prepared for approval (26 October 2026)

Review copies, in the website's own page format: `docs/legal/publish/`

- `privacy.html`: revised Privacy Notice. **Published 26 October 2026** (approved by the founder for now, pending legal review).
- `artist-terms.html`: revised Artist Terms, version 2026-10-26 (replaces `site/artist-terms.html`)
- `terms.html`: Member Terms, published for information (new page at `/terms`)

None of these is legally reviewed or approved. They describe how the website works today; legal particulars that depend on company registration or a lawyer are left out and listed below. Nothing here is published until the founder approves it.

## What publishing involves (technical, done by Claude on approval)

1. Copy the three files into `site/`.
2. Add "Member terms" to the footer (`tools/site_chrome.py`) and the security header for `/terms` in `netlify.toml`.
3. Artist Terms: the new version only applies once artists agree to it. Publishing means changing the studio's terms version (`TERMS_VERSION` in `site/assets/js/app/studio.js`, and its summary points) and `app_config.terms_version_current` in the database. **Effect: every public artist (today, Pia Maria) disappears from the public website until they open their studio and agree to the new version.** Agree straight after publishing to keep the gap short.
4. Deploy (one Netlify deploy).

## Privacy Notice: questions for the lawyer

1. The company responsible for the information (controller) and its registered details: added after registration.
2. Lawful basis for each use: the notice states facts (consent in the application form; consent box at member sign-up; information used to provide the services asked for). Which legal bases apply under the law that will govern M.E.E.T. (Lebanon Law 81/2018, UAE, and the EU GDPR if members in the EU are targeted) needs advice.
3. Retention periods: not fixed. The notice says they are being defined. Decide periods for member accounts, request and project records, team mailbox copies, weekly exports, deletion records, backups held by providers.
4. Deleted accounts: request records keep organization, country and description with the name removed. Confirm this is acceptable, or decide what else to remove.
5. International transfers: providers in the EU (Supabase) and elsewhere (Netlify, Cloudflare, Resend, ImprovMX, Google). Whether transfer wording or agreements are required.
6. "We will reply within 30 days" (kept from the current notice): confirm the deadline the applicable law requires.
7. Sharing request details with the artists the team contacts: confirm the wording, and whether the client's contact details may be shared without asking first (today the notice does not say they are shared).
8. Providers are described by type, not by name (founder decision, 26 October 2026). Confirm this meets the applicable law's requirement to identify recipients or categories of recipients. The providers behind each type: database, sign-in and storage: Supabase (EU); hosting: Netlify; security check: Cloudflare Turnstile; email delivery: Resend; email forwarding: ImprovMX; inbox and spreadsheet: Google (Gmail, Google Sheets).

## Artist Terms: questions for the lawyer

1. The confidentiality duty on artists for members' inquiry details (new section): scope, duration, and consequences of a breach.
2. "Price shown is information, not an offer": confirm it is effective under the applicable consumer and commercial rules.
3. Earlier open points remain: the worldwide, free, non-exclusive promotional permission; the AI training statement; the 30-day removal period; printed materials that cannot be recalled; the no-guarantee wording.
4. Cultural traditions: stays hidden and is not mentioned in the terms (founder decision).

## Member Terms: what is left out until registration or legal approval

- Company legal name, legal form, registered address and registration details.
- Governing law, courts and dispute procedure.
- Liability limit and the list of liability that cannot be excluded; the indemnity for business use (drafted in revision 3, not published).
- Minimum age (undecided).
- Retention periods.
- A dedicated legal-notice and intellectual-property complaints address (the general contact address is used meanwhile).
- Acceptance: the terms are published for information. The sign-up acceptance step and recording of the accepted version are deferred until the terms are legally approved (founder decision).

The fuller legal draft with these clauses is `docs/legal/member-terms-revision-3.html`.
