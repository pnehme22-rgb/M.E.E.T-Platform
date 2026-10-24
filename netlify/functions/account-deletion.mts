// A member (Personal, Professional, Business) asks M.E.E.T. to delete their
// account. Records the request on their own account only, tells the team by
// email, and notes it in the activity log. A founder then completes the
// deletion from the console (Members › Delete).

import { handle, json, HttpError, serviceClient, siteUrl, renderMail, sendMail, esc } from "../lib/server.ts";

export default handle(async (req) => {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in again.");
  const svc = serviceClient();
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has ended. Please sign in again.");

  const { data: acct } = await svc.from("member_accounts")
    .select("id, account_type, email, full_name, business_name, deletion_requested_at").eq("id", data.user.id).maybeSingle();
  if (!acct) throw new HttpError(403, "Only member accounts can be deleted from this page. Artists can ask from their studio.");
  if (acct.deletion_requested_at) return json(200, { ok: true, already: true });

  const now = new Date().toISOString();
  const { error: e1 } = await svc.from("member_accounts").update({ deletion_requested_at: now }).eq("id", acct.id);
  if (e1) throw e1;
  await svc.from("audit_log").insert({
    actor: acct.id, actor_name: acct.full_name, action: "member.deletion_requested",
    target_type: "member", target_id: acct.id, detail: { account_type: acct.account_type },
  });

  const { data: team } = await svc.from("team_members").select("email, role").eq("active", true);
  const founders = (team || []).filter((t) => t.role === "founder").map((t) => t.email).filter(Boolean);
  const name = acct.account_type === "business" && acct.business_name ? `${acct.business_name} (${acct.full_name})` : acct.full_name;
  const mail = renderMail({
    preheader: `${name} asked us to delete their account.`,
    paragraphs: [
      `<b>${esc(name)}</b> (${esc(acct.email)}) asked M.E.E.T. to delete their ${esc(acct.account_type)} account.`,
      "Please complete it within 30 days from the console, then confirm to them by email.",
    ],
    cta: { label: "Open Members in the console", url: `${siteUrl()}/team#/members` },
  });
  // The request is already saved; a failed alert email must not undo it.
  for (const address of founders) {
    try { await sendMail(address, `Account deletion request: ${name}`, mail); } catch (err) { console.error(err); }
  }
  return json(200, { ok: true });
});

export const config = { path: "/api/account-deletion" };
