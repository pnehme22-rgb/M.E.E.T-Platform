// Marks an application as "more information requested" and, if chosen,
// emails the team's question to the artist (they reply to the Gmail inbox).

import { handle, teamCaller, readJson, json, HttpError, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

export default handle(async (req) => {
  const c = await teamCaller(req, { editor: true });
  const { id, question, notify } = await readJson(req);
  if (typeof id !== "string") throw new HttpError(400, "Missing application.");
  const q = String(question || "").trim().slice(0, 4000);
  if (q.length < 5) throw new HttpError(400, "Please write the question first.");

  // Runs as the team member, so the database checks their rights and logs it.
  const { error } = await c.db.rpc("set_application_status", { p_id: id, p_status: "more_info", p_note: q });
  if (error) throw new HttpError(400, error.message);

  if (notify) {
    const { data: app } = await c.svc.from("applications").select("email, full_name").eq("id", id).single();
    const mail = renderMail({
      preheader: "A short question about your M.E.E.T. application.",
      paragraphs: [
        `Dear ${esc(firstName(app!.full_name))},`,
        "Thank you for applying to M.E.E.T. We have enjoyed reading about your practice. Before we decide, we would like to know a little more:",
      ],
      quote: q,
      after: ["Simply reply to this email with your answer. There is no need to fill in the form again."],
    });
    await sendMail(app!.email, "A question about your M.E.E.T. application", mail);
  }
  return json(200, { ok: true });
});

export const config = { path: "/api/request-info" };
