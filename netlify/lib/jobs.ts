// Scheduled jobs, shared by the Netlify schedules and the founders-only
// "run now" endpoint (/api/run-job), so both run exactly the same code.

import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl, renderMail, sendMail, esc, firstName, type MailAttachment } from "./server.ts";

/* ---------------------------- CSV ---------------------------- */

// Values are quoted, and anything a spreadsheet could run as a formula is
// neutralised (same rule as the console's CSV exports).
function cell(v: unknown): string {
  if (Array.isArray(v)) v = v.join("\n");
  else if (v && typeof v === "object") v = JSON.stringify(v);
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function csv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header.join(",")].concat(rows.map((r) => r.map(cell).join(","))).join("\r\n") + "\r\n";
}

async function all<T = Record<string, unknown>>(svc: SupabaseClient, table: string, select = "*", order = "created_at"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from(table).select(select).order(order, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/* ---------------------- inquiries and sales export ---------------------- */

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export async function buildSalesExport(svc: SupabaseClient): Promise<{ files: MailAttachment[]; counts: Record<string, number> }> {
  const [inquiries, projects, notes, matched, tasks, events, members, artists, team] = await Promise.all([
    all<Row>(svc, "artist_inquiries"),
    all<Row>(svc, "project_requests"),
    all<Row>(svc, "project_notes"),
    all<Row>(svc, "project_artists", "*", "updated_at"),
    all<Row>(svc, "project_tasks"),
    all<Row>(svc, "project_events", "*", "at"),
    all<Row>(svc, "member_accounts", "id, email, phone"),
    all<Row>(svc, "artists", "id, display_name, legal_name"),
    all<Row>(svc, "team_members", "user_id, name"),
  ]);
  const member = new Map(members.map((m) => [m.id, m]));
  const artistName = new Map(artists.map((a) => [a.id, a.display_name || a.legal_name]));
  const teamName = new Map(team.map((t) => [t.user_id, t.name]));
  const ref = new Map(projects.map((p) => [p.id, p.reference]));

  const files: MailAttachment[] = [
    { filename: "inquiries.csv", content: csv(
      ["id", "created_at", "status", "artist", "member_name", "member_type", "member_country", "member_email", "topic", "artwork_title",
        "message", "response", "viewed_at", "responded_at", "closed_at"],
      inquiries.map((q) => [q.id, q.created_at, q.status, artistName.get(q.artist_id) || q.artist_id, q.member_name, q.member_type,
        q.member_country, member.get(q.member_id)?.email || "", q.topic, q.artwork_title, q.message, q.response,
        q.viewed_at, q.responded_at, q.closed_at])) },
    { filename: "projects.csv", content: csv(
      ["reference", "kind", "created_at", "updated_at", "status", "waiting_on", "next_action", "next_action_due", "not_confirmed_reason", "not_confirmed_note", "assigned_to",
        "client_name", "client_organization", "client_type", "client_country", "client_email", "client_phone",
        "artwork_type", "purpose", "disciplines_wanted", "description", "budget", "budget_undecided", "timeline", "timeline_undecided", "location", "style_refs", "quantity_dims",
        "currency", "estimated_value", "fee_terms", "final_value", "final_revenue", "payment_status", "revenue_notes", "confirmed_at", "id"],
      projects.map((p) => [p.reference, p.kind, p.created_at, p.updated_at, p.status, p.waiting_on, p.next_action, p.next_action_due, p.not_confirmed_reason, p.not_confirmed_note,
        teamName.get(p.assigned_to) || "", p.client_name, p.client_organization, p.client_type, p.client_country,
        member.get(p.member_id)?.email || "", member.get(p.member_id)?.phone || "",
        p.artwork_type, p.purpose, p.disciplines_wanted, p.description, p.budget, p.budget_undecided, p.timeline, p.timeline_undecided, p.location, p.style_refs, p.quantity_dims,
        p.currency, p.estimated_value, p.fee_terms, p.final_value, p.final_revenue, p.payment_status, p.revenue_notes, p.confirmed_at, p.id])) },
    { filename: "project_notes.csv", content: csv(["project", "created_at", "author", "note"],
      notes.map((n) => [ref.get(n.project_id) || n.project_id, n.created_at, teamName.get(n.author) || "", n.body])) },
    { filename: "project_artists.csv", content: csv(["project", "artist", "state", "reason", "updated_at"],
      matched.map((m) => [ref.get(m.project_id) || m.project_id, artistName.get(m.artist_id) || m.artist_id, m.state, m.reason, m.updated_at])) },
    { filename: "project_followups.csv", content: csv(["project", "title", "assigned_to", "due_on", "done", "done_at", "notes", "created_at"],
      tasks.map((t) => [ref.get(t.project_id) || t.project_id, t.title, teamName.get(t.assigned_to) || "", t.due_on, t.done, t.done_at, t.notes, t.created_at])) },
    { filename: "project_history.csv", content: csv(["project", "at", "by", "event", "detail"],
      events.map((e) => [ref.get(e.project_id) || e.project_id, e.at, e.actor_name, e.kind, e.detail])) },
  ];
  return {
    files,
    counts: { inquiries: inquiries.length, projects: projects.length, notes: notes.length, matched: matched.length, followups: tasks.length, history: events.length },
  };
}

// Emails the export to active founders only. Throws if no founder received it,
// so the run shows as failed in the Netlify logs.
export async function sendSalesExport(svc: SupabaseClient, trigger: string): Promise<{ sent: number; counts: Record<string, number> }> {
  const { files, counts } = await buildSalesExport(svc);
  const { data: founders, error } = await svc.from("team_members").select("name, email").eq("active", true).eq("role", "founder");
  if (error) throw new Error("team_members: " + error.message);
  const day = new Date().toISOString().slice(0, 10);
  const prefixed = files.map((f) => ({ filename: `meet-${day}-${f.filename}`, content: f.content }));
  let sent = 0;
  for (const f of founders || []) {
    try {
      await sendMail(f.email, `M.E.E.T. inquiries and sales export, ${day}`, renderMail({
        preheader: `${counts.inquiries} inquiries and ${counts.projects} project requests, as CSV files.`,
        paragraphs: [
          `Dear ${esc(firstName(f.name))},`,
          `Attached is the ${trigger === "schedule" ? "weekly" : "requested"} copy of M.E.E.T.'s inquiry and sales records: ` +
            `${counts.inquiries} inquiries, ${counts.projects} project requests, ${counts.notes} internal notes, ` +
            `${counts.matched} matched artists, ${counts.followups} follow-ups and ${counts.history} history entries.`,
          "These files contain clients' contact details, internal notes and revenue records. Keep this email private and do not forward it.",
          "This is a copy of the records, not a full database backup.",
        ],
        cta: { label: "Open the Sales dashboard", url: `${siteUrl()}/team#/projects` },
      }), prefixed);
      sent++;
    } catch (err) { console.error("export email failed", f.email, err); }
  }
  if (!sent) throw new Error("The export could not be emailed to any founder.");
  console.log("Sales export sent", JSON.stringify({ trigger, sent, counts }));
  return { sent, counts };
}

/* ---------------------------- follow-up reminders ---------------------------- */

// Emails each person their follow-ups that are due today or overdue, at most
// once a day per follow-up (reminded_on).
export async function runFollowupReminders(svc: SupabaseClient, trigger: string): Promise<{ due: number; emailed: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: tasks, error } = await svc.from("project_tasks")
    .select("id, title, due_on, assigned_to, project_id, reminded_on, project_requests(reference, client_name, client_organization)")
    .eq("done", false).lte("due_on", today);
  if (error) throw new Error("project_tasks: " + error.message);
  const due = (tasks || []).filter((t) => t.assigned_to && t.reminded_on !== today);
  if (!due.length) { console.log("Follow-up reminders: nothing due", JSON.stringify({ trigger })); return { due: 0, emailed: 0 }; }

  const { data: team } = await svc.from("team_members").select("user_id, name, email, active");
  const byPerson = new Map<string, typeof due>();
  for (const t of due) byPerson.set(t.assigned_to, [...(byPerson.get(t.assigned_to) || []), t]);

  let emailed = 0;
  for (const [uid, list] of byPerson) {
    const person = (team || []).find((m) => m.user_id === uid && m.active);
    if (!person) continue;
    const items = list.map((t) => {
      // deno-lint-ignore no-explicit-any
      const pr: any = t.project_requests || {};
      const late = t.due_on < today ? ` <b style="color:#7a1420">overdue since ${esc(t.due_on)}</b>` : " due today";
      return `• ${esc(t.title)} (${esc(pr.reference || "")}${pr.client_organization || pr.client_name ? ", " + esc(pr.client_organization || pr.client_name) : ""})${late}`;
    }).join("<br>");
    try {
      await sendMail(person.email, `Your M.E.E.T. follow-ups for today (${list.length})`, renderMail({
        preheader: `${list.length} follow-up${list.length === 1 ? "" : "s"} due today or overdue.`,
        paragraphs: [`Dear ${esc(firstName(person.name))},`, "These follow-ups are due today or overdue:", items],
        cta: { label: "Open my follow-ups", url: `${siteUrl()}/team#/followups` },
      }));
      await svc.from("project_tasks").update({ reminded_on: today }).in("id", list.map((t) => t.id));
      emailed++;
    } catch (err) { console.error("reminder failed", person.email, err); }
  }
  console.log("Follow-up reminders sent", JSON.stringify({ trigger, due: due.length, emailed }));
  return { due: due.length, emailed };
}
