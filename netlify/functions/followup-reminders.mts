// Once a day (06:00 UTC), emails each sales team member their follow-ups that
// are due today or overdue. Netlify scheduled function: see Netlify › Logs ›
// Functions › followup-reminders. Founders can also run it from /api/run-job.

import { serviceClient } from "../lib/server.ts";
import { runFollowupReminders } from "../lib/jobs.ts";

export default async () => {
  try {
    const r = await runFollowupReminders(serviceClient(), "schedule");
    return new Response(JSON.stringify(r));
  } catch (err) {
    console.error("Follow-up reminders FAILED", err);
    return new Response("error", { status: 500 });
  }
};

export const config = { schedule: "0 6 * * *" };
