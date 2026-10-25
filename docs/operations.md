# M.E.E.T. operations: exports, reminders, bot protection, email

## Weekly export of inquiry and sales records
- **What:** CSV files of artist inquiries, project requests, internal notes, matched artists, follow-ups and project history. Client email and phone are included so a project can be recovered and continued.
- **When:** every Monday at 05:00 UTC (Netlify scheduled function `sales-export`). Founders can also send one at any time: console › Sales › Reports › "Email the export now" (`/api/run-job`, founders only).
- **Where it goes:** an email with the CSV files attached, to every active founder (team role "founder"), sent through Resend. The copies stay in the founders' Gmail, outside Supabase.
- **Access:** no public address serves the files; `/api/run-job` refuses anyone who is not a signed-in founder with a confirmed sign-in code. The scheduled function has no address at all.
- **Failure handling:** if no founder receives the email, the run fails and Netlify logs "Sales export FAILED". If one founder fails and another succeeds, the failure is logged per address. Check: Netlify › Logs › Functions › `sales-export` after each Monday 05:00 UTC.
- **Recovery:** open the latest export email; the CSV files open in Google Sheets or Excel. `projects.csv` holds every project field (status, assignment, client, values, payment status); the other files link to it by the project reference (PRJ-0001).
- **Limits:** this is a copy of these records only, not a full database backup. It does not restore logins, artists, artworks or photographs. Weekly applications, artists and members exports remain manual from the console.
- **Privacy:** the email contains clients' contact details, internal notes and revenue figures. Do not forward it; delete old exports according to the retention rules once legally reviewed.

## Follow-up reminders
- **When:** every day at 06:00 UTC (Netlify scheduled function `followup-reminders`). Founders can run it now: console › Sales › Follow-ups › "Send due reminders now".
- **What:** each person receives one email listing their follow-ups due today or overdue; each follow-up is included at most once a day.
- **Evidence it runs:** Netlify › Logs › Functions › `followup-reminders` shows "Follow-up reminders sent" or "nothing due" for each run.
- Scheduled functions run only on the published (production) site.

## Bot protection (Cloudflare Turnstile, free)
The website is ready; it stays off until both keys are in place.
1. In Cloudflare (free account): Turnstile › Add widget. Domain `meetstudio.art`, mode **Managed**. Copy the **site key** and the **secret key**.
2. Give the **site key** to Claude to put in `site/assets/js/config.js` (`turnstileSiteKey`). It is public by design. Deploy (with approval).
3. In Supabase › Authentication › Attack Protection: enable CAPTCHA protection, provider **Turnstile**, paste the **secret key**. Save.
4. Test sign-in, sign-up, password reset and "send the confirmation email again".
Order matters: if step 3 happens before step 2 is live, sign-in stops working for everyone until the site key is deployed. To switch off: clear the CAPTCHA setting in Supabase first, then empty the site key.

## Email deliverability (checked 24 October 2026)
- SPF, DKIM (meetstudio.art) and DMARC all pass on delivered mail.
- `meetstudio.art` has **no MX record**: hello@meetstudio.art cannot receive email, so replies to sign-up and password emails bounce. Fix: free forwarding (for example ImprovMX or Forward Email) with MX records added in Netlify › Domains › meetstudio.art › DNS records. Needs approval (new third-party service).
- Supabase sender name is "M.E.E.T"; the website's own emails say "M.E.E.T.". Set Supabase › Authentication › Emails › SMTP Settings › Sender name to `M.E.E.T.`.
- DMARC policy is `p=none` with no report address; tighten to `p=quarantine` after a few weeks of clean sending, once a mailbox exists for reports.

## Requests: commissions, collaborations, projects (update 012)
- **Where they arrive:** console › Requests › Commissions, Collaborations, Projects. One shared record per request (client, artists, history, follow-ups, figures); each kind has its own dashboard. The sales team is emailed for each new request.
- **Who can change them:** founders, and the sales team member assigned to the request (others read and add notes).
- **Working a request:** set *Next action* (waiting on team / artist / client, what, by when); record each artist under *Artists* (contacted, available, unavailable, declined, recommended, alternative, their price and timing); prepare a *Proposal* (drafts stay internal), then *Send to the client*. The client accepts, asks for changes, or declines in their account; the responsible person is emailed. Accepting confirms the request.
- **What the client sees:** a simple status (Received, Under review, Contacting artists, Preparing your proposal, Proposal ready, In discussion, Confirmed, Closed), sent proposals, and *Updates shared with the client*. Never internal notes, drafts, artists' prices or figures.
- **Files:** project briefs may carry up to five files (PDF, JPG, PNG, WebP, 10 MB) in the private `request-files` store; only the member and the sales team can open them.
- **Messaging:** direct messages between clients and artists are not built. Updates are one way, from the team; clients reply by email.

## Public website (console › Public website)
- **Homepage:** edit words and images, show or hide sections, drag to reorder. *Save draft* keeps the live homepage unchanged; *Save and preview* opens `/?preview=draft` (team only); *Publish* makes it live and keeps a copy of each published version (`site_page_versions`). *Discard draft* returns to the published version. Images go to the public `site-media` store; every image needs a description.
- **Featured artists and artworks:** only approved, public items can be made eligible. Pinned items always show first; the others rotate daily when rotation is on for that section. Sections with nothing eligible are hidden.
- **Directory order:** drag artists into the order they first appear on the Artists page; unplaced artists follow by name.
