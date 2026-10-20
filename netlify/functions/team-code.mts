// Second sign-in step for the team: a 6-digit code sent by email.
//   POST /api/team-code { action: "send" }               emails a new code
//   POST /api/team-code { action: "verify", code: "…" }  confirms this sign-in
// Codes are stored only as a hash, work for 10 minutes, allow 5 attempts,
// and belong to one sign-in session.

import { createHash, randomInt } from "node:crypto";
import { handle, readJson, json, HttpError, serviceClient, sessionId, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const hash = (code: string, sid: string) => createHash("sha256").update(sid + ":" + code).digest("hex");

export default handle(async (req) => {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in again.");
  const svc = serviceClient();
  const { data: u, error } = await svc.auth.getUser(token);
  if (error || !u.user) throw new HttpError(401, "Your session has ended. Please sign in again.");
  const sid = sessionId(token);
  if (!sid) throw new HttpError(401, "Please sign in again.");

  const { data: member } = await svc.from("team_members").select("name, email, active").eq("user_id", u.user.id).maybeSingle();
  if (!member || !member.active) throw new HttpError(403, "Your account does not have access to the team console.");

  const body = await readJson(req);
  const { data: row } = await svc.from("team_session_checks").select("*").eq("session_id", sid).maybeSingle();

  if (body.action === "send") {
    if (row && row.verified_at) return json(200, { ok: true, confirmed: true });
    // Gentle limits: one email per 30 seconds, at most 5 per sign-in.
    if (row && Date.now() - new Date(row.sent_at).getTime() < 30000) {
      throw new HttpError(429, "A code was just sent. Please wait a few seconds before asking for another.");
    }
    if (row && row.sent_count >= 5) throw new HttpError(429, "Too many codes for this sign-in. Please sign out and sign in again.");
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const rec = {
      session_id: sid, user_id: u.user.id, code_hash: hash(code, sid),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      attempts: 0, sent_count: (row ? row.sent_count : 0) + 1, sent_at: new Date().toISOString(), verified_at: null,
    };
    const { error: e2 } = await svc.from("team_session_checks").upsert(rec, { onConflict: "session_id" });
    if (e2) throw e2;
    const mail = renderMail({
      preheader: `Your M.E.E.T. sign-in code is ${code}`,
      paragraphs: [
        `Dear ${esc(firstName(member.name))},`,
        "Here is your code to finish signing in to the M.E.E.T. team console:",
        `<span style="display:inline-block;font-family:Georgia,serif;font-size:34px;letter-spacing:.35em;color:#133458;background:#f5efe1;border-radius:12px;padding:12px 18px">${code}</span>`,
        "It works for 10 minutes. If you did not try to sign in, you can ignore this email, and consider changing your password.",
      ],
    });
    await sendMail(member.email, `Your M.E.E.T. sign-in code: ${code}`, mail);
    return json(200, { ok: true, sent_to: member.email.replace(/^(.).*(@.*)$/, "$1•••$2") });
  }

  if (body.action === "verify") {
    const code = String(body.code || "").replace(/\D/g, "");
    if (!row) throw new HttpError(400, "Please ask for a code first.");
    if (row.verified_at) return json(200, { ok: true });
    if (row.attempts >= 5) throw new HttpError(429, "Too many tries. Please ask for a new code.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(400, "This code has expired. Please ask for a new one.");
    if (code.length !== 6 || hash(code, sid) !== row.code_hash) {
      await svc.from("team_session_checks").update({ attempts: row.attempts + 1 }).eq("session_id", sid);
      throw new HttpError(400, "That code is not right. Please check the latest email and try again.");
    }
    await svc.from("team_session_checks").update({ verified_at: new Date().toISOString() }).eq("session_id", sid);
    return json(200, { ok: true });
  }

  throw new HttpError(400, "Unknown action.");
});

export const config = { path: "/api/team-code" };
