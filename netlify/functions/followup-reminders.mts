// Once a day (06:00 UTC), emails each sales team member a list of their
// follow-ups that are due today or overdue. Each task is included at most
// once a day (reminded_on). Runs as a Netlify scheduled function; it can be
// checked in Netlify > Logs > Functions > followup-reminders.

import { serviceClient, siteUrl, renderMail, sendMail, esc, firstName } from "../lib/server.ts";

export default async () => {
  const svc = serviceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: tasks, error } = await svc.from("project_tasks")
    .select("id, title, due_on, assigned_to, project_id, reminded_on, project_requests(reference, client_name, client_organization)")
    .eq("done", false).lte("due_on", today);
  if (error) { console.error(error); return new Response("error", { status: 500 }); }
  const due = (tasks || []).filter((t) => t.assigned_to && t.reminded_on !== today);
  if (!due.length) { console.log("No follow-ups due."); return new Response("ok"); }

  const { data: team } = await svc.from("team_members").select("user_id, name, email, active");
  const byPerson = new Map<string, typeof due>();
  for (const t of due) byPerson.set(t.assigned_to, [...(byPerson.get(t.assigned_to) || []), t]);

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
    } catch (err) { console.error("reminder failed", person.email, err); }
  }
  return new Response("ok");
};

export const config = { schedule: "0 6 * * *" };
