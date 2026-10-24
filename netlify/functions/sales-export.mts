// Every Monday at 05:00 UTC, emails active founders a CSV copy of all inquiry
// and sales records (inquiries, project requests, notes, matched artists,
// follow-ups, history). Netlify scheduled function: see Netlify › Logs ›
// Functions › sales-export. Founders can also run it from /api/run-job.

import { serviceClient } from "../lib/server.ts";
import { sendSalesExport } from "../lib/jobs.ts";

export default async () => {
  try {
    const r = await sendSalesExport(serviceClient(), "schedule");
    return new Response(JSON.stringify(r));
  } catch (err) {
    console.error("Sales export FAILED", err);
    return new Response("error", { status: 500 });
  }
};

export const config = { schedule: "0 5 * * 1" };
