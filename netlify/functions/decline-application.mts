// Declines an application. The reason stays private to the team; the artist
// optionally receives a kind message (written or edited by the team).

import { handle, teamCaller, readJson, json, HttpError, renderMail, sendMail, esc } from "../lib/server.ts";

export default handle(async (req) => {
  const c = await teamCaller(req, { editor: true });
  const { id, reason, notify, message } = await readJson(req);
  if (typeof id !== "string") throw new HttpError(400, "Missing application.");
  const text = String(message || "").trim().slice(0, 4000);
  if (notify && text.length < 20) throw new HttpError(400, "Please write the message to the artist, or untick the email box.");

  const { error } = await c.db.rpc("set_application_status", { p_id: id, p_status: "declined", p_note: String(reason || "").slice(0, 4000) });
  if (error) throw new HttpError(400, error.message);

  if (notify) {
    const { data: app } = await c.svc.from("applications").select("email").eq("id", id).single();
    // Each blank-line-separated block of the team's text becomes a paragraph.
    const paragraphs = text.split(/\n\s*\n/).map((p) => esc(p.trim()).replace(/\n/g, "<br>")).filter(Boolean);
    const mail = renderMail({ preheader: "An update about your M.E.E.T. application.", paragraphs });
    await sendMail(app!.email, "About your M.E.E.T. application", mail);
  }
  return json(200, { ok: true });
});

export const config = { path: "/api/decline-application" };
