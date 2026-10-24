/* M.E.E.T. public discovery: shared reading helpers for the Artists
   directory, artist profiles, artwork pages and the homepage selection.
   Visitors read only the database's public views (approved artists and
   approved artworks, safe columns only) and the photographs that belong to
   them. No sign-in, nothing private. */
(function () {
  "use strict";

  var CFG = window.MEET_CONFIG || {};
  var sb = CFG.supabaseUrl && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  }) : null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // "Wheel throwing, glazing; raku" -> ["Wheel throwing", "Glazing", "Raku"]
  function terms(text) {
    var seen = {}, out = [];
    String(text || "").split(/[,;\/\n·•|]+/).forEach(function (t) {
      t = t.replace(/\s+/g, " ").replace(/^[\s.\-–]+|[\s.\-–]+$/g, "");
      if (t.length < 2 || t.length > 60) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(t.charAt(0).toUpperCase() + t.slice(1));
    });
    return out;
  }

  // Short-lived links for public photographs, fetched in one request.
  async function signUrls(paths) {
    var list = paths.filter(Boolean).filter(function (p, i, a) { return a.indexOf(p) === i; });
    var map = {};
    if (!sb || !list.length) return map;
    for (var i = 0; i < list.length; i += 100) {
      var r = await sb.storage.from("artist-media").createSignedUrls(list.slice(i, i + 100), 3600);
      (r.data || []).forEach(function (x) { if (x.signedUrl && !x.error) map[x.path] = x.signedUrl; });
    }
    return map;
  }

  function dims(w) {
    var parts = [w.height, w.width, w.depth].filter(function (n) { return n != null && n !== ""; });
    if (!parts.length) return "";
    return parts.map(function (n) { return String(+n); }).join(" × ") + " " + (w.unit || "cm");
  }

  function place(a) { return [a.city, a.country].filter(Boolean).join(", "); }
  function artistUrl(id) { return "/artists/" + encodeURIComponent(id); }
  function artworkUrl(id) { return "/artworks/" + encodeURIComponent(id); }

  // /artists/<id>, or ?id=<id> when previewing the plain file.
  function idFromPath(prefix) {
    var m = location.pathname.match(new RegExp("^/" + prefix + "/([0-9a-f-]{36})/?$", "i"));
    var id = m ? m[1] : new URLSearchParams(location.search).get("id") || "";
    return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : "";
  }

  window.MEET_PUBLIC = {
    sb: sb, esc: esc, terms: terms, signUrls: signUrls, dims: dims, place: place,
    artistUrl: artistUrl, artworkUrl: artworkUrl, idFromPath: idFromPath
  };
})();
