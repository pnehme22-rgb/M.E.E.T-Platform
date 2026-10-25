// Founders only: change a member's sign-in email or account type, when the
// member asks (members cannot change either themselves). The new email must be
// free and valid; the login and the member account change together, so the
// member signs in with the new address from then on. An account type change
// needs the details that type requires. Every change is recorded in the
// activity log, and the member is told by email (old and new address for an
// email change). Requests, inquiries and their history are kept as they were.

import { handle, teamCaller, readJson, json, HttpError, audit, siteUrl, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

const TYPE: Record<string, string> = { personal: "Personal", professional: "Professional", business: "Business & Organization" };
const clean = (v: unknown, max = 160) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export default handle(async (req) => {
  const c = await teamCaller(req, { founder: true });
  const b = await readJson(req);
  const id = String(b.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Unknown member.");
  const { data: m } = await c.svc.from("member_accounts").select("*").eq("id", id).maybeSingle();
  if (!m) throw new HttpError(404, "This member account no longer exists.");

  if (b.action === "email") {
    const email = clean(b.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Please enter a valid email address.");
    if (email === String(m.email).toLowerCase()) throw new HttpError(400, "This is already the account's email address.");
    if (String(b.confirm || "").trim().toLowerCase() !== email) throw new HttpError(400, "The two email addresses do not match.");
    const { data: taken } = await c.svc.from("member_accounts").select("id").eq("email", email).maybeSingle();
    if (taken) throw new HttpError(400, "Another member account already uses this email address.");
    const { error } = await c.svc.auth.admin.updateUserById(id, { email, email_confirm: true });
    if (error) {
      console.error("email change failed", error);
      throw new HttpError(400, /already|registered|exists/i.test(error.message) ? "Another login already uses this email address." : "The email address could not be changed. Nothing was changed.");
    }
    const { error: e2 } = await c.svc.from("member_accounts").update({ email }).eq("id", id);
    if (e2) {
      // Keep the login and the account in step: undo the login change.
      await c.svc.auth.admin.updateUserById(id, { email: m.email, email_confirm: true });
      console.error("member email update failed", e2);
      throw new HttpError(500, "The email address could not be changed. Nothing was changed.");
    }
    await audit(c, "member.email_changed", "member", id, { from: m.email, to: email });
    const note = renderMail({
      preheader: "The email address of your M.E.E.T. account has changed.",
      paragraphs: [`Dear ${esc(firstName(m.full_name))},`,
        `As you asked, the email address of your M.E.E.T. account is now <b>${esc(email)}</b>. Please use it to sign in from now on. Your password has not changed.`,
        "If you did not ask for this change, please reply to this email straight away."],
      cta: { label: "Sign in", url: `${siteUrl()}/signin` },
    });
    let emailed = 0;
    for (const to of [m.email, email]) { try { await sendMail(to, "Your M.E.E.T. account email has changed", note); emailed++; } catch (err) { console.error(err); } }
    return json(200, { ok: true, emailed });
  }

  if (b.action === "type") {
    const type = String(b.account_type || "");
    if (!TYPE[type]) throw new HttpError(400, "Please choose an account type.");
    if (type === m.account_type) throw new HttpError(400, "The account already has this type.");
    const f = (b.fields || {}) as Record<string, unknown>;
    const upd: Record<string, string> = { account_type: type };
    if (type === "professional") {
      upd.professional_role = clean(f.professional_role, 120) || m.professional_role;
      upd.company_name = clean(f.company_name, 160) || m.company_name;
      if (!upd.professional_role || !upd.company_name) throw new HttpError(400, "A Professional account needs a professional role and a company or studio name.");
    }
    if (type === "business") {
      upd.business_name = clean(f.business_name, 160) || m.business_name;
      upd.business_type = clean(f.business_type, 120) || m.business_type;
      upd.contact_person = clean(f.contact_person, 120) || m.contact_person || m.full_name;
      if (!upd.business_name || !upd.business_type || !upd.contact_person) throw new HttpError(400, "A Business & Organization account needs a business name, a business type and a contact person.");
    }
    const { error } = await c.svc.from("member_accounts").update(upd).eq("id", id);
    if (error) { console.error("type change failed", error); throw new HttpError(400, "The account type could not be changed. Nothing was changed."); }
    await audit(c, "member.type_changed", "member", id, { from: m.account_type, to: type });
    let emailed = 0;
    try {
      await sendMail(m.email, "Your M.E.E.T. account type has changed", renderMail({
        preheader: `Your M.E.E.T. account is now a ${TYPE[type]} account.`,
        paragraphs: [`Dear ${esc(firstName(m.full_name))},`, `As you asked, your M.E.E.T. account is now a <b>${esc(TYPE[type])}</b> account. You can check your details in your account.`],
        cta: { label: "Open my account", url: `${siteUrl()}/account#/profile` },
      }));
      emailed = 1;
    } catch (err) { console.error(err); }
    return json(200, { ok: true, emailed });
  }

  throw new HttpError(400, "Unknown action.");
});

export const config = { path: "/api/member-admin" };
