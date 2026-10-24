// Sales dashboard: change a project's pipeline status. The database function
// set_project_status checks who may change it and requires a reason for
// "Not confirmed". When the status the client sees changes, the client can be
// told by email (the team member decides, per change).

import { handle, teamCaller, readJson, json, HttpError, dbError, audit, siteUrl, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const CLIENT_MAIL: Record<string, { subject: string; text: string }> = {
  in_discussion: { subject: "Your project request is in progress", text: "The M.E.E.T. team is now working on your project request. We will be in touch by email with next steps." },
  confirmed: { subject: "Your project is confirmed", text: "We are pleased to confirm your project with M.E.E.T. The team will keep you informed by email about the next steps." },
  closed: { subject: "Your project request is closed", text: "Your project request is now closed. Thank you for thinking of M.E.E.T. If your plans change, you are welcome to send a new request from your account." },
};

export default handle(async (req) => {
  const c = await teamCaller(req, { sales: true });
  const b = await readJson(req);
  const id = String(b.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Unknown project.");
  const { data, error } = await c.db.rpc("set_project_status", {
    p_id: id, p_status: String(b.status || ""), p_reason: b.reason ? String(b.reason) : null, p_note: String(b.note || "").slice(0, 2000),
  });
  if (error) dbError(error);
  if (!data || !data.changed) return json(200, { ok: true, changed: false });
  await audit(c, "project.status", "project", id, { from: data.from, to: data.to });

  let emailed = false;
  const msg = CLIENT_MAIL[data.client_to];
  if (b.notify === true && msg && data.client_to !== data.client_from && data.member_id) {
    const { data: m } = await c.svc.from("member_accounts").select("email, full_name").eq("id", data.member_id).maybeSingle();
    if (m) {
      await sendMail(m.email, `${msg.subject} (${data.reference})`, renderMail({
        preheader: msg.text,
        paragraphs: [`Dear ${esc(firstName(m.full_name))},`, `${esc(msg.text)} Your reference is <b>${esc(data.reference)}</b>.`],
        cta: { label: "View my project requests", url: `${siteUrl()}/account#/projects` },
      }));
      emailed = true;
    }
  }
  return json(200, { ok: true, changed: true, emailed });
});

export const config = { path: "/api/sales-status" };
