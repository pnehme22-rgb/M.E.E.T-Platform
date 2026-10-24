// Founders only: run a scheduled job now ("export" or "reminders"), for
// testing and for an extra export before a change. Same code as the schedule.

import { handle, teamCaller, readJson, json, HttpError, audit } from "../lib/server.ts";
import { sendSalesExport, runFollowupReminders } from "../lib/jobs.ts";

export default handle(async (req) => {
  const c = await teamCaller(req, { founder: true });
  const { job } = await readJson(req);
  try {
  if (job === "export") {
    const r = await sendSalesExport(c.svc, "manual");
    await audit(c, "job.export", "job", "sales-export", r.counts);
    return json(200, { ok: true, ...r });
  }
  if (job === "reminders") {
    const r = await runFollowupReminders(c.svc, "manual");
    await audit(c, "job.reminders", "job", "followup-reminders", r);
    return json(200, { ok: true, ...r });
  }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("run-job failed", job, err);
    throw new HttpError(502, "The job did not finish: " + (err instanceof Error ? err.message : "unknown error") + ". Nothing else was changed.");
  }
  throw new HttpError(400, "Unknown job.");
});

export const config = { path: "/api/run-job" };
