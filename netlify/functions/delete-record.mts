// Founders only: permanently removes an application, or an artist with
// everything they gave M.E.E.T. (profile, artworks, photographs, login and
// application). Used for privacy and deletion requests. The activity log keeps
// a note that a deletion happened, without the personal details.

import type { SupabaseClient } from "@supabase/supabase-js";
import { handle, teamCaller, readJson, json, HttpError, audit } from "../lib/server.ts";

const BUCKET = "artist-media";

// Lists every file under a folder of the private photo bucket.
async function listAll(svc: SupabaseClient, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await svc.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const item of data || []) {
    const path = `${prefix}/${item.name}`;
    // Folders come back without an id; files have one.
    if (item.id) out.push(path);
    else out.push(...(await listAll(svc, path)));
  }
  return out;
}

export default handle(async (req) => {
  const c = await teamCaller(req, { founder: true });
  const { type, id } = await readJson(req);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Unknown record.");

  if (type === "application") {
    const { data: app } = await c.svc.from("applications").select("id, reference, artist_id").eq("id", id).maybeSingle();
    if (!app) throw new HttpError(404, "This application has already been removed.");
    if (app.artist_id) {
      throw new HttpError(400, "This artist was approved and has a studio. Use “Delete artist and all their data” on their artist page instead.");
    }
    const { error } = await c.svc.from("applications").delete().eq("id", id);
    if (error) throw error;
    await audit(c, "application.deleted", "application", id, { reference: app.reference });
    return json(200, { ok: true });
  }

  if (type === "artist") {
    const { data: artist } = await c.svc.from("artists").select("id").eq("id", id).maybeSingle();
    if (!artist) throw new HttpError(404, "This artist has already been removed.");

    // 1. Photographs
    const files = await listAll(c.svc, id);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await c.svc.storage.from(BUCKET).remove(files.slice(i, i + 100));
      if (error) throw error;
    }
    // 2. Studio (artworks go with it) and their application(s)
    const { data: apps } = await c.svc.from("applications").select("reference").eq("artist_id", id);
    const { error: e1 } = await c.svc.from("artists").delete().eq("id", id);
    if (e1) throw e1;
    const { error: e2 } = await c.svc.from("applications").delete().eq("artist_id", id);
    if (e2) throw e2;
    // 3. Their login, unless the same login is also a team member
    const { data: member } = await c.svc.from("team_members").select("user_id").eq("user_id", id).maybeSingle();
    if (!member) {
      const { error: e3 } = await c.svc.auth.admin.deleteUser(id);
      if (e3) throw e3;
    }
    await audit(c, "artist.deleted", "artist", id, {
      references: (apps || []).map((a) => a.reference), photos_removed: files.length, login_removed: !member,
    });
    return json(200, { ok: true, photos_removed: files.length });
  }

  throw new HttpError(400, "Unknown record.");
});

export const config = { path: "/api/delete-record" };
