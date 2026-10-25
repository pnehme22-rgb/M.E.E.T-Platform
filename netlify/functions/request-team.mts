// Requests dashboards: what the team shares with a client. Sending a proposal
// and posting an update both go through the database (who may do it, what a
// proposal must contain), then the client is emailed with a link to their
// account, where the proposal can be accepted, refined or declined.

import { handle, teamCaller, readJson, json, HttpError, dbError, audit, siteUrl, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const KIND: Record<string, string> = { commission: "commission request", collaboration: "collaboration request", project: "project request" };

export default handle(async (req) => {
  const c = await teamCaller(req, { sales: true });
  const b = await readJson(req);
  const action = String(b.action || "");
  const id = String(b.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Unknown request.");

  if (action === "send_proposal") {
    const { data, error } = await c.db.rpc("send_proposal", { p_id: id });
    if (error) dbError(error);
    await audit(c, "proposal.sent", "project", data.project_id, { version: data.version });
    const { data: m } = await c.svc.from("member_accounts").select("email, full_name").eq("id", data.member_id).maybeSingle();
    let emailed = false;
    if (m) {
      try {
        await sendMail(m.email, `Your proposal from M.E.E.T. is ready (${data.reference})`, renderMail({
          preheader: "Your proposal is ready to review in your account.",
          paragraphs: [
            `Dear ${esc(firstName(m.full_name))},`,
            `The M.E.E.T. team has prepared a proposal for your ${esc(KIND[data.kind] || "request")} <b>${esc(data.reference)}</b>. It sets out the creative direction, the artists and what each would contribute, the estimated budget and the timeline.`,
            "You can accept it, ask us to refine it, or decline it from your account. Nothing goes ahead until you accept.",
          ],
          cta: { label: "Review the proposal", url: `${siteUrl()}/account#/request/${data.project_id}` },
        }));
        emailed = true;
      } catch (err) { console.error(err); }
    }
    return json(200, { ok: true, emailed });
  }

  if (action === "post_update") {
    const body = String(b.body || "").slice(0, 2000);
    const { data, error } = await c.db.rpc("post_project_update", { p_id: id, p_body: body });
    if (error) dbError(error);
    await audit(c, "project.client_update", "project", id, {});
    let emailed = false;
    if (b.notify === true) {
      const { data: m } = await c.svc.from("member_accounts").select("email, full_name").eq("id", data.member_id).maybeSingle();
      if (m) {
        try {
          await sendMail(m.email, `An update on your ${KIND[data.kind] || "request"} (${data.reference})`, renderMail({
            preheader: "The M.E.E.T. team has shared an update on your request.",
            paragraphs: [`Dear ${esc(firstName(m.full_name))},`, `Here is an update on your ${esc(KIND[data.kind] || "request")} <b>${esc(data.reference)}</b>:`],
            quote: body,
            cta: { label: "Open my request", url: `${siteUrl()}/account#/request/${id}` },
          }));
          emailed = true;
        } catch (err) { console.error(err); }
      }
    }
    return json(200, { ok: true, emailed });
  }

  throw new HttpError(400, "Unknown action.");
});

export const config = { path: "/api/request-team" };
