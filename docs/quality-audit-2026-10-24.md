# M.E.E.T. quality audit, 24 October 2026

Reviewed before Phase 3. Rendered pages were checked in a local preview (desktop 1280 px, phone 375 px) using live public files and sample data for signed-in areas.

## Priority 1: the product reads as two different websites
- Public pages use Instrument Serif and Instrument Sans with an ivory, ink and oxblood palette. Sign-in, sign-up, account, studio and console use Cormorant Garamond and Manrope with a bluer navy and a different red. Moving from the homepage to sign-in visibly changes brand.
- Public pages have three different footers (full on the homepage, slim elsewhere, none on 404). The 404 page has no header or way back to the directory.
- **Fix:** one type system and one colour palette for every page; one public footer; the 404 page uses the public header.

## Priority 2: the artist terms agreement
- Shown inside the studio frame with an empty sidebar, as one dense bulleted panel with long lines. The checkbox and button sit at the bottom of a large card with no separation between reading and agreeing.
- The summary does not mention that removal takes up to 30 days and that printed materials cannot be recalled (the full terms do). It names "social links" while the full terms say "social media and website links".
- **Fix:** a dedicated, centred onboarding page: short introduction, six numbered points with plain headings, clear links to the full terms and privacy notice, then a separate agreement step. Same meaning, same version tracking, same server-side acceptance.

## Priority 3: accuracy and trust
- The console says welcome emails come "from minds.exploring.traditions@gmail.com"; they are sent from hello@meetstudio.art (replies go to the Gmail inbox).
- The welcome email and its preview say the team reviews the studio "before it is shown to anyone"; approved items are now public, item by item.
- The password page still carries text about an authenticator app, which M.E.E.T. no longer uses.
- The privacy notice lists the public profile fields without cultural traditions, which are now shown when an artist adds them. The studio field does not say it is public.
- Sign-up showed Supabase's raw message "Signups not allowed for this instance".

## Priority 4: copy and wording
- Sign-in: eyebrow "Members" excludes artists and the team; closing line is long and uses a semicolon construction that is hard for non-native readers.
- Welcome page repeats "Welcome to M.E.E.T." as eyebrow and title.
- 404: "This page has wandered off" is casual for an institution.
- Homepage footer column titled "M.E.E.T." directly under the M.E.E.T. logo.
- Artists directory count read "1 artist match" (fixed in Phase 2 testing).

## Checked, no change needed
- Public pages never show contact details, links or prices; nothing implies checkout, payment or messaging. Enquiries and project requests are labelled as a later stage.
- Statuses: the studio uses gentler words ("Not accepted") than the console ("Declined"); kept deliberately for the two audiences.
- Keyboard: all controls are native buttons, links, inputs and selects with visible focus rings; the phone menu closes with Escape.

## Needs a decision or legal review (not changed)
- Artist terms and privacy notice: qualified legal review before wider launch. Wording that needs it: the worldwide, free, non-exclusive promotional permission; "never ... train AI"; 30-day removal; the printed-materials exception; "does not guarantee sales".
- The Artist terms list the public profile fields but not cultural traditions. Adding them changes the agreement text, which should go with the next terms version (artists agree again).
- Member accounts have no Terms of Use.
- Asking prices are readable through the public data view, though no page shows them.

## Changes made in this pass
- Sign-in, sign-up, password, member account, studio and console now use the public type system (Instrument Serif and Instrument Sans) and the public palette. Counts use the sans so "1" cannot be read as "l".
- One public footer (Explore, Information) on the homepage, directory, profiles, artwork pages, privacy notice, Artist terms and 404. The artist application form keeps its slim footer so the form stays focused.
- New 404 page with the public header, a plain explanation and routes to the homepage and the directory.
- Artist terms agreement rebuilt as a centred onboarding page: seven numbered points in plain language, links to the full terms and privacy notice, a separate agreement step that names the terms version and says the agreement is recorded. Same `accept_terms` call, same version check.
- The full Artist terms page ends with a note for approved artists instead of a "Back to my studio" button shown to every visitor.
- Accuracy: console approval text names hello@meetstudio.art; welcome email and preview say profile and artworks are reviewed before they appear publicly; authenticator-app text and code removed from the password page; privacy notice covers members and cultural traditions, retitled "How we look after your information"; studio traditions field says it is public once approved; sign-up shows a plain message if new accounts are paused.
- Copy: sign-in, welcome page eyebrow, 404, privacy headings, "yesterday" instead of "1 days ago".
- Layout: the footer email wraps on phones; directory filters stay on one row on tablets.
