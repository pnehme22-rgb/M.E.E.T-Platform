// An artist asks the M.E.E.T. team for help from their studio: their profile,
// their artworks, an inquiry, or a possible collaboration with another artist.
// The database records it (artists only, a few per day); every active team
// member except viewers is emailed, and it appears in the console.

import { handle, personCaller, readJson, json, dbError, siteUrl, renderMail, sendMail, esc } from "../lib/server.ts";

const TOPIC: Record<string, string> = {
  profile: "their profile", artworks: "their artworks", inquiry: "an inquiry",
  collaboration: "a possible collaboration with another artist", other: "something else",
};

export default handle(async (req) => {
  const p = await personCaller(req);
  const b = await readJson(req);
  const topic = String(b.topic || "");
  const message = String(b.message || "").slice(0, 2000);
  const { data: id, error } = await p.db.rpc("create_artist_request", { p_topic: topic, p_message: message });
  if (error) dbError(error);

  const { data: a } = await p.svc.from("artists").select("display_name, legal_name").eq("id", p.user.id).maybeSingle();
  const name = (a && (a.display_name || a.legal_name)) || "An artist";
  const { data: team } = await p.svc.from("team_members").select("email, role").eq("active", true);
  const to = (team || []).filter((t) => t.role !== "viewer").map((t) => t.email).filter(Boolean);
  const mail = renderMail({
    preheader: `${name} wrote to Support.`,
    paragraphs: [`<b>${esc(name)}</b> would like help with ${esc(TOPIC[topic] || "something")}.`],
    quote: message,
    cta: { label: "Open in the console", url: `${siteUrl()}/team#/artist-requests` },
  });
  for (const t of to) {
    try { await sendMail(t, `Artist support: ${name}`, mail); } catch (err) { console.error(err); }
  }
  return json(200, { ok: true, id });
});

export const config = { path: "/api/artist-help" };
