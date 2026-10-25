// Every Monday at 04:00 Lebanon time (Asia/Beirut), emails active founders a
// CSV copy of all inquiry and sales records (inquiries, project requests,
// notes, matched artists, follow-ups, history). Netlify schedules run in UTC
// and do not follow daylight saving, so this one function is triggered at
// 01:00 and 02:00 UTC on Mondays and sends only on the run that falls at
// 04:00 in Beirut (01:00 UTC in summer time, 02:00 UTC in winter time); the
// other run stops at once. See Netlify › Logs › Functions › sales-export.
// Founders can also send one at any time from /api/run-job.

import { serviceClient } from "../lib/server.ts";
import { sendSalesExport } from "../lib/jobs.ts";

function beirutHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hourCycle: "h23" }).format(d));
}

export default async () => {
  const hour = beirutHour(new Date());
  if (hour !== 4) {
    console.log(`Sales export skipped: it is ${hour}:00 in Beirut, the export runs at 04:00.`);
    return new Response(JSON.stringify({ skipped: true, beirut_hour: hour }));
  }
  try {
    const r = await sendSalesExport(serviceClient(), "schedule");
    return new Response(JSON.stringify(r));
  } catch (err) {
    console.error("Sales export FAILED", err);
    return new Response("error", { status: 500 });
  }
};

export const config = { schedule: "0 1,2 * * 1" };
