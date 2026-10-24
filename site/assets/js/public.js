/* M.E.E.T. public discovery: shared reading helpers for the Artists
   directory, artist profiles, artwork pages and the homepage selection.
   Visitors read only the database's public views (approved artists and
   approved artworks, safe columns only) and the photographs that belong to
   them. A signed-in member can also send an inquiry to an artist. */
(function () {
  "use strict";

  var CFG = window.MEET_CONFIG || {};
  // Shares the sign-in of the account pages (same storage key), so a signed-in
  // member can send an inquiry from an artist profile.
  var sb = CFG.supabaseUrl && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "meet-auth" }
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

  // The signed-in person's member account, if any (null for visitors).
  async function member() {
    if (!sb) return { session: null, account: null };
    var s = (await sb.auth.getSession()).data.session;
    if (!s) return { session: null, account: null };
    var r = await sb.from("member_accounts").select("id, account_type, full_name, country").eq("id", s.user.id).maybeSingle();
    return { session: s, account: r.data || null };
  }

  async function api(name, body) {
    var s = sb && (await sb.auth.getSession()).data.session;
    if (!s) throw new Error("Please sign in again.");
    var res = await fetch("/api/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.access_token },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) throw new Error(data.message || "Something went wrong. Please try again.");
    return data;
  }

  function money(amount, currency) {
    try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency, currencyDisplay: "code", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount); }
    catch (e) { return currency + " " + Number(amount).toLocaleString("en-GB"); }
  }

  window.MEET_PUBLIC = {
    member: member, api: api, money: money,
    sb: sb, esc: esc, terms: terms, signUrls: signUrls, dims: dims, place: place,
    artistUrl: artistUrl, artworkUrl: artworkUrl, idFromPath: idFromPath
  };
})();
