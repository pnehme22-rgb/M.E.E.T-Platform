/* M.E.E.T. account area: shared connection, session checks and helpers.
   Loaded after supabase-js and config.js on /signin, /welcome, /reset,
   /team and /studio. */
(function () {
  "use strict";

  var CFG = window.MEET_CONFIG || {};
  var configured = CFG.supabaseUrl && CFG.supabaseAnonKey && CFG.supabaseUrl.indexOf("YOUR-") === -1;

  var sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "meet-auth" }
  }) : null;

  var LOGO = '<svg viewBox="0 0 119 80" aria-hidden="true"><path d="M59.5 8.56 A37 37 0 0 1 59.5 71.44 A37 37 0 0 1 59.5 8.56 Z" fill="#74191d"/>' +
    '<circle cx="40" cy="40" r="37" fill="none" stroke="#11306a" stroke-width="4.5"/><circle cx="79" cy="40" r="37" fill="none" stroke="#11306a" stroke-width="4.5"/></svg>';

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(iso, withTime) {
    if (!iso) return "";
    var d = new Date(iso);
    var opt = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) { opt.hour = "2-digit"; opt.minute = "2-digit"; }
    return d.toLocaleString("en-GB", opt);
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    var mins = (Date.now() - new Date(iso).getTime()) / 60000;
    if (mins < 1) return "just now";
    if (mins < 60) return Math.round(mins) + " min ago";
    if (mins < 60 * 24) return Math.round(mins / 60) + " h ago";
    var days = Math.round(mins / 1440);
    if (days < 14) return days === 1 ? "yesterday" : days + " days ago";
    return fmtDate(iso);
  }

  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
  }

  var toastTimer;
  function toast(text) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = text;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, 4200);
  }

  function friendlyError(err) {
    var m = (err && (err.message || err.error_description || err.error)) || String(err || "");
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "We could not reach the server. Please check your connection and try again.";
    if (/JWT|expired|not authenticated/i.test(m)) return "Your session has ended. Please sign in again.";
    if (/^Please complete the security check/.test(m)) return m;
    if (/captcha/i.test(m)) return "The security check did not pass. Please wait a moment and try again.";
    if (/not allowed|permission|42501/i.test(m)) return "Your account does not have permission to do this.";
    return m || "Something went wrong. Please try again.";
  }

  /* The team-only /prototype copy is checked by a Netlify edge function,
     which reads this short-lived cookie. It is scoped to /prototype only. */
  function setGateCookie(session) {
    if (!session) return;
    document.cookie = "meet-session=" + session.access_token + "; Path=/prototype; Max-Age=3600; SameSite=Strict" +
      (location.protocol === "https:" ? "; Secure" : "");
  }
  function clearGateCookie() {
    document.cookie = "meet-session=; Path=/prototype; Max-Age=0; SameSite=Strict";
  }

  async function session() {
    if (!sb) return null;
    var r = await sb.auth.getSession();
    return r.data.session;
  }

  /* A navigation hint for the public pages: which workspace this browser's
     sign-in belongs to. It only changes links in the public header; every
     private page still checks access with the server. */
  var HOME_KEY = "meet-home";
  function rememberHome(me) {
    try {
      if (!me) { localStorage.removeItem(HOME_KEY); return; }
      var home = me.role ? { href: "/team", label: "Team console", kind: "team" }
        : me.artist ? { href: "/studio", label: "My studio", kind: "artist" }
        : me.account ? { href: "/account", label: "My account", kind: "member" } : null;
      if (home) localStorage.setItem(HOME_KEY, JSON.stringify(home)); else localStorage.removeItem(HOME_KEY);
    } catch (e) { /* storage unavailable: the header simply shows Sign in */ }
  }

  /* Who is signed in, and what may they open? */
  async function whoAmI() {
    var s = await session();
    if (!s) { rememberHome(null); return null; }
    var roleRes = await sb.rpc("my_role");
    var artistRes = await sb.from("artists").select("id, display_name, avatar_path").eq("id", s.user.id).maybeSingle();
    // Personal, Professional or Business & Organization member account, if any.
    var accountRes = await sb.from("member_accounts").select("*").eq("id", s.user.id).maybeSingle();
    var member = null, confirmed = false;
    if (roleRes.data) {
      var c = await sb.rpc("session_confirmed");
      confirmed = c.data === true;
      var m = await sb.from("team_members").select("user_id, name, email, role").eq("user_id", s.user.id).maybeSingle();
      member = m.data || { user_id: s.user.id, name: s.user.email, role: roleRes.data };
    }
    var me = {
      session: s,
      user: s.user,
      role: roleRes.data || null,
      member: member,
      artist: artistRes.data || null,
      account: accountRes.data || null,
      confirmed: confirmed
    };
    rememberHome(me);
    return me;
  }

  async function requireTeam() {
    if (!sb) { location.replace("/signin?setup=1"); return null; }
    var me = await whoAmI();
    if (!me) { location.replace("/signin?next=" + encodeURIComponent(location.pathname + location.hash)); return null; }
    if (!me.role) { location.replace(me.artist ? "/studio" : "/signin?noaccess=1"); return null; }
    if (!me.confirmed) { location.replace("/signin?step=code&next=" + encodeURIComponent(location.pathname + location.hash)); return null; }
    setGateCookie(me.session);
    return me;
  }

  async function requireArtist() {
    if (!sb) { location.replace("/signin?setup=1"); return null; }
    var me = await whoAmI();
    if (!me) { location.replace("/signin?next=/studio"); return null; }
    if (!me.artist) { location.replace(me.role ? "/team" : "/signin?noaccess=1"); return null; }
    return me;
  }

  /* Where should this person go after signing in? */
  async function routeAfterSignIn(next) {
    var me = await whoAmI();
    if (!me) return "/signin";
    if (me.role) {
      if (!me.confirmed) return "/signin?step=code" + (next ? "&next=" + encodeURIComponent(next) : "");
      // Only send team members on to their own private areas, never to an outside address.
      var safe = next && /^\/(team|prototype)(\/|#|$)/.test(next);
      return safe ? next : "/team";
    }
    if (me.artist) return "/studio";
    // Members may return to the artist profile they were inquiring from.
    if (me.account) return next && /^\/(artists\/[0-9a-f-]{36}|account)([?#][\w=&#%-]*)?$/i.test(next) ? next : "/account";
    return null;
  }

  async function requireAccount() {
    if (!sb) { location.replace("/signin?setup=1"); return null; }
    var me = await whoAmI();
    if (!me) { location.replace("/signin?next=/account"); return null; }
    if (!me.account) { location.replace(me.role ? "/team" : me.artist ? "/studio" : "/signin?noaccess=1"); return null; }
    return me;
  }

  async function signOut() {
    clearGateCookie();
    rememberHome(null);
    if (sb) await sb.auth.signOut();
    location.replace("/signin?out=1");
  }

  /* Calls a Netlify function as the signed-in person. */
  async function api(name, body) {
    var s = await session();
    if (!s) throw new Error("Your session has ended. Please sign in again.");
    var res = await fetch("/api/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.access_token },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) throw new Error(data.message || "Something went wrong. Please try again.");
    return data;
  }

  /* Private photos are served through short-lived signed links. */
  var urlCache = {};
  async function mediaUrl(path) {
    if (!path) return "";
    var hit = urlCache[path];
    if (hit && hit.until > Date.now()) return hit.url;
    var r = await sb.storage.from("artist-media").createSignedUrl(path, 3600);
    if (r.error) return "";
    urlCache[path] = { url: r.data.signedUrl, until: Date.now() + 50 * 60 * 1000 };
    return r.data.signedUrl;
  }
  async function hydrateMedia(root) {
    var nodes = (root || document).querySelectorAll("img[data-media]");
    await Promise.all(Array.prototype.map.call(nodes, async function (img) {
      var url = await mediaUrl(img.getAttribute("data-media"));
      if (url) img.src = url;
    }));
  }

  /* Shrinks a photo on the device before upload: max 2400 px, JPEG. Keeps
     uploads quick on phones and turns iPhone photos into a format every
     browser can show. */
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "image/")) { reject(new Error("Please choose a photograph (JPEG, PNG or WebP).")); return; }
      if (file.size > 40 * 1024 * 1024) { reject(new Error("This photograph is too large. Please choose one under 40 MB.")); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 2400;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error("This photograph could not be read. Please try another one.")); return; }
          resolve(blob);
        }, "image/jpeg", 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("This photograph could not be read. Please try a JPEG or PNG.")); };
      img.src = url;
    });
  }

  async function uploadImage(file, path) {
    var blob = await prepareImage(file);
    if (blob.size > 10 * 1024 * 1024) throw new Error("This photograph is still too large after resizing. Please choose another one.");
    var r = await sb.storage.from("artist-media").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (r.error) throw r.error;
    return path;
  }

  function modal(html, onReady) {
    var back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + "</div>";
    var last = document.activeElement;
    function close() { back.remove(); document.removeEventListener("keydown", onKey); if (last && last.focus) last.focus(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    var first = back.querySelector("textarea, input, select, button:not([data-close])");
    if (first) first.focus();
    if (onReady) onReady(back.querySelector(".modal"), close);
    return close;
  }

  /* Bot protection (Cloudflare Turnstile) for sign-up, sign-in, password reset
     and confirmation emails. Supabase checks the token on its servers. With no
     site key configured, nothing is loaded and no token is sent. */
  var turnstileReady = null;
  function loadTurnstile() {
    if (turnstileReady) return turnstileReady;
    turnstileReady = new Promise(function (resolve, reject) {
      window.onMeetTurnstile = function () { resolve(window.turnstile); };
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onMeetTurnstile&render=explicit";
      s.async = true;
      s.onerror = function () { reject(new Error("The security check could not load. Please check your connection, or turn off a blocker for this page, and try again.")); };
      document.head.appendChild(s);
    });
    return turnstileReady;
  }
  function captcha(el) {
    var key = CFG.turnstileSiteKey;
    if (!key || !el) return { enabled: false, token: function () { return Promise.resolve(undefined); }, reset: function () {} };
    var id = null, current = null, waiting = [], failed = null;
    function settle(t) { current = t; waiting.splice(0).forEach(function (w) { w(t); }); }
    loadTurnstile().then(function (ts) {
      id = ts.render(el, {
        sitekey: key, appearance: "interaction-only", theme: "light", "refresh-expired": "auto",
        callback: settle,
        "expired-callback": function () { current = null; },
        "error-callback": function () { current = null; }
      });
    }).catch(function (err) { failed = err; });
    return {
      enabled: true,
      token: function () {
        if (failed) return Promise.reject(failed);
        if (current) return Promise.resolve(current);
        return new Promise(function (resolve, reject) {
          waiting.push(resolve);
          setTimeout(function () { reject(new Error("Please complete the security check just above the button (tick the box if one appears), then press the button again.")); }, 20000);
        });
      },
      // Tokens work once: get a fresh one after every request.
      reset: function () { current = null; if (id !== null && window.turnstile) window.turnstile.reset(id); }
    };
  }

  function setBusy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Working"; btn.classList.add("busy"); btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.classList.remove("busy"); btn.disabled = false; }
  }

  if (sb) {
    sb.auth.onAuthStateChange(function (event, s) {
      if (event === "TOKEN_REFRESHED" && s && document.cookie.indexOf("meet-session=") !== -1) setGateCookie(s);
      if (event === "SIGNED_OUT") { clearGateCookie(); rememberHome(null); }
    });
  }

  window.MEET = {
    sb: sb, configured: !!configured, LOGO: LOGO,
    esc: esc, fmtDate: fmtDate, fmtWhen: fmtWhen, initials: initials, toast: toast, friendlyError: friendlyError,
    session: session, whoAmI: whoAmI, requireTeam: requireTeam, requireArtist: requireArtist, requireAccount: requireAccount,
    routeAfterSignIn: routeAfterSignIn, signOut: signOut, api: api,
    setGateCookie: setGateCookie, mediaUrl: mediaUrl, hydrateMedia: hydrateMedia, uploadImage: uploadImage,
    modal: modal, setBusy: setBusy, captcha: captcha
  };
})();
