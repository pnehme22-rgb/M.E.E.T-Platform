// Emails every active team member when an artist registers.
// Called by the database right after a new application is saved. It needs no
// password because it only acts on applications that are less than 15 minutes
// old and have not been announced yet, and each one is announced once.

import { handle, readJson, json, serviceClient, siteUrl, renderMail, sendMail, esc } from "../lib/server.ts";

export default handle(async (req) => {
  const { id } = await readJson(req);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json(200, { ok: true });

  const svc = serviceClient();
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  // Claim the announcement atomically, so it is sent once even if called twice.
  const { data: claimed } = await svc.from("applications")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", id).is("notified_at", null).gte("created_at", since)
    .select("id, reference, artist_name, full_name, country, city, primary_discipline, discipline_other, practice, possible_duplicate")
    .maybeSingle();
  if (!claimed) return json(200, { ok: true });

  const { data: team } = await svc.from("team_members").select("email").eq("active", true);
  const to = (team || []).map((t) => t.email).filter(Boolean);
  if (!to.length) return json(200, { ok: true });

  const a = claimed;
  const discipline = a.primary_discipline === "Other" && a.discipline_other ? a.discipline_other : a.primary_discipline;
  const place = [a.city, a.country].filter(Boolean).join(", ");
  const mail = renderMail({
    preheader: `${a.artist_name} · ${discipline} · ${place}`,
    paragraphs: [
      "A new artist has registered for M.E.E.T.",
      `<b>${esc(a.artist_name)}</b> (${esc(a.full_name)})<br>${esc(discipline)} · ${esc(place)}<br>Reference ${esc(a.reference)}` +
        (a.possible_duplicate ? "<br><i>This email has applied before.</i>" : ""),
    ],
    quote: (a.practice || "").slice(0, 600) + ((a.practice || "").length > 600 ? "…" : ""),
    cta: { label: "Review in the console", url: `${siteUrl()}/team#/application/${a.id}` },
  });
  for (const address of to) {
    await sendMail(address, `New application: ${a.artist_name} (${a.reference})`, mail);
  }
  return json(200, { ok: true });
});

export const config = { path: "/api/new-application" };
