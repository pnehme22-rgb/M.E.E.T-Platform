// Settings self-check for founders. Says which Netlify settings look right,
// without ever revealing their values. Visitors get no details: send the
// request with a founder's sign-in (Authorization: Bearer <token>).

import { createClient } from "@supabase/supabase-js";
import { teamCaller } from "../lib/server.ts";

function get(name: string): string {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return ((g.Netlify && g.Netlify.env && g.Netlify.env.get(name)) || process.env[name] || "").trim();
}

export default async (req: Request): Promise<Response> => {
  try { await teamCaller(req, { founder: true }); }
  catch (err) {
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    // A settings problem is still reported (without values), so a founder can fix it.
    if (e && e.status === 500) return new Response(JSON.stringify({ ok: false, message: e.message }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return new Response(JSON.stringify({ ok: false, message: "Founders only." }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const url = get("SUPABASE_URL"), anon = get("SUPABASE_ANON_KEY"), svcKey = get("SUPABASE_SERVICE_ROLE_KEY");
  const out: Record<string, string> = {};
  out.SUPABASE_URL = !url ? "missing" : url === "https://tklhucdxrgkbkjkaturg.supabase.co" ? "ok" : "set, but not the expected address (check for typos or extra characters)";
  out.SUPABASE_ANON_KEY = !anon ? "missing" : /^sb_publishable_|^eyJ/.test(anon) ? "ok" : "set, but does not look like a Supabase publishable key";
  out.SUPABASE_SERVICE_ROLE_KEY = !svcKey ? "missing" : /^sb_secret_|^eyJ/.test(svcKey) ? "looks like a key" : "set, but does not look like a Supabase secret key";
  out.GMAIL_USER = get("GMAIL_USER") === "minds.exploring.traditions@gmail.com" ? "ok" : get("GMAIL_USER") ? "set, but not minds.exploring.traditions@gmail.com" : "missing";
  const pw = get("GMAIL_APP_PASSWORD").replace(/\s/g, "");
  out.GMAIL_APP_PASSWORD = !pw ? "missing" : pw.length === 16 ? "ok" : `set, but ${pw.length} characters long (an app password has 16 letters)`;
  const rk = get("RESEND_API_KEY");
  out.RESEND_API_KEY = !rk ? "not set yet (emails go through Gmail)" : /^re_/.test(rk) ? "ok (emails go from hello@meetstudio.art)" : "set, but does not look like a Resend key (they start with re_)";
  out.SITE_URL = get("SITE_URL") === "https://meetstudio.art" ? "ok" : get("SITE_URL") ? "set, but not https://meetstudio.art" : "missing";

  if (url && svcKey) {
    try {
      const svc = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await svc.auth.admin.listUsers({ page: 1, perPage: 1 });
      out.service_key_test = error ? `refused by Supabase (${error.message})` : "ok, Supabase accepted the secret key";
    } catch (e) {
      out.service_key_test = `could not reach Supabase (${(e as Error).message})`;
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};

export const config = { path: "/api/health" };
