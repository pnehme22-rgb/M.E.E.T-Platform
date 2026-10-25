// A member answers a proposal from their account: accept, ask for changes,
// or decline. The database records the decision (only on their own request,
// only on a proposal still waiting for an answer). The person responsible for
// the request, or the whole sales team if nobody is assigned, is emailed.

import { handle, personCaller, readJson, json, HttpError, dbError, siteUrl, renderMail, sendMail, esc, salesTeamEmails } from "../lib/server.ts";

const DECISION: Record<string, string> = { accepted: "accepted", changes_requested: "asked for changes to", declined: "declined" };

export default handle(async (req) => {
  const p = await personCaller(req);
  const b = await readJson(req);
  const id = String(b.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Unknown proposal.");
  const { data, error } = await p.db.rpc("respond_proposal", {
    p_id: id, p_decision: String(b.decision || ""), p_message: String(b.message || "").slice(0, 2000),
  });
  if (error) dbError(error);

  const { data: r } = await p.svc.from("project_requests").select("client_name, client_organization").eq("id", data.project_id).single();
  const who = r.client_organization ? `${r.client_organization} (${r.client_name})` : r.client_name;
  let to: string[] = [];
  if (data.assigned_to) {
    const { data: t } = await p.svc.from("team_members").select("email, active").eq("user_id", data.assigned_to).maybeSingle();
    if (t && t.active && t.email) to = [t.email];
  }
  if (!to.length) to = await salesTeamEmails(p.svc);
  const mail = renderMail({
    preheader: `${who} ${DECISION[data.decision]} proposal ${data.version} for ${data.reference}.`,
    paragraphs: [`<b>${esc(who)}</b> has ${esc(DECISION[data.decision])} proposal ${esc(String(data.version))} for <b>${esc(data.reference)}</b>.`,
      data.decision === "accepted" ? "The request is now confirmed. Please plan the next steps with the client and the artists." : "The request is waiting for the team."],
    quote: String(b.message || "").trim() || undefined,
    cta: { label: "Open the request", url: `${siteUrl()}/team#/project/${data.project_id}` },
  });
  for (const t of to) {
    try { await sendMail(t, `Proposal ${data.decision === "accepted" ? "accepted" : data.decision === "declined" ? "declined" : "changes requested"}: ${data.reference}`, mail); } catch (err) { console.error(err); }
  }
  return json(200, { ok: true, decision: data.decision });
});

export const config = { path: "/api/proposal-response" };
