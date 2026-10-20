// Emails every active team member when an artist sends their profile or an
// artwork for review. Called by the database at the moment of submission.
// Needs no password: it only acts on items submitted in the last 15 minutes
// that have not been announced yet, and announces each submission once.

import { handle, readJson, json, serviceClient, siteUrl, renderMail, sendMail, esc } from "../lib/server.ts";

export default handle(async (req) => {
  const { type, id } = await readJson(req);
  if ((type !== "profile" && type !== "artwork") || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    return json(200, { ok: true });
  }
  const svc = serviceClient();
  const fresh = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 15 * 60 * 1000;
  const table = type === "profile" ? "artists" : "artworks";
  const statusCol = type === "profile" ? "profile_status" : "status";

  const { data: row } = await svc.from(table).select("*").eq("id", id).maybeSingle();
  if (!row || row[statusCol] !== "submitted" || !fresh(row.submitted_at)) return json(200, { ok: true });
  if (row.submit_notified_at && new Date(row.submit_notified_at) >= new Date(row.submitted_at)) return json(200, { ok: true });

  // Claim this announcement so it is sent once, even if called twice.
  const { data: claimed } = await svc.from(table).update({ submit_notified_at: new Date().toISOString() })
    .eq("id", id).eq("submitted_at", row.submitted_at)
    .or(`submit_notified_at.is.null,submit_notified_at.lt.${row.submitted_at}`)
    .select("id").maybeSingle();
  if (!claimed) return json(200, { ok: true });

  const artistId = type === "profile" ? row.id : row.artist_id;
  const { data: artist } = type === "profile"
    ? { data: row }
    : await svc.from("artists").select("display_name, legal_name, craft, city, country").eq("id", artistId).maybeSingle();
  const name = (artist && (artist.display_name || artist.legal_name)) || "An artist";
  const again = !!row.feedback;   // feedback is kept from an earlier "changes requested"

  const { data: team } = await svc.from("team_members").select("email").eq("active", true);
  const to = (team || []).map((t) => t.email).filter(Boolean);
  if (!to.length) return json(200, { ok: true });

  const link = { label: "Review in the console", url: `${siteUrl()}/team#/artist/${artistId}` };
  let subject: string, mail;
  if (type === "profile") {
    subject = `${again ? "Profile resubmitted" : "Profile to review"}: ${name}`;
    mail = renderMail({
      preheader: `${name} sent their studio profile for review.`,
      paragraphs: [
        `<b>${esc(name)}</b> has ${again ? "updated their profile after your note and sent it again" : "sent their studio profile for review"}.`,
        `${esc(row.craft || "")}${row.city || row.country ? " · " + esc([row.city, row.country].filter(Boolean).join(", ")) : ""}`,
      ],
      cta: link,
    });
  } else {
    const title = row.title || "Untitled";
    subject = `${again ? "Artwork resubmitted" : "Artwork to review"}: “${title}” by ${name}`;
    const price = row.price_on_request ? "Price on request" : row.price != null ? `${row.currency} ${Number(row.price).toLocaleString("en-US")}` : "";
    mail = renderMail({
      preheader: `${name} sent “${title}” for review.`,
      paragraphs: [
        `<b>${esc(name)}</b> has ${again ? "changed an artwork after your note and sent it again" : "sent a new artwork for review"}:`,
        `<b>“${esc(title)}”</b>${row.materials ? "<br>" + esc(row.materials) : ""}${price ? "<br>" + esc(price) : ""}<br>${(row.images || []).length} photograph${(row.images || []).length === 1 ? "" : "s"}`,
      ],
      cta: link,
    });
  }
  for (const address of to) await sendMail(address, subject, mail);
  return json(200, { ok: true });
});

export const config = { path: "/api/studio-activity" };
