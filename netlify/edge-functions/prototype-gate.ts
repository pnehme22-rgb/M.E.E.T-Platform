// Keeps the private platform prototype behind the team login.
// Every request to /prototype is checked with Supabase: the visitor must be
// an active team member who completed two-step sign-in. Anyone else is sent
// to the sign-in page and never receives the prototype's files.

import type { Config, Context } from "https://edge.netlify.com";

function cookie(req: Request, name: string): string {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

export default async (req: Request, ctx: Context) => {
  const here = new URL(req.url);
  const deny = () => Response.redirect(new URL("/signin?next=" + encodeURIComponent(here.pathname), here), 302);

  const token = cookie(req, "meet-session");
  if (!token) return deny();

  const url = Netlify.env.get("SUPABASE_URL");
  const anon = Netlify.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return new Response("The prototype is not configured yet.", { status: 503 });

  const check = await fetch(`${url}/rest/v1/rpc/is_team`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!check.ok || (await check.json()) !== true) return deny();

  const res = await ctx.next();
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
};

export const config: Config = { path: ["/prototype", "/prototype/*"] };
