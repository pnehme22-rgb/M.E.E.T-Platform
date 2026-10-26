// Support between artists and the M.E.E.T. team.
// An artist writes from Support in their studio (their profile, artworks, an
// inquiry, or a possible collaboration): the database records it (artists
// only, a few per day), every active team member except viewers is emailed,
// and it appears in the console (Artist requests).
// A team member answers from the console (action "answer"): the reply is
// stored with the message, shown in the artist's studio, emailed to the artist,
// and the message is marked as answered. Internal notes are never sent.

import { handle, personCaller, teamCaller, readJson, json, dbError, siteUrl, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const TOPIC: Record<string, string> = {
  profile: "their profile", artworks: "their artworks", inquiry: "an inquiry",
  collaboration: "a possible collaboration with another artist", other: "something else",
};

export default handle(async (req) => {
  const b = await readJson(req);
  if (b.action === "answer") return answer(req, b);
  const p = await personCaller(req);
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

async function answer(req: Request, b: Record<string, unknown>) {
  const c = await teamCaller(req, { editor: true });
  const reply = String(b.reply || "").slice(0, 4000);
  const { data, error } = await c.db.rpc("answer_artist_request", { p_id: String(b.id || ""), p_reply: reply, p_note: String(b.note || "").slice(0, 2000) });
  if (error) dbError(error);
  const { data: a } = await c.svc.from("artists").select("email, display_name, legal_name").eq("id", data.artist_id).maybeSingle();
  let emailed = false;
  if (a && a.email) {
    try {
      await sendMail(a.email, "A reply from the M.E.E.T. team", renderMail({
        preheader: "The M.E.E.T. team has replied to your message.",
        paragraphs: [`Dear ${esc(firstName(a.display_name || a.legal_name || ""))},`, "Thank you for your message. Here is our reply:"],
        quote: reply.trim(),
        cta: { label: "Open Support in my studio", url: `${siteUrl()}/studio#/help` },
        after: ["You can reply to this email, or write to us again from Support in your studio."],
      }));
      emailed = true;
    } catch (err) { console.error(err); }
  }
  return json(200, { ok: true, emailed });
}

export const config = { path: "/api/artist-help" };
