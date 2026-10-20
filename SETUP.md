# Putting M.E.E.T. online

What lives where:

| Piece | Service | Public? |
| --- | --- | --- |
| Homepage, registration form, privacy notice | Netlify (`site/`) | Yes |
| Sign-in, team console (`/team`), artist studio (`/studio`) | Netlify pages + Supabase logins | Only to signed-in people |
| Platform prototype (`/prototype`) | Netlify, behind an edge-function check | Team only (password + emailed code) |
| Applications, artists, artworks, team, activity log | Supabase database (EU) | Never |
| Artist photographs | Supabase storage, private bucket | Never |
| Welcome and review emails | Netlify functions → Gmail | Sent to the artist |
| Working copy of applications | Google Sheet (Apps Script) | Team only |

Do the steps in this order. Each one ends with a check.

---

## 1. Gmail app password (5 minutes)

The site sends emails from minds.exploring.traditions@gmail.com. Gmail needs an "app password" for that.

1. Sign in to Google as **minds.exploring.traditions@gmail.com**.
2. Open https://myaccount.google.com/security and turn on **2-Step Verification** if it is off.
3. Open https://myaccount.google.com/apppasswords, name it `M.E.E.T. website`, press **Create**.
4. Copy the 16-letter code into your password manager. You will paste it into Netlify and Supabase. Do not send it to anyone.

Check: you have a 16-letter code saved.

## 2. Supabase project (15 minutes)

1. Go to https://supabase.com, sign up, **New project**.
   - Name: `meet`
   - Region: **Central EU (Frankfurt)**
   - Database password: generate one and save it in your password manager.
2. **SQL Editor › New query**: paste the whole of `supabase/schema.sql`, press **Run**. It should say *Success. No rows returned.*
3. **Authentication › Sign In / Providers › Email**
   - Keep Email enabled.
   - Turn **off** "Allow new users to sign up". Accounts are created only by approvals and invitations.
   - Set **Email OTP Expiration** to `86400` (24 hours, which is what the welcome email promises).
4. **Authentication › Emails › SMTP Settings**: turn on custom SMTP.
   - Sender email: `minds.exploring.traditions@gmail.com`, sender name: `M.E.E.T.`
   - Host `smtp.gmail.com`, port `465`, username `minds.exploring.traditions@gmail.com`, password: the app password from step 1.
5. **Authentication › Emails › Templates › Reset password**
   - Subject: `Choose a new M.E.E.T. password`
   - Body: paste `supabase/email-reset-password.html`.
7. **Project Settings › API**: note the **Project URL** and the **anon / publishable key**. Send these two to Claude; they are safe to share and go into `site/assets/js/config.js`. Keep the **service_role / secret key** private: you paste it only into Netlify in step 4.

Check: Table Editor shows `applications`, `artists`, `artworks`, `team_members`, `audit_log`.

## 3. GitHub (5 minutes)

1. On https://github.com create a **private** repository named `meet-platform`, with no README.
2. Claude creates a deploy key on this Mac and shows you the public half. In the repository, go to **Settings › Deploy keys › Add deploy key**, paste it, and tick **Allow write access**.
3. Claude pushes the code.

Check: the repository shows the `site`, `netlify` and `supabase` folders.

## 4. Netlify (10 minutes)

1. https://app.netlify.com › **Add new site › Import an existing project › GitHub** › choose `meet-platform`. The settings come from `netlify.toml`, so leave them as they are.
2. **Site configuration › Environment variables**: add these, then redeploy.

   | Key | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project URL from step 2 |
   | `SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (secret) |
   | `GMAIL_USER` | `minds.exploring.traditions@gmail.com` |
   | `GMAIL_APP_PASSWORD` | the 16-letter code (secret) |
   | `SITE_URL` | your site address, for example `https://meetstudio.art` |

3. Back in Supabase, **Authentication › URL Configuration**:
   - Site URL: your Netlify address.
   - Redirect URLs: add `https://YOUR-SITE/welcome`.

Check: the homepage opens at your Netlify address, and `/prototype/` sends you to the sign-in page.

## 5. Your founder login (3 minutes)

1. Supabase › **Authentication › Users › Add user › Create new user**: your email, a strong password, tick **Auto Confirm User**.
2. **SQL Editor**, run (with your email):

   ```sql
   insert into team_members (user_id, name, email, role)
   select id, 'Pia Maria Nehme', email, 'founder' from auth.users where email = 'YOUR-LOGIN-EMAIL';
   ```
3. Open `https://meetstudio.art/signin`, sign in, and enter the 6-digit code that arrives by email.

Check: you land on the team console, and **Platform prototype** opens the prototype.

## 6. Google Sheet copy (10 minutes)

1. As minds.exploring.traditions@gmail.com, create a Google Sheet called `M.E.E.T. applications`. Share it only with your team.
2. **Extensions › Apps Script**: replace everything with `google/sheet-sync.gs`, then save.
3. **Project Settings › Script properties › Add**: `SECRET` = a long random value (Claude can generate one).
4. **Deploy › New deployment › Web app**: Execute as **Me**, Who has access **Anyone**. Authorise, and copy the Web app URL.
5. Supabase › SQL Editor:

   ```sql
   insert into app_config (key, value) values
     ('sheet_webhook_url', 'PASTE-THE-WEB-APP-URL'),
     ('sheet_webhook_secret', 'THE-SAME-SECRET')
   on conflict (key) do update set value = excluded.value;
   ```

Check: send a test registration. A row appears in the Sheet within a few seconds.

## 7. Close the old public link

The prototype on claude.ai is currently shared with anyone who has the link. Now that a private copy lives behind the team login, open the artifact's sharing settings and switch link sharing off.

---

## Things to know

- **Supabase's free plan pauses a project after 7 days without any activity.** A paused project means the form cannot save. Registrations and console use count as activity, but if the site may sit quiet for a week, either open the console now and then or move to the Pro plan ($25 a month).
- **Gmail limit:** about 500 emails a day, far above what M.E.E.T. needs.
- **Backups:** Supabase's free plan has no automatic backups you can restore yourself. Export CSV from the console regularly; the Google Sheet is also a working copy.
- **Changing the welcome email:** edit `netlify/functions/approve-application.mts` and the preview in `site/assets/js/app/team.js` (`welcomePreview`) so they match.
