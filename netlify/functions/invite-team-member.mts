// Founders only: invites a new team member with a role. They set a password
// from the email, then confirm each sign-in with an emailed code.

import { handle, teamCaller, readJson, json, HttpError, accountLink, audit, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const ROLES = ["operations", "verification", "partnerships", "viewer"];

export default handle(async (req) => {
  const c = await teamCaller(req, { founder: true });
  const body = await readJson(req);
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) throw new HttpError(400, "Please enter a name and a complete email address.");
  if (!ROLES.includes(role)) throw new HttpError(400, "Please choose a role.");

  const { user, url } = await accountLink(c.svc, email, { full_name: name });

  const { error } = await c.svc.from("team_members").upsert({ user_id: user.id, name, email, role, active: true }, { onConflict: "user_id" });
  if (error) throw error;
  await audit(c, "team.invite", "team_member", user.id, { email, role });

  const mail = renderMail({
    preheader: `${c.member.name} has invited you to the M.E.E.T. team console.`,
    paragraphs: [
      `Dear ${esc(firstName(name))},`,
      `${esc(c.member.name)} has invited you to join the M.E.E.T. team console, where we review artists who want to join the community.`,
      "Set your password with the button below. Each time you sign in, we will also email you a 6-digit code to confirm it is you, because the console holds artists' personal details.",
    ],
    cta: { label: "Set my password", url },
    after: ["For your security, this link works for 24 hours."],
  });
  await sendMail(email, "You are invited to the M.E.E.T. team", mail);
  return json(200, { ok: true });
});

export const config = { path: "/api/invite-team-member" };
