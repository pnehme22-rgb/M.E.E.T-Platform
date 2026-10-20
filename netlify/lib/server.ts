// Shared helpers for M.E.E.T. Netlify functions.
// These run on Netlify's servers and hold the two secrets that must never
// reach a browser: the Supabase service key and the Gmail app password.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function env(name: string): string {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const v = (g.Netlify && g.Netlify.env && g.Netlify.env.get(name)) || process.env[name];
  if (!v) throw new HttpError(500, `The site is missing the ${name} setting. Add it in Netlify › Site configuration › Environment variables.`);
  return v;
}

export function siteUrl(): string {
  return env("SITE_URL").replace(/\/+$/, "");
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A client that acts as the signed-in person, so the database's own rules
// (and its audit log) apply to what they do.
export function userClient(token: string): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export interface Caller {
  user: User;
  member: { user_id: string; name: string; email: string; role: string; active: boolean };
  token: string;
  db: SupabaseClient;
  svc: SupabaseClient;
}

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(part, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

export function sessionId(token: string): string {
  const id = jwtClaims(token).session_id;
  return typeof id === "string" ? id : "";
}

// A team sign-in counts once its emailed code has been confirmed (30 days per device).
export async function sessionConfirmed(svc: SupabaseClient, userId: string, token: string): Promise<boolean> {
  const sid = sessionId(token);
  if (!sid) return false;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await svc.from("team_session_checks").select("session_id")
    .eq("session_id", sid).eq("user_id", userId).not("verified_at", "is", null).gte("verified_at", since).maybeSingle();
  return !!data;
}

// Confirms the request comes from an active team member who completed
// the emailed-code step. Founders-only and editors-only checks are optional.
export async function teamCaller(req: Request, need: { founder?: boolean; editor?: boolean } = {}): Promise<Caller> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in again.");
  const svc = serviceClient();
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user) {
    console.error("getUser failed", error && { status: error.status, code: error.code, message: error.message });
    // A real expired session comes back as 401/403 from Supabase. Anything
    // else means this server cannot talk to Supabase: a settings problem.
    if (error && error.status !== 401 && error.status !== 403) {
      throw new HttpError(500, "The server could not check your sign-in with Supabase. Please check the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY settings in Netlify. (" + (error.message || "unknown error") + ")");
    }
    throw new HttpError(401, "Your session has ended. Please sign in again.");
  }
  if (!(await sessionConfirmed(svc, data.user.id, token))) throw new HttpError(403, "Please confirm your sign-in with the code we emailed you.");
  const { data: member } = await svc.from("team_members").select("user_id, name, email, role, active")
    .eq("user_id", data.user.id).maybeSingle();
  if (!member || !member.active) throw new HttpError(403, "Your account does not have access to the team console.");
  if (need.founder && member.role !== "founder") throw new HttpError(403, "Only founders can do this.");
  if (need.editor && member.role === "viewer") throw new HttpError(403, "Your role can view but not change records.");
  return { user: data.user, member, token, db: userClient(token), svc };
}

export async function audit(c: Caller, action: string, type: string, id: string, detail: Record<string, unknown> = {}) {
  await c.svc.from("audit_log").insert({ actor: c.user.id, actor_name: c.member.name, action, target_type: type, target_id: id, detail });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 20000) throw new HttpError(413, "This request is too large.");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object") throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "The request could not be read.");
  }
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json(405, { ok: false, message: "Method not allowed." });
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { ok: false, message: err.message });
      console.error(err);
      return json(500, { ok: false, message: "Something went wrong on our side. Nothing was changed. Please try again." });
    }
  };
}

// Generates a one-time link that lands on /welcome. New people get an
// invite; people who already have an account get a password link instead.
export async function accountLink(svc: SupabaseClient, email: string, meta: Record<string, unknown>) {
  const redirectTo = siteUrl() + "/welcome";
  let type: "invite" | "recovery" = "invite";
  let res = await svc.auth.admin.generateLink({ type: "invite", email, options: { data: meta, redirectTo } });
  if (res.error) {
    if (!/already|exists|registered/i.test(res.error.message) && res.error.code !== "email_exists") throw res.error;
    type = "recovery";
    res = await svc.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    if (res.error) throw res.error;
  }
  const user = res.data.user;
  const hashed = res.data.properties.hashed_token;
  const url = `${siteUrl()}/welcome?th=${encodeURIComponent(hashed)}&type=${type}&w=1`;
  return { user, url, type };
}

/* ---------------------------- email ---------------------------- */

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function firstName(n: string): string {
  return (n || "").trim().split(/\s+/)[0] || "there";
}

interface MailParts {
  preheader: string;
  paragraphs: string[];        // already-escaped HTML fragments
  quote?: string;              // plain text, shown as a highlighted note
  cta?: { label: string; url: string };
  after?: string[];            // paragraphs after the button
}

// The M.E.E.T. email look: ivory paper, navy text, burgundy button, logo.
export function renderMail(p: MailParts): { html: string; text: string } {
  const logo = siteUrl() + "/assets/img/brand/mark-email.png";
  const para = (h: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#133458">${h}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5efe1">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe1;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fbf8f1;border:1px solid #e3d8c2;border-radius:18px;padding:36px 32px;font-family:Georgia,'Times New Roman',serif">
<tr><td style="padding-bottom:24px"><img src="${logo}" width="60" height="40" alt="M.E.E.T." style="display:inline-block;vertical-align:middle;border:0">
<span style="font-size:22px;letter-spacing:.08em;color:#133458;vertical-align:middle;margin-left:10px">M.E.E.T.</span></td></tr>
<tr><td style="font-family:Arial,Helvetica,sans-serif">
${p.paragraphs.map(para).join("")}
${p.quote ? `<div style="margin:4px 0 20px;padding:14px 18px;background:#f5efe1;border-left:3px solid #790d16;border-radius:8px;font-size:15px;line-height:1.6;color:#133458;white-space:pre-wrap">${esc(p.quote)}</div>` : ""}
${p.cta ? `<p style="margin:8px 0 24px"><a href="${esc(p.cta.url)}" style="display:inline-block;background:#790d16;color:#f5efe1;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:999px">${esc(p.cta.label)}</a></p>` : ""}
${(p.after || []).map(para).join("")}
<p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#133458">With warm regards,<br>The M.E.E.T. team<br><i style="font-family:Georgia,serif;color:#56627a">Mind Exploring Every Tradition</i></p>
</td></tr></table>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#56627a;margin:16px 0 0">M.E.E.T. · minds.exploring.traditions@gmail.com</p>
</td></tr></table></body></html>`;
  const strip = (h: string) => h.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [
    ...p.paragraphs.map(strip),
    p.quote ? `"${p.quote}"` : "",
    p.cta ? `${p.cta.label}: ${p.cta.url}` : "",
    ...(p.after || []).map(strip),
    "With warm regards,\nThe M.E.E.T. team\nMind Exploring Every Tradition",
  ].filter(Boolean).join("\n\n");
  return { html, text };
}

export async function sendMail(to: string, subject: string, body: { html: string; text: string }) {
  const user = env("GMAIL_USER");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: env("GMAIL_APP_PASSWORD") },
  });
  try {
    await transport.sendMail({ from: `"M.E.E.T." <${user}>`, replyTo: user, to, subject, html: body.html, text: body.text });
  } catch (err) {
    console.error("MAIL ERROR", err);
    throw new HttpError(502, "The change was saved, but the email could not be sent. Please try sending it again in a moment.");
  }
}
