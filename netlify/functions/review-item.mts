// Team review of an artist's profile or artwork: approve, request changes
// or decline. Optionally emails the artist the outcome and the team's note.

import { handle, teamCaller, readJson, json, HttpError, renderMail, sendMail, esc, firstName, siteUrl } from "../lib/server.ts";

const DECISIONS = ["approved", "changes_requested", "declined"];

export default handle(async (req) => {
  const c = await teamCaller(req, { editor: true });
  const { type, id, decision, feedback, notify } = await readJson(req);
  if (type !== "profile" && type !== "artwork") throw new HttpError(400, "Unknown item.");
  if (typeof id !== "string" || !DECISIONS.includes(String(decision))) throw new HttpError(400, "Unknown decision.");
  const note = String(feedback || "").trim().slice(0, 4000);
  if (decision === "changes_requested" && note.length < 5) throw new HttpError(400, "Please tell the artist what to change.");

  const { error } = await c.db.rpc("review_item", { p_type: type, p_id: id, p_decision: decision, p_feedback: note });
  if (error) throw new HttpError(400, error.message);

  if (notify) {
    let artistId = id as string, title = "";
    if (type === "artwork") {
      const { data: w } = await c.svc.from("artworks").select("artist_id, title").eq("id", id).single();
      artistId = w!.artist_id;
      title = w!.title || "Untitled";
    }
    const { data: a } = await c.svc.from("artists").select("email, display_name, legal_name").eq("id", artistId).single();
    const name = firstName(a!.display_name || a!.legal_name);
    const what = type === "profile" ? "your profile" : `your artwork “${esc(title)}”`;
    const studio = { label: "Open my studio", url: siteUrl() + "/studio" };

    let subject: string, mail;
    if (decision === "approved") {
      subject = type === "profile" ? "Your M.E.E.T. profile is approved" : `“${title}” is approved`;
      mail = renderMail({
        preheader: `Good news about ${type === "profile" ? "your profile" : "your artwork"}.`,
        paragraphs: [`Dear ${esc(name)},`, `Good news: the M.E.E.T. team has approved ${what}. ${type === "profile" ? "Your profile is now public on M.E.E.T." : "It appears publicly on M.E.E.T. alongside your approved profile."}`],
        quote: note || undefined,
        cta: studio,
      });
    } else if (decision === "changes_requested") {
      subject = type === "profile" ? "A note about your M.E.E.T. profile" : `A note about “${title}”`;
      mail = renderMail({
        preheader: "A few suggested changes from the M.E.E.T. team.",
        paragraphs: [`Dear ${esc(name)},`, `Thank you for adding ${what}. Before we approve it, we have a few suggestions:`],
        quote: note,
        cta: studio,
        after: ["When you have made the changes, send it for review again from your studio. You can also reply to this email with any questions."],
      });
    } else {
      subject = type === "profile" ? "About your M.E.E.T. profile" : `About “${title}”`;
      mail = renderMail({
        preheader: "An update from the M.E.E.T. team.",
        paragraphs: [`Dear ${esc(name)},`, `Thank you for sharing ${what} with us. After careful review, we will not include it at this stage.`],
        quote: note || undefined,
        after: ["If you would like to talk about it, simply reply to this email."],
      });
    }
    await sendMail(a!.email, subject, mail);
  }
  return json(200, { ok: true });
});

export const config = { path: "/api/review-item" };
