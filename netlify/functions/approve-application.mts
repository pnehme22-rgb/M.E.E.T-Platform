// Approves an application: creates the artist's private studio and login,
// then emails the welcome message with a one-time link to set a password.
// Running it again on an approved application sends a fresh link.

import { handle, teamCaller, readJson, json, HttpError, accountLink, audit, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

export default handle(async (req) => {
  const c = await teamCaller(req, { editor: true });
  const { id } = await readJson(req);
  if (typeof id !== "string") throw new HttpError(400, "Missing application.");

  const { data: app, error } = await c.svc.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!app) throw new HttpError(404, "This application could not be found.");
  const again = app.status === "approved";

  const { user, url } = await accountLink(c.svc, app.email, { full_name: app.full_name });

  // The studio starts from what the artist told us in their application.
  const { data: existing } = await c.svc.from("artists").select("id").eq("id", user.id).maybeSingle();
  if (!existing) {
    const { error: e2 } = await c.svc.from("artists").insert({
      id: user.id,
      application_id: app.id,
      email: app.email,
      legal_name: app.full_name,
      display_name: app.artist_name,
      country: app.country,
      city: app.city,
      craft: app.primary_discipline === "Other" && app.discipline_other ? app.discipline_other : app.primary_discipline,
      other_disciplines: app.additional_disciplines,
      techniques: app.techniques || "",
      bio: (app.practice || "").slice(0, 1500),
      instagram: app.social,
      website: app.website,
    });
    if (e2) throw e2;
  }

  const now = new Date().toISOString();
  const { error: e3 } = await c.svc.from("applications").update({
    status: "approved",
    decided_by: again ? app.decided_by : c.user.id,
    decided_at: again ? app.decided_at : now,
    artist_id: user.id,
    invited_at: now,
  }).eq("id", app.id);
  if (e3) throw e3;
  await audit(c, again ? "application.reinvited" : "application.approved", "application", app.id, { email: app.email });

  const mail = renderMail({
    preheader: "Your application has been approved. Open your M.E.E.T. studio.",
    paragraphs: [
      `Dear ${esc(firstName(app.full_name))},`,
      "Thank you for sharing your work with us. We are delighted to tell you that your application to M.E.E.T. has been approved, and we warmly welcome you to the community.",
      "Your next step is to open your studio. Set your password with the button below, then add your profile and a few of your works. The M.E.E.T. team reviews your profile and each artwork before they appear publicly on M.E.E.T.",
    ],
    cta: { label: "Open my studio", url },
    after: ["For your security, this link works for 24 hours. If it expires, simply reply to this email and we will send you a new one."],
  });
  await sendMail(app.email, `Welcome to M.E.E.T., ${app.artist_name}`, mail);

  return json(200, { ok: true, invited_at: now });
});

export const config = { path: "/api/approve-application" };
