// Artist inquiries.
//  create: a member sends an inquiry to a public artist. The artist is
//          emailed (without the member's email or phone) and the member gets
//          a confirmation.
//  reply:  the artist answers once through M.E.E.T.; the member is emailed.
// Every rule (who may send, which artists, limits) is checked again in the
// database functions create_inquiry and respond_inquiry.

import { handle, personCaller, readJson, json, HttpError, dbError, siteUrl, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const TYPE: Record<string, string> = { personal: "Personal", professional: "Professional", business: "Business & Organization" };
const UUID = /^[0-9a-f-]{36}$/i;

function topicText(topic: string, title: string): string {
  if (topic === "artwork") return title ? `your artwork “${title}”` : "one of your artworks";
  if (topic === "commission") return "a commission";
  if (topic === "collaboration") return "a collaboration or project";
  return "your work";
}

// Both emails are tried; one failing does not stop the other, and the
// inquiry itself is already saved.
async function trySend(to: string, subject: string, mail: { html: string; text: string }): Promise<boolean> {
  try { await sendMail(to, subject, mail); return true; } catch (err) { console.error("inquiry mail failed", err); return false; }
}

export default handle(async (req) => {
  const p = await personCaller(req);
  const b = await readJson(req);

  if (b.action === "create") {
    const artist = String(b.artist_id || "");
    const artwork = b.artwork_id ? String(b.artwork_id) : null;
    if (!UUID.test(artist) || (artwork && !UUID.test(artwork))) throw new HttpError(400, "Unknown artist or artwork.");
    const { data: id, error } = await p.db.rpc("create_inquiry", {
      p_artist: artist, p_topic: String(b.topic || ""), p_artwork: artwork, p_message: String(b.message || "").slice(0, 4000),
    });
    if (error) dbError(error);

    const { data: inq } = await p.svc.from("artist_inquiries").select("*").eq("id", id).single();
    const { data: a } = await p.svc.from("artists").select("email, display_name, legal_name").eq("id", inq.artist_id).single();
    const { data: m } = await p.svc.from("member_accounts").select("email, full_name").eq("id", inq.member_id).single();
    const artistName = a.display_name || a.legal_name;
    const about = topicText(inq.topic, inq.artwork_title);

    const toArtist = renderMail({
      preheader: `${inq.member_name} sent you an inquiry about ${about}.`,
      paragraphs: [
        `Dear ${esc(firstName(a.display_name || a.legal_name))},`,
        `<b>${esc(inq.member_name)}</b>, a ${esc(TYPE[inq.member_type] || "")} member based in ${esc(inq.member_country || "a country they did not state")}, has sent you an inquiry about ${esc(about)} through M.E.E.T.:`,
      ],
      quote: inq.message,
      cta: { label: "Read and reply in my studio", url: `${siteUrl()}/studio#/inquiries/${inq.id}` },
      after: ["To protect everyone's privacy, M.E.E.T. does not share email addresses or phone numbers. Please reply from your studio: the member receives your reply by email."],
    });
    const toMember = renderMail({
      preheader: `Your inquiry to ${artistName} has been delivered.`,
      paragraphs: [
        `Dear ${esc(firstName(m.full_name))},`,
        `Thank you. Your inquiry about ${esc(about.replace(/^your /, `${artistName}'s `))} has been delivered to <b>${esc(artistName)}</b> on M.E.E.T. This is a copy of your message:`,
      ],
      quote: inq.message,
      cta: { label: "View my inquiries", url: `${siteUrl()}/account#/inquiries` },
      after: [`When ${esc(artistName)} replies, we will email you and the reply will appear in your account. Artists reply when they can, so a reply is not guaranteed.`],
    });
    const artistOk = await trySend(a.email, `New inquiry on M.E.E.T. from ${inq.member_name}`, toArtist);
    const memberOk = await trySend(m.email, `Your inquiry to ${artistName} has been sent`, toMember);
    return json(200, { ok: true, id, emailed: { artist: artistOk, member: memberOk } });
  }

  if (b.action === "reply") {
    const id = String(b.id || "");
    if (!UUID.test(id)) throw new HttpError(400, "Unknown inquiry.");
    const { error } = await p.db.rpc("respond_inquiry", { p_id: id, p_response: String(b.response || "").slice(0, 4000) });
    if (error) dbError(error);

    const { data: inq } = await p.svc.from("artist_inquiries").select("*").eq("id", id).single();
    const { data: a } = await p.svc.from("artists").select("display_name, legal_name").eq("id", inq.artist_id).single();
    const { data: m } = await p.svc.from("member_accounts").select("email, full_name").eq("id", inq.member_id).maybeSingle();
    let memberOk = false;
    if (m) {
      const artistName = a.display_name || a.legal_name;
      memberOk = await trySend(m.email, `${artistName} replied to your inquiry`, renderMail({
        preheader: `${artistName} replied to your inquiry on M.E.E.T.`,
        paragraphs: [`Dear ${esc(firstName(m.full_name))},`, `<b>${esc(artistName)}</b> has replied to your inquiry on M.E.E.T.:`],
        quote: inq.response,
        cta: { label: "View in my account", url: `${siteUrl()}/account#/inquiries` },
        after: ["Replies are sent through M.E.E.T. and contact details are not shared automatically. If you would like to continue, you can send a new inquiry from the artist's profile."],
      }));
    }
    return json(200, { ok: true, emailed: { member: memberOk } });
  }

  throw new HttpError(400, "Unknown request.");
});

export const config = { path: "/api/inquiry" };
