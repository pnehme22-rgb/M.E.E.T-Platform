// A member sends a request to the M.E.E.T. team: a commission (any account),
// a collaboration between chosen artists (any account), or a project brief
// (Professional and Business & Organization). It goes to the Requests
// dashboards, the sales team is emailed, and the member receives a
// confirmation. The database function create_project_request checks the
// account type, every field, the chosen artists and the uploaded files.

import { handle, personCaller, readJson, json, dbError, siteUrl, renderMail, sendMail, esc, firstName, salesTeamEmails } from "../lib/server.ts";

const TYPE: Record<string, string> = { personal: "Personal", professional: "Professional", business: "Business & Organization" };
const KIND: Record<string, { name: string; team: string }> = {
  commission: { name: "commission request", team: "Commissions" },
  collaboration: { name: "collaboration request", team: "Collaborations" },
  project: { name: "project request", team: "Projects" },
};

export default handle(async (req) => {
  const p = await personCaller(req);
  const b = await readJson(req);
  const payload: Record<string, unknown> = {};
  for (const k of ["kind", "description", "artwork_type", "budget", "timeline", "location", "style_refs", "quantity_dims", "purpose", "disciplines_wanted"]) {
    payload[k] = String(b[k] ?? "").slice(0, 5000);
  }
  payload.budget_undecided = b.budget_undecided === true;
  payload.timeline_undecided = b.timeline_undecided === true;
  if (Array.isArray(b.artists)) payload.artists = b.artists.slice(0, 10).map(String);
  if (Array.isArray(b.files) && b.files.length) payload.files = b.files.slice(0, 10).map(String);

  const { data, error } = await p.db.rpc("create_project_request", { p: payload });
  if (error) dbError(error);
  const { data: r } = await p.svc.from("project_requests").select("*").eq("id", data.id).single();
  const { data: m } = await p.svc.from("member_accounts").select("email, full_name").eq("id", r.member_id).single();
  const { data: chosen } = await p.svc.from("project_artists").select("artists(display_name)").eq("project_id", r.id).eq("nominated_by_client", true);
  // deno-lint-ignore no-explicit-any
  const artistNames = (chosen || []).map((c: any) => c.artists?.display_name).filter(Boolean);
  const kind = KIND[r.kind] || KIND.project;

  const who = r.client_organization ? `${r.client_organization} (${r.client_name})` : r.client_name;
  const lines = [
    r.kind === "collaboration" ? "" : `<b>${r.kind === "project" ? "Project type or space" : "Type of artwork"}:</b> ${esc(r.artwork_type)}`,
    artistNames.length ? `<b>${r.kind === "collaboration" ? "Artists to bring together" : "Artists suggested"}:</b> ${esc(artistNames.join(", "))}` : "",
    r.disciplines_wanted ? `<b>Disciplines or materials:</b> ${esc(r.disciplines_wanted)}` : "",
    `<b>Budget:</b> ${r.budget_undecided ? "Not decided yet" : esc(r.budget)}`,
    `<b>Timing:</b> ${r.timeline_undecided ? "Not decided yet" : esc(r.timeline)}`,
    r.location ? `<b>Location:</b> ${esc(r.location)}` : "",
    r.files?.length ? `<b>Files attached:</b> ${r.files.length}` : "",
  ].filter(Boolean).join("<br>");

  const sales = await salesTeamEmails(p.svc);
  const toSales = renderMail({
    preheader: `${who} sent ${kind.name} ${r.reference}.`,
    paragraphs: [
      `<b>${esc(who)}</b>, a ${esc(TYPE[r.client_type] || "")} member based in ${esc(r.client_country || "an unstated country")}, has sent ${esc(kind.name)} <b>${esc(r.reference)}</b>.`,
      lines,
    ],
    quote: r.description,
    cta: { label: `Open in ${kind.team}`, url: `${siteUrl()}/team#/project/${r.id}` },
  });
  for (const to of sales) {
    try { await sendMail(to, `New ${kind.name} ${r.reference}: ${who}`, toSales); } catch (err) { console.error(err); }
  }

  let memberOk = true;
  try {
    await sendMail(m.email, `We have received your ${kind.name} (${r.reference})`, renderMail({
      preheader: "Thank you. The M.E.E.T. team will review your request.",
      paragraphs: [
        `Dear ${esc(firstName(m.full_name))},`,
        `Thank you for your ${esc(kind.name)}. We have received it with the reference <b>${esc(r.reference)}</b>.`,
        lines,
      ],
      quote: r.description,
      cta: { label: "Follow my request", url: `${siteUrl()}/account#/request/${r.id}` },
      after: [r.kind === "collaboration"
        ? "The M.E.E.T. team will review your idea and contact the artists you chose to check their availability. We will come back to you with what is possible. You can follow each step in your account."
        : "The M.E.E.T. team will review it and contact you by email. You can follow its status in your account at any time."],
    }));
  } catch (err) { console.error(err); memberOk = false; }

  return json(200, { ok: true, id: r.id, reference: r.reference, emailed: { member: memberOk } });
});

export const config = { path: "/api/project-request" };
