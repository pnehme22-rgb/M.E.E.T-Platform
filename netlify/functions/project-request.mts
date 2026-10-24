// A Professional or Business & Organization member sends a project request.
// It goes to the Sales dashboard (never the artist approval queue), the sales
// team is emailed, and the member receives a confirmation. The database
// function create_project_request checks the account type and every field.

import { handle, personCaller, readJson, json, dbError, siteUrl, renderMail, sendMail, esc, firstName, salesTeamEmails } from "../lib/server.ts";

const TYPE: Record<string, string> = { professional: "Professional", business: "Business & Organization" };

export default handle(async (req) => {
  const p = await personCaller(req);
  const b = await readJson(req);
  const payload: Record<string, unknown> = {};
  for (const k of ["description", "artwork_type", "budget", "timeline", "location", "style_refs", "quantity_dims"]) {
    payload[k] = String(b[k] ?? "").slice(0, 5000);
  }
  payload.budget_undecided = b.budget_undecided === true;
  payload.timeline_undecided = b.timeline_undecided === true;

  const { data, error } = await p.db.rpc("create_project_request", { p: payload });
  if (error) dbError(error);
  const { data: r } = await p.svc.from("project_requests").select("*").eq("id", data.id).single();
  const { data: m } = await p.svc.from("member_accounts").select("email, full_name").eq("id", r.member_id).single();

  const who = r.client_organization ? `${r.client_organization} (${r.client_name})` : r.client_name;
  const lines = [
    `<b>Type of artwork:</b> ${esc(r.artwork_type)}`,
    `<b>Budget:</b> ${r.budget_undecided ? "Not decided yet" : esc(r.budget)}`,
    `<b>Timeline:</b> ${r.timeline_undecided ? "Not decided yet" : esc(r.timeline)}`,
    r.location ? `<b>Location:</b> ${esc(r.location)}` : "",
  ].filter(Boolean).join("<br>");

  const sales = await salesTeamEmails(p.svc);
  const toSales = renderMail({
    preheader: `${who} sent project request ${r.reference}.`,
    paragraphs: [
      `<b>${esc(who)}</b>, a ${esc(TYPE[r.client_type] || "")} member based in ${esc(r.client_country || "an unstated country")}, has sent project request <b>${esc(r.reference)}</b>.`,
      lines,
    ],
    quote: r.description,
    cta: { label: "Open in the Sales dashboard", url: `${siteUrl()}/team#/project/${r.id}` },
  });
  for (const to of sales) {
    try { await sendMail(to, `New project request ${r.reference}: ${who}`, toSales); } catch (err) { console.error(err); }
  }

  let memberOk = true;
  try {
    await sendMail(m.email, `We have received your project request (${r.reference})`, renderMail({
      preheader: "Thank you. The M.E.E.T. team will review your project request.",
      paragraphs: [
        `Dear ${esc(firstName(m.full_name))},`,
        `Thank you for your project request. We have received it with the reference <b>${esc(r.reference)}</b>.`,
        lines,
      ],
      quote: r.description,
      cta: { label: "View my project requests", url: `${siteUrl()}/account#/projects` },
      after: ["The M.E.E.T. team will review it and contact you by email. You can follow its status in your account at any time."],
    }));
  } catch (err) { console.error(err); memberOk = false; }

  return json(200, { ok: true, id: r.id, reference: r.reference, emailed: { member: memberOk } });
});

export const config = { path: "/api/project-request" };
