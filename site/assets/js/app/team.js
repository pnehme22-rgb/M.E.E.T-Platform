/* M.E.E.T. team console: applications, artists, team, activity.
   Every read and write goes through the signed-in team member's session, so
   the database's row level security decides what is allowed. Approvals and
   emails go through Netlify functions (/api/...). */
(function () {
  "use strict";
  var M = window.MEET, sb, me, canEdit;
  var esc = M.esc;
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");
  var cache = { team: [] };

  var APP_STATUS = {
    new: ["New", "red"], in_review: ["In review", "blue"], more_info: ["More information requested", "warn"],
    approved: ["Approved", "ok"], declined: ["Declined", ""]
  };
  var REVIEW_STATUS = {
    draft: ["Draft", ""], submitted: ["Waiting for review", "red"], changes_requested: ["Changes requested", "warn"],
    approved: ["Approved", "ok"], declined: ["Declined", ""]
  };
  // Where a registration came from (the ?from=... marker on links and the QR card).
  var SOURCES = { "qr-dubai": "QR code (Dubai)", "instagram": "Instagram link", "email": "Email link", "website": "Website" };
  function sourceLabel(v) { return v ? (SOURCES[v] || v) : ""; }

  function tag(map, s) { var t = map[s] || [s, ""]; return '<span class="tag ' + t[1] + '">' + esc(t[0]) + "</span>"; }
  function teamName(id) { var t = cache.team.find(function (m) { return m.user_id === id; }); return t ? t.name : ""; }
  function discipline(a) { return a.primary_discipline === "Other" && a.discipline_other ? a.discipline_other : a.primary_discipline; }
  function place(a) { return [a.city, a.country].filter(Boolean).join(", "); }
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || "there"; }
  function fail(err) { M.toast(M.friendlyError(err)); }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  async function counts() {
    var a = await sb.from("applications").select("status");
    var p = await sb.from("artists").select("profile_status");
    var w = await sb.from("artworks").select("status");
    var c = { apps: {}, profiles: 0, works: 0 };
    (a.data || []).forEach(function (r) { c.apps[r.status] = (c.apps[r.status] || 0) + 1; });
    c.profiles = (p.data || []).filter(function (r) { return r.profile_status === "submitted"; }).length;
    c.works = (w.data || []).filter(function (r) { return r.status === "submitted"; }).length;
    c.artists = (p.data || []).length;
    return c;
  }

  async function renderNav(current) {
    var c = await counts();
    var items = [
      ["overview", "Overview", 0],
      ["applications", "Applications", (c.apps.new || 0)],
      ["artists", "Artists", c.profiles + c.works],
      ["activity", "Activity log", 0]
    ];
    if (me.role === "founder") items.splice(3, 0, ["team", "Team", 0]);
    nav.innerHTML = '<p class="nav-l">Workspaces</p>' + items.map(function (i) {
      return '<a class="ni" href="#/' + i[0] + '"' + (current === i[0] ? ' aria-current="page"' : "") + ">" + esc(i[1]) +
        (i[2] ? '<span class="badge">' + i[2] + "</span>" : "") + "</a>";
    }).join("") +
      '<p class="nav-l">Private</p>' +
      '<a class="ni" href="/prototype/" target="_blank" rel="noopener">Platform prototype</a>' +
      '<a class="ni" href="/" target="_blank" rel="noopener">Public website</a>';
    return c;
  }

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "") || "overview";
    var q = "";
    var i = h.indexOf("?");
    if (i !== -1) { q = h.slice(i + 1); h = h.slice(0, i); }
    var parts = h.split("/");
    return { view: parts[0], id: parts[1] || "", q: new URLSearchParams(q) };
  }

  async function route() {
    var r = parseHash();
    var section = { application: "applications", artist: "artists" }[r.view] || r.view;
    main.onclick = null;
    try {
      var c = await renderNav(section);
      if (r.view === "overview") await viewOverview(c);
      else if (r.view === "applications") await viewApplications(r.q);
      else if (r.view === "application") await viewApplication(r.id);
      else if (r.view === "artists") await viewArtists(r.q);
      else if (r.view === "artist") await viewArtist(r.id);
      else if (r.view === "team" && me.role === "founder") await viewTeam();
      else if (r.view === "activity") await viewActivity();
      else location.hash = "#/overview";
    } catch (err) {
      main.innerHTML = '<div class="empty">This page could not be loaded. ' + esc(M.friendlyError(err)) + "</div>";
    }
    main.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* Overview                                                            */
  /* ------------------------------------------------------------------ */

  async function viewOverview(c) {
    var recent = await sb.from("applications").select("id, reference, created_at, status, full_name, artist_name, country, city, primary_discipline, discipline_other")
      .order("created_at", { ascending: false }).limit(6);
    var hour = new Date().getHours();
    var greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    main.innerHTML =
      '<div class="head"><div><span class="muted small">' + esc(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) + "</span>" +
      "<h1>" + greet + ", <em>" + esc(firstName(me.member.name)) + "</em></h1></div></div>" +
      '<div class="kpis">' +
      kpi(c.apps.new || 0, "New applications", "#/applications?status=new") +
      kpi(c.apps.in_review || 0, "In review", "#/applications?status=in_review") +
      kpi(c.apps.more_info || 0, "Waiting on the artist", "#/applications?status=more_info") +
      kpi(c.apps.approved || 0, "Approved artists", "#/applications?status=approved") +
      kpi(c.profiles + c.works, "Studio items to review", "#/artists?filter=review") +
      "</div>" +
      '<section class="stack" style="gap:10px"><div class="between"><h2 style="font-size:30px">Latest applications</h2><a class="link small" href="#/applications">See all</a></div>' +
      appList(recent.data || []) + "</section>";
  }
  function kpi(n, label, href) { return '<a class="kpi" href="' + href + '"><b class="num">' + n + "</b><span>" + esc(label) + "</span></a>"; }

  function appList(rows) {
    if (!rows.length) return '<div class="empty">No applications here yet. New registrations appear the moment they are sent.</div>';
    return '<div class="list">' + rows.map(function (a) {
      return '<a class="lrow" href="#/application/' + a.id + '"><div class="lm"><b>' + esc(a.artist_name) + "</b>" +
        '<span class="muted small">' + esc(a.full_name) + " · " + esc(discipline(a)) + " · " + esc(place(a)) + "</span></div>" +
        '<div class="ls">' + tag(APP_STATUS, a.status) + '<span class="muted small">' + esc(M.fmtWhen(a.created_at)) + "</span></div></a>";
    }).join("") + "</div>";
  }

  /* ------------------------------------------------------------------ */
  /* Applications                                                        */
  /* ------------------------------------------------------------------ */

  async function viewApplications(q) {
    var status = q.get("status") || "";
    var term = (q.get("q") || "").trim();
    var res = await sb.from("applications").select("id, reference, created_at, status, full_name, artist_name, email, country, city, primary_discipline, discipline_other, reviewer, possible_duplicate")
      .order("created_at", { ascending: false }).limit(5000);
    if (res.error) throw res.error;
    var all = res.data || [];
    var rows = all.filter(function (a) {
      if (status && a.status !== status) return false;
      if (!term) return true;
      var hay = [a.reference, a.full_name, a.artist_name, a.email, a.country, a.city, a.primary_discipline, a.discipline_other].join(" ").toLowerCase();
      return hay.indexOf(term.toLowerCase()) !== -1;
    });
    var chips = [["", "All"], ["new", "New"], ["in_review", "In review"], ["more_info", "More information"], ["approved", "Approved"], ["declined", "Declined"]];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Artist applications</span><h1>Applications</h1>' +
      "<p>Every registration from the public form, newest first. Open one to review it, add notes and decide.</p></div>" +
      '<div class="row"><button class="btn line sm" type="button" id="export">Export CSV</button></div></div>' +
      '<div class="filters"><div class="chips" role="group" aria-label="Filter by status">' + chips.map(function (c) {
        var n = c[0] ? all.filter(function (a) { return a.status === c[0]; }).length : all.length;
        return '<button class="chip" type="button" data-status="' + c[0] + '" aria-pressed="' + (status === c[0]) + '">' + esc(c[1]) + " · " + n + "</button>";
      }).join("") + "</div>" +
      '<label class="visually-hidden" for="search">Search applications</label><input class="inp search" id="search" type="search" placeholder="Search name, city, discipline, reference" value="' + esc(term) + '"></div>' +
      appList(rows);

    function go(s, t) {
      var p = new URLSearchParams();
      if (s) p.set("status", s);
      if (t) p.set("q", t);
      location.hash = "#/applications" + (p.toString() ? "?" + p.toString() : "");
    }
    main.querySelectorAll("[data-status]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-status"), term); });
    });
    var timer;
    var search = document.getElementById("search");
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { go(status, search.value.trim()); setTimeout(function () { var s = document.getElementById("search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 50); }, 400);
    });
    document.getElementById("export").addEventListener("click", exportCsv);
  }

  async function exportCsv() {
    var res = await sb.from("applications").select("*").order("created_at", { ascending: false }).limit(10000);
    if (res.error) { fail(res.error); return; }
    var cols = ["reference", "created_at", "status", "full_name", "artist_name", "email", "country", "city", "primary_discipline",
      "discipline_other", "practice", "website", "social", "additional_disciplines", "techniques", "interest_commissions",
      "interest_collaboration", "portfolio_links", "heard_about", "source", "possible_duplicate", "reviewer", "decided_at", "decision_note",
      "invited_at", "consent_version", "consent_at"];
    // Neutralise spreadsheet formulas in anything a visitor typed.
    function safe(v) {
      if (Array.isArray(v)) v = v.join("\n");
      if (v === null || v === undefined) v = "";
      v = String(v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    }
    var lines = [cols.join(",")].concat(res.data.map(function (r) {
      return cols.map(function (c) { return safe(c === "reviewer" ? teamName(r.reviewer) : r[c]); }).join(",");
    }));
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "meet-applications-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    M.toast("CSV downloaded: " + res.data.length + " applications.");
  }

  function csvCell(v) {
    if (Array.isArray(v)) v = v.join("\n");
    if (v === null || v === undefined) v = "";
    v = String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;   // never let a value act as a spreadsheet formula
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function downloadCsv(name, header, rows) {
    var blob = new Blob(["\ufeff" + [header.join(",")].concat(rows.map(function (r) { return r.map(csvCell).join(","); })).join("\r\n")], { type: "text/csv;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
  }

  async function exportArtistsCsv() {
    var ar = await sb.from("artists").select("*").order("created_at", { ascending: true });
    if (ar.error) { fail(ar.error); return; }
    var wr = await sb.from("artworks").select("artist_id, status");
    var ap = await sb.from("applications").select("id, reference");
    var refs = {};
    (ap.data || []).forEach(function (x) { refs[x.id] = x.reference; });
    var count = {};
    (wr.data || []).forEach(function (w) {
      var c = count[w.artist_id] = count[w.artist_id] || { all: 0, approved: 0, waiting: 0 };
      c.all++; if (w.status === "approved") c.approved++; if (w.status === "submitted") c.waiting++;
    });
    var header = ["reference", "display_name", "legal_name", "email", "country", "city", "main_discipline", "other_disciplines",
      "techniques", "instagram", "website", "profile_status", "works_total", "works_approved", "works_waiting", "terms_agreed", "studio_created"];
    var rows = (ar.data || []).map(function (a) {
      var c = count[a.id] || { all: 0, approved: 0, waiting: 0 };
      return [refs[a.application_id] || "", a.display_name, a.legal_name, a.email, a.country, a.city, a.craft, a.other_disciplines,
        a.techniques, a.instagram, a.website, (REVIEW_STATUS[a.profile_status] || [a.profile_status])[0], c.all, c.approved, c.waiting,
        a.terms_accepted_at || "", a.created_at];
    });
    downloadCsv("meet-artists", header, rows);
    M.toast("CSV downloaded: " + rows.length + " artists.");
  }

  function welcomePreview(a) {
    return '<div class="mail-preview"><p><b>Subject:</b> Welcome to M.E.E.T., ' + esc(a.artist_name) + "</p><hr style=\"border:0;border-top:1px solid #eee\">" +
      "<p>Dear " + esc(firstName(a.full_name)) + ",</p>" +
      "<p>Thank you for sharing your work with us. We are delighted to tell you that your application to M.E.E.T. has been approved, and we warmly welcome you to the community.</p>" +
      "<p>Your next step is to open your studio. Set your password with the button below, then add your profile and a few of your works. The M.E.E.T. team reviews each studio with care before it is shown to anyone.</p>" +
      '<p><span class="btn sm" style="pointer-events:none">Open my studio</span></p>' +
      "<p>For your security, this link works for 24 hours. If it expires, simply reply to this email and we will send you a new one.</p>" +
      "<p>With warm regards,<br>The M.E.E.T. team<br><i>Mind Exploring Every Tradition</i></p></div>";
  }

  async function viewApplication(id) {
    var res = await sb.from("applications").select("*").eq("id", id).maybeSingle();
    if (res.error) throw res.error;
    var a = res.data;
    if (!a) { main.innerHTML = '<div class="empty">This application could not be found. <a class="link" href="#/applications">Back to applications</a></div>'; return; }
    var notes = await sb.from("application_notes").select("id, body, created_at, author").eq("application_id", id).order("created_at", { ascending: true });
    var hist = await sb.from("audit_log").select("at, actor_name, action, detail").eq("target_id", id).order("at", { ascending: false }).limit(50);
    var dupes = a.possible_duplicate ? await sb.from("applications").select("id, reference, created_at, status").ilike("email", a.email).neq("id", id) : { data: [] };

    var links = (a.portfolio_links || []).map(function (l) { return '<a class="link" href="' + esc(l) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(l.replace(/^https?:\/\//, "")) + "</a>"; }).join("<br>");
    var socialHtml = a.social ? (/^https?:\/\//.test(a.social) ? '<a class="link" href="' + esc(a.social) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(a.social) + "</a>" : esc(a.social)) : "";
    var interests = [a.interest_commissions ? "Commission enquiries" : "", a.interest_collaboration ? "Cross-disciplinary collaboration" : ""].filter(Boolean).join(", ");

    var decision = "";
    if (canEdit) {
      if (a.status === "approved") {
        decision = '<p class="small">Approved ' + esc(M.fmtDate(a.decided_at)) + (a.decided_by ? " by " + esc(teamName(a.decided_by)) : "") + ".</p>" +
          (a.invited_at ? '<p class="small muted">Studio link sent ' + esc(M.fmtDate(a.invited_at, true)) + ".</p>" : "") +
          (a.artist_id ? '<a class="btn navy sm" href="#/artist/' + a.artist_id + '">Open their studio</a>' : "") +
          '<button class="btn line sm" type="button" data-act="approve">Send a new studio link</button>';
      } else {
        decision = (a.status === "new" ? '<button class="btn line" type="button" data-act="start">Start review</button>' : "") +
          '<button class="btn" type="button" data-act="approve">Approve and invite</button>' +
          '<button class="btn line" type="button" data-act="info">Ask for more information</button>' +
          (a.status === "declined" ? '<button class="btn line" type="button" data-act="reopen">Reopen</button>' : '<button class="btn danger" type="button" data-act="decline">Decline</button>');
      }
    } else {
      decision = '<p class="small muted">Your role can view applications but not change them.</p>';
    }

    main.innerHTML =
      '<a class="link small" href="#/applications">Back to applications</a>' +
      '<div class="head"><div><span class="eyebrow">Application ' + esc(a.reference) + " · " + esc(M.fmtWhen(a.created_at)) + "</span>" +
      "<h1>" + esc(a.artist_name) + "</h1><p>" + esc(a.full_name) + " · " + esc(discipline(a)) + " · " + esc(place(a)) + "</p></div>" +
      '<div class="row">' + tag(APP_STATUS, a.status) + "</div></div>" +
      (a.possible_duplicate ? '<div class="notice warn">This email has applied before: ' + (dupes.data || []).map(function (d) {
        return '<a class="link" href="#/application/' + d.id + '">' + esc(d.reference) + "</a> (" + esc((APP_STATUS[d.status] || [d.status])[0]) + ")";
      }).join(", ") + ".</div>" : "") +
      '<div class="rgrid"><div class="stack">' +
      '<div class="rblock"><h3>Their practice</h3><p class="prose">' + esc(a.practice) + "</p></div>" +
      '<div class="rblock"><h3>Details</h3><div class="kv">' +
      "<span>Full name</span><b>" + esc(a.full_name) + "</b>" +
      "<span>Artist name</span><b>" + esc(a.artist_name) + "</b>" +
      '<span>Email</span><b><a class="link" href="mailto:' + esc(a.email) + '">' + esc(a.email) + "</a></b>" +
      "<span>Based in</span><b>" + esc(place(a)) + "</b>" +
      "<span>Main discipline</span><b>" + esc(discipline(a)) + "</b>" +
      (a.additional_disciplines ? "<span>Other disciplines</span><b>" + esc(a.additional_disciplines) + "</b>" : "") +
      (a.techniques ? "<span>Techniques and materials</span><b>" + esc(a.techniques) + "</b>" : "") +
      (a.website ? '<span>Website</span><b><a class="link" href="' + esc(a.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(a.website.replace(/^https?:\/\//, "")) + "</a></b>" : "") +
      (socialHtml ? "<span>Social profile</span><b>" + socialHtml + "</b>" : "") +
      (links ? "<span>More links</span><b>" + links + "</b>" : "") +
      (interests ? "<span>Open to</span><b>" + esc(interests) + "</b>" : "") +
      (a.heard_about ? "<span>Found M.E.E.T. through</span><b>" + esc(a.heard_about) + "</b>" : "") +
      (a.source ? "<span>Came from</span><b>" + esc(sourceLabel(a.source)) + "</b>" : "") +
      "<span>Consent</span><b>Privacy notice " + esc(a.consent_version) + ", " + esc(M.fmtDate(a.consent_at, true)) + "</b>" +
      "</div></div>" +
      '<div class="rblock"><h3>Team notes</h3><p class="small muted">Private to the team. The artist never sees these.</p>' +
      ((notes.data || []).map(function (n) {
        return '<div class="note"><span class="muted">' + esc(teamName(n.author) || "Team") + " · " + esc(M.fmtDate(n.created_at, true)) + "</span>" + esc(n.body).replace(/\n/g, "<br>") + "</div>";
      }).join("") || '<p class="small muted">No notes yet.</p>') +
      '<label class="f">Add a note<textarea class="inp" id="note" rows="3" maxlength="4000" placeholder="What you noticed, who you spoke to, what to check."></textarea></label>' +
      '<div class="row"><button class="btn line sm" type="button" data-act="note">Save note</button></div></div>' +
      "</div>" +
      '<aside class="raside">' +
      '<div class="panel stack" style="gap:12px"><h3 style="font-size:26px">Decision</h3>' +
      (a.decision_note && a.status !== "approved" ? '<div class="note"><span class="muted">' + (a.status === "more_info" ? "Question sent" : "Reason") + "</span>" + esc(a.decision_note) + "</div>" : "") +
      decision + "</div>" +
      (me.role === "founder" && !a.artist_id ? '<button class="link small" type="button" data-act="delete" style="align-self:flex-start;color:var(--accent)">Delete this application permanently</button>' : "") +
      '<div class="panel stack" style="gap:10px"><label class="f">Reviewer<select class="inp" id="reviewer"' + (canEdit ? "" : " disabled") + '><option value="">Unassigned</option>' +
      cache.team.filter(function (m) { return m.active; }).map(function (m) {
        return '<option value="' + m.user_id + '"' + (a.reviewer === m.user_id ? " selected" : "") + ">" + esc(m.name) + "</option>";
      }).join("") + "</select></label></div>" +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">History</h3><div class="timeline">' +
      ((hist.data || []).map(function (h) {
        return "<div><b>" + esc(actionLabel(h.action)) + "</b><br><span class=\"muted small\">" + esc(h.actor_name || "Team") + " · " + esc(M.fmtDate(h.at, true)) + "</span></div>";
      }).join("") || '<p class="small muted">Received ' + esc(M.fmtDate(a.created_at, true)) + ".</p>") +
      "</div></div></aside></div>";

    function reload() { viewApplication(id); renderNav("applications"); }

    main.querySelector("#reviewer").addEventListener("change", async function (e) {
      var r = await sb.rpc("assign_application", { p_id: id, p_reviewer: e.target.value || null });
      if (r.error) return fail(r.error);
      M.toast("Reviewer updated.");
      reload();
    });

    // One handler per render (assigning replaces the previous view's handler).
    main.onclick = async function (e) {
      var b = e.target.closest("[data-act]");
      if (!b || !main.contains(b)) return;
      var act = b.getAttribute("data-act");
      if (act === "note") {
        var body = main.querySelector("#note").value.trim();
        if (!body) { M.toast("Write a note first."); return; }
        M.setBusy(b, true, "Saving");
        var r = await sb.rpc("add_application_note", { p_id: id, p_body: body });
        M.setBusy(b, false);
        if (r.error) return fail(r.error);
        M.toast("Note saved.");
        reload();
      }
      if (act === "start") {
        var r2 = await sb.rpc("assign_application", { p_id: id, p_reviewer: me.user.id });
        if (r2.error) return fail(r2.error);
        reload();
      }
      if (act === "reopen") {
        var r3 = await sb.rpc("set_application_status", { p_id: id, p_status: "in_review", p_note: "" });
        if (r3.error) return fail(r3.error);
        reload();
      }
      if (act === "approve") openApprove(a, reload);
      if (act === "info") openInfo(a, reload);
      if (act === "decline") openDecline(a, reload);
      if (act === "delete") openDelete("application", a.id, a.artist_name, function () { location.hash = "#/applications"; });
    };
  }

  function actionLabel(a) {
    return ({
      "application.in_review": "Moved to review", "application.more_info": "More information requested",
      "application.declined": "Declined", "application.approved": "Approved and invited", "application.reinvited": "New studio link sent",
      "application.assign": "Reviewer changed", "application.note": "Note added",
      "profile.submit": "Profile submitted", "profile.approved": "Profile approved", "profile.changes_requested": "Changes requested on profile",
      "profile.declined": "Profile declined", "artwork.submit": "Artwork submitted", "artwork.approved": "Artwork approved",
      "artwork.changes_requested": "Changes requested on artwork", "artwork.declined": "Artwork declined",
      "team.invite": "Team member invited", "team.update": "Team member updated",
      "artist.terms_accepted": "Artist terms agreed", "artist.deleted": "Artist and their data deleted", "application.deleted": "Application deleted"
    })[a] || a;
  }

  function openApprove(a, done) {
    var again = a.status === "approved";
    M.modal(
      "<h2>" + (again ? "Send a new studio <em>link</em>" : "Approve <em>" + esc(a.artist_name) + "</em>") + "</h2>" +
      "<p class=\"muted\">" + (again
        ? "A fresh link will be emailed to " + esc(a.email) + ". The old one stops working."
        : "This creates their private studio and sends this email to " + esc(a.email) + " from minds.exploring.traditions@gmail.com.") + "</p>" +
      welcomePreview(a) +
      '<p class="err" id="m-err" hidden></p>' +
      '<div class="row"><button class="btn" type="button" id="m-go">' + (again ? "Send new link" : "Approve and send email") + '</button><button class="btn line" type="button" data-close>Cancel</button></div>',
      function (box, close) {
        box.querySelector("#m-go").addEventListener("click", async function () {
          var btn = this;
          M.setBusy(btn, true, "Sending");
          try {
            await M.api("approve-application", { id: a.id });
            close();
            M.toast(again ? "New link sent to " + a.email + "." : "Approved. Welcome email sent to " + a.email + ".");
            done();
          } catch (err) {
            M.setBusy(btn, false);
            var m = box.querySelector("#m-err");
            m.textContent = M.friendlyError(err);
            m.hidden = false;
          }
        });
      });
  }

  function openInfo(a, done) {
    M.modal(
      "<h2>Ask for more <em>information</em></h2>" +
      '<label class="f">Your question for ' + esc(firstName(a.full_name)) +
      '<textarea class="inp" id="m-q" rows="5" maxlength="4000" placeholder="For example: Could you share a few photographs of recent work, or a link where we can see it?"></textarea></label>' +
      '<label class="row small" style="font-weight:500"><input type="checkbox" id="m-mail" checked> Email this question to ' + esc(a.email) + " (they can reply directly)</label>" +
      '<p class="err" id="m-err" hidden></p>' +
      '<div class="row"><button class="btn" type="button" id="m-go">Save' + "</button><button class=\"btn line\" type=\"button\" data-close>Cancel</button></div>",
      function (box, close) {
        box.querySelector("#m-go").addEventListener("click", async function () {
          var q = box.querySelector("#m-q").value.trim();
          var m = box.querySelector("#m-err");
          if (q.length < 5) { m.textContent = "Please write the question first."; m.hidden = false; return; }
          var btn = this;
          M.setBusy(btn, true, "Saving");
          try {
            var notify = box.querySelector("#m-mail").checked;
            await M.api("request-info", { id: a.id, question: q, notify: notify });
            close();
            M.toast(notify ? "Question emailed to " + a.email + "." : "Saved. No email was sent.");
            done();
          } catch (err) { M.setBusy(btn, false); m.textContent = M.friendlyError(err); m.hidden = false; }
        });
      });
  }

  function declineMessage(a) {
    return "Dear " + firstName(a.full_name) + ",\n\n" +
      "Thank you for applying to M.E.E.T. and for sharing your practice with us. We read every application with care.\n\n" +
      "At this stage, we are not able to offer you a place in the first M.E.E.T. artist community. This is not a judgement of the value of your work: we are starting small, with a limited number of artists.\n\n" +
      "As M.E.E.T. grows, we may open new invitations, and we would be glad to hear from you again.";
  }

  function openDecline(a, done) {
    M.modal(
      "<h2>Decline <em>" + esc(a.artist_name) + "</em></h2>" +
      '<label class="f">Reason, for the team only<textarea class="inp" id="m-r" rows="3" maxlength="4000" placeholder="The artist never sees this."></textarea></label>' +
      '<label class="row small" style="font-weight:500"><input type="checkbox" id="m-mail" checked> Send a kind message to ' + esc(a.email) + "</label>" +
      '<label class="f" id="m-msg-box">Message to the artist <span class="hint">You can edit it. It is signed “With warm regards, The M.E.E.T. team”.</span>' +
      '<textarea class="inp" id="m-msg" rows="9" maxlength="4000">' + esc(declineMessage(a)) + "</textarea></label>" +
      '<p class="err" id="m-err" hidden></p>' +
      '<div class="row"><button class="btn danger" type="button" id="m-go">Decline application</button><button class="btn line" type="button" data-close>Cancel</button></div>',
      function (box, close) {
        var mail = box.querySelector("#m-mail");
        mail.addEventListener("change", function () { box.querySelector("#m-msg-box").hidden = !mail.checked; });
        box.querySelector("#m-go").addEventListener("click", async function () {
          var btn = this, m = box.querySelector("#m-err");
          M.setBusy(btn, true, "Saving");
          try {
            await M.api("decline-application", {
              id: a.id, reason: box.querySelector("#m-r").value.trim(),
              notify: mail.checked, message: box.querySelector("#m-msg").value
            });
            close();
            M.toast(mail.checked ? "Declined. Message sent to " + a.email + "." : "Declined. No email was sent.");
            done();
          } catch (err) { M.setBusy(btn, false); m.textContent = M.friendlyError(err); m.hidden = false; }
        });
      });
  }

  /* Founders only: permanent removal, for privacy and deletion requests. */
  function openDelete(type, id, name, done) {
    var what = type === "artist"
      ? "the artist <b>" + esc(name) + "</b> and everything they gave M.E.E.T.: their studio, artworks, photographs, login and application"
      : "the application from <b>" + esc(name) + "</b>";
    M.modal(
      "<h2>Delete <em>permanently</em></h2>" +
      '<p class="notice err">This removes ' + what + '. It also disappears from the Google Sheet copy. It cannot be undone.</p>' +
      '<p class="small muted">Use this when someone asks to be removed. The activity log keeps a note that a deletion happened, without their personal details.</p>' +
      '<label class="f">Type <b>DELETE</b> to confirm<input class="inp" id="m-confirm" autocomplete="off" autocapitalize="characters"></label>' +
      '<p class="err" id="m-err" hidden></p>' +
      '<div class="row"><button class="btn danger" type="button" id="m-go">Delete permanently</button><button class="btn line" type="button" data-close>Cancel</button></div>',
      function (box, close) {
        box.querySelector("#m-go").addEventListener("click", async function () {
          var m = box.querySelector("#m-err");
          if (box.querySelector("#m-confirm").value.trim().toUpperCase() !== "DELETE") { m.textContent = "Please type DELETE to confirm."; m.hidden = false; return; }
          var btn = this;
          M.setBusy(btn, true, "Deleting");
          try {
            await M.api("delete-record", { type: type, id: id });
            close();
            M.toast(type === "artist" ? "Artist and all their data deleted." : "Application deleted.");
            done();
          } catch (err) { M.setBusy(btn, false); m.textContent = M.friendlyError(err); m.hidden = false; }
        });
      });
  }

  /* ------------------------------------------------------------------ */
  /* Artists and studio review                                           */
  /* ------------------------------------------------------------------ */

  async function viewArtists(q) {
    var filter = q.get("filter") || "";
    var ar = await sb.from("artists").select("id, display_name, legal_name, email, city, country, craft, profile_status, avatar_path, created_at").order("created_at", { ascending: false });
    if (ar.error) throw ar.error;
    var wr = await sb.from("artworks").select("artist_id, status");
    var waiting = {};
    (wr.data || []).forEach(function (w) { if (w.status === "submitted") waiting[w.artist_id] = (waiting[w.artist_id] || 0) + 1; });
    var total = {};
    (wr.data || []).forEach(function (w) { total[w.artist_id] = (total[w.artist_id] || 0) + 1; });
    var rows = (ar.data || []).filter(function (a) { return filter !== "review" || a.profile_status === "submitted" || waiting[a.id]; });
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Approved artists</span><h1>Artists</h1>' +
      "<p>Artists you have approved, and the studios they are building. Nothing here is public until M.E.E.T. launches.</p></div>" +
      '<div class="row"><button class="btn line sm" type="button" id="export-artists">Export artists CSV</button></div></div>' +
      '<div class="chips"><a class="chip" href="#/artists" aria-pressed="' + (!filter) + '">All · ' + (ar.data || []).length + '</a>' +
      '<a class="chip" href="#/artists?filter=review" aria-pressed="' + (filter === "review") + '">Needs review</a></div>' +
      (rows.length ? '<div class="list">' + rows.map(function (a) {
        return '<a class="lrow has-th" href="#/artist/' + a.id + '">' +
          (a.avatar_path ? '<img class="th round" alt="" data-media="' + esc(a.avatar_path) + '">' : '<span class="av">' + esc(M.initials(a.display_name || a.legal_name)) + "</span>") +
          '<div class="lm"><b>' + esc(a.display_name || a.legal_name || a.email) + '</b><span class="muted small">' + esc(a.craft) + " · " + esc(place(a)) + " · " + (total[a.id] || 0) + " works</span></div>" +
          '<div class="ls">' + tag(REVIEW_STATUS, a.profile_status) + (waiting[a.id] ? '<span class="tag red">' + waiting[a.id] + " work" + (waiting[a.id] > 1 ? "s" : "") + " to review</span>" : "") + "</div></a>";
      }).join("") + "</div>" : '<div class="empty">' + (filter ? "Nothing is waiting for review." : "No approved artists yet. Approve an application to invite its artist.") + "</div>");
    M.hydrateMedia(main);
    main.querySelector("#export-artists").addEventListener("click", exportArtistsCsv);
  }

  async function viewArtist(id) {
    var ar = await sb.from("artists").select("*").eq("id", id).maybeSingle();
    if (ar.error) throw ar.error;
    var a = ar.data;
    if (!a) { main.innerHTML = '<div class="empty">This artist could not be found. <a class="link" href="#/artists">Back to artists</a></div>'; return; }
    var wr = await sb.from("artworks").select("*").eq("artist_id", id).order("created_at", { ascending: false });
    var works = wr.data || [];

    // Each button names what it acts on, so a profile is never approved by
    // mistake when an artwork was meant (and the other way round).
    function actions(type, item, status, title) {
      if (!canEdit || status === "draft") return status === "draft" ? '<p class="small muted">Still a draft: the artist has not submitted it.</p>' : "";
      var what = type === "profile" ? "profile" : "artwork";
      var t = title ? ' data-title="' + esc(title) + '"' : "";
      return '<div class="row"><button class="btn sm" type="button" data-review="' + type + '" data-id="' + item + '"' + t + ' data-decision="approved"' + (status === "approved" ? " disabled" : "") + ">" +
        (status === "approved" ? (type === "profile" ? "Profile approved" : "Artwork approved") : "Approve " + what) + "</button>" +
        '<button class="btn line sm" type="button" data-review="' + type + '" data-id="' + item + '"' + t + ' data-decision="changes_requested">Request changes to ' + what + "</button>" +
        (type === "artwork" ? '<button class="btn danger sm" type="button" data-review="artwork" data-id="' + item + '"' + t + ' data-decision="declined">Decline artwork</button>' : "") + "</div>";
    }

    main.innerHTML =
      '<a class="link small" href="#/artists">Back to artists</a>' +
      '<div class="head"><div><span class="eyebrow">Studio</span><h1>' + esc(a.display_name || a.legal_name) + "</h1><p>" + esc(a.craft) + " · " + esc(place(a)) +
      ' · <a class="link" href="mailto:' + esc(a.email) + '">' + esc(a.email) + "</a></p></div>" +
      '<div class="row">' + (a.application_id ? '<a class="btn line sm" href="#/application/' + a.application_id + '">Original application</a>' : "") + "</div></div>" +
      '<div class="rblock"><div class="between"><h3>Profile</h3>' + tag(REVIEW_STATUS, a.profile_status) + "</div>" +
      (a.cover_path ? '<img class="cover-lg" alt="Cover photo" data-media="' + esc(a.cover_path) + '">' : "") +
      '<div class="row" style="gap:18px;align-items:flex-start">' +
      (a.avatar_path ? '<img class="avatar-lg" alt="Profile picture" data-media="' + esc(a.avatar_path) + '">' : '<span class="av" style="width:120px;height:120px;font-size:30px">' + esc(M.initials(a.display_name)) + "</span>") +
      '<div class="kv" style="flex:1;min-width:240px"><span>Legal name</span><b>' + esc(a.legal_name) + "</b><span>Shown as</span><b>" + esc(a.display_name) + "</b>" +
      "<span>Main discipline</span><b>" + esc(a.craft) + "</b>" +
      (a.other_disciplines ? "<span>Other disciplines</span><b>" + esc(a.other_disciplines) + "</b>" : "") +
      (a.techniques ? "<span>Techniques and materials</span><b>" + esc(a.techniques) + "</b>" : "") +
      (a.instagram ? "<span>Instagram</span><b>" + esc(a.instagram) + "</b>" : "") +
      (a.website ? '<span>Website</span><b><a class="link" href="' + esc(a.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(a.website) + "</a></b>" : "") +
      (a.other_link ? '<span>Other link</span><b>' + esc(a.other_link) + "</b>" : "") +
      "<span>Artist terms</span><b>" + (a.terms_accepted_at ? "Agreed " + esc(M.fmtDate(a.terms_accepted_at, true)) + " (version " + esc(a.terms_version) + ")" : "Not agreed yet (they agree the first time they open their studio)") + "</b>" +
      "</div></div>" +
      (a.bio ? '<p class="prose">' + esc(a.bio) + "</p>" : '<p class="muted small">No biography yet.</p>') +
      (a.feedback && a.profile_status === "changes_requested" ? '<div class="note"><span class="muted">Feedback sent</span>' + esc(a.feedback) + "</div>" : "") +
      actions("profile", a.id, a.profile_status) + "</div>" +
      '<h2 style="font-size:32px;margin-top:8px">Works · ' + works.length + "</h2>" +
      (works.length ? works.map(function (w) {
        var size = [w.height, w.width, w.depth].filter(function (x) { return x; }).join(" × ");
        return '<div class="rblock"><div class="between"><h3>' + esc(w.title || "Untitled") + "</h3>" + tag(REVIEW_STATUS, w.status) + "</div>" +
          '<div class="gallery">' + (w.images || []).map(function (p) { return '<img alt="" data-media="' + esc(p) + '">'; }).join("") + "</div>" +
          '<div class="kv">' + (w.year ? "<span>Year</span><b>" + w.year + "</b>" : "") + (w.materials ? "<span>Materials</span><b>" + esc(w.materials) + "</b>" : "") +
          (size ? "<span>Size</span><b>" + esc(size + " " + w.unit) + "</b>" : "") +
          "<span>Edition</span><b>" + esc(w.edition_type + (w.edition_size ? " of " + w.edition_size : "")) + "</b>" +
          "<span>Price</span><b>" + (w.price_on_request ? "On request" : esc(w.currency + " " + Number(w.price || 0).toLocaleString("en-US"))) + "</b></div>" +
          (w.description ? '<p class="prose">' + esc(w.description) + "</p>" : "") +
          (w.feedback && w.status !== "approved" ? '<div class="note"><span class="muted">Feedback sent</span>' + esc(w.feedback) + "</div>" : "") +
          actions("artwork", w.id, w.status, w.title || "Untitled") + "</div>";
      }).join("") : '<div class="empty">No works added yet.</div>') +
      (me.role === "founder" ? '<div class="panel stack" style="gap:8px;margin-top:12px"><h3 style="font-size:22px">Remove this artist</h3>' +
        '<p class="small muted">For deletion requests: removes their studio, artworks, photographs, login and application.</p>' +
        '<div><button class="btn danger sm" type="button" id="del-artist">Delete artist and all their data</button></div></div>' : "");
    M.hydrateMedia(main);
    var del = main.querySelector("#del-artist");
    if (del) del.addEventListener("click", function () { openDelete("artist", a.id, a.display_name || a.legal_name || a.email, function () { location.hash = "#/artists"; }); });

    main.querySelectorAll("[data-review]").forEach(function (b) {
      b.addEventListener("click", function () {
        openReview(b.getAttribute("data-review"), b.getAttribute("data-id"), b.getAttribute("data-decision"), a, function () { viewArtist(id); renderNav("artists"); }, b.getAttribute("data-title"));
      });
    });
  }

  function openReview(type, itemId, decision, artist, done, title) {
    var label = { approved: "Approve", changes_requested: "Request changes to", declined: "Decline" }[decision];
    var needsText = decision !== "approved";
    var name = artist.display_name || artist.legal_name;
    var subject = type === "profile" ? "the profile of " + esc(name) : "the artwork “" + esc(title || "Untitled") + "”";
    M.modal(
      "<h2>" + label + " <em>" + (type === "profile" ? "profile" : "artwork") + "</em></h2>" +
      '<p class="notice">You are about to ' + label.toLowerCase() + " " + subject + ".</p>" +
      (needsText ? '<label class="f">What should ' + esc(firstName(artist.display_name || artist.legal_name)) + " change?<textarea class=\"inp\" id=\"m-f\" rows=\"5\" maxlength=\"4000\" placeholder=\"Be specific and kind, for example: Please add a photograph of the whole piece in daylight.\"></textarea></label>"
                 : '<p class="muted">The artist will see this as approved in their studio. It stays private until M.E.E.T. launches.</p>') +
      '<label class="row small" style="font-weight:500"><input type="checkbox" id="m-mail" ' + (decision === "declined" ? "" : "checked") + "> Email " + esc(artist.email) + " about this</label>" +
      '<p class="err" id="m-err" hidden></p>' +
      '<div class="row"><button class="btn' + (decision === "declined" ? " danger" : "") + '" type="button" id="m-go">' + label + " " + (type === "profile" ? "profile" : "artwork") + '</button><button class="btn line" type="button" data-close>Cancel</button></div>',
      function (box, close) {
        box.querySelector("#m-go").addEventListener("click", async function () {
          var fb = needsText ? box.querySelector("#m-f").value.trim() : "";
          var m = box.querySelector("#m-err");
          if (decision === "changes_requested" && fb.length < 5) { m.textContent = "Please tell the artist what to change."; m.hidden = false; return; }
          var btn = this;
          M.setBusy(btn, true, "Saving");
          try {
            await M.api("review-item", { type: type, id: itemId, decision: decision, feedback: fb, notify: box.querySelector("#m-mail").checked });
            close();
            M.toast((type === "profile" ? "Profile" : "“" + (title || "Artwork") + "”") + (decision === "approved" ? " approved." : decision === "declined" ? " declined." : ": changes requested.") + (box.querySelector("#m-mail").checked ? " Email sent to " + artist.email + "." : ""));
            done();
          } catch (err) { M.setBusy(btn, false); m.textContent = M.friendlyError(err); m.hidden = false; }
        });
      });
  }

  /* ------------------------------------------------------------------ */
  /* Team (founders only)                                                */
  /* ------------------------------------------------------------------ */

  var ROLES = [["founder", "Founder · everything"], ["operations", "Operations · applications and studios"], ["verification", "Verification · reviews"],
    ["partnerships", "Partnerships · reviews"], ["viewer", "Viewer · can look, cannot change"]];

  async function viewTeam() {
    var t = await sb.from("team_members").select("user_id, name, email, role, active, created_at").order("created_at");
    if (t.error) throw t.error;
    cache.team = t.data || [];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Founders only</span><h1>Team</h1>' +
      "<p>Invite people who help review artists. Each person signs in with their own password and a code we email them.</p></div></div>" +
      '<div class="list">' + cache.team.map(function (m) {
        var self = m.user_id === me.user.id;
        return '<div class="lrow" data-member="' + m.user_id + '"><div class="lm"><b>' + esc(m.name) + (self ? " (you)" : "") + '</b><span class="muted small">' + esc(m.email) + "</span></div>" +
          '<div class="row"><select class="inp" style="min-height:38px;padding:6px 36px 6px 12px;width:auto" data-role' + (self ? " disabled" : "") + ">" +
          ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (m.role === r[0] ? " selected" : "") + ">" + esc(r[1]) + "</option>"; }).join("") + "</select>" +
          '<label class="row small" style="gap:6px"><input type="checkbox" data-active' + (m.active ? " checked" : "") + (self ? " disabled" : "") + "> Active</label></div></div>";
      }).join("") + "</div>" +
      '<form class="panel stack" id="invite" novalidate><h3 style="font-size:26px">Invite a team member</h3>' +
      '<div class="grid2"><label class="f">Name<input class="inp" name="name" required maxlength="120"></label>' +
      '<label class="f">Email<input class="inp" name="email" type="email" required autocapitalize="off" spellcheck="false"></label></div>' +
      '<label class="f">Role<select class="inp" name="role">' + ROLES.slice(1).map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + "</option>"; }).join("") + "</select></label>" +
      '<p class="err" id="inv-err" hidden></p><div class="row"><button class="btn" type="submit">Send invitation</button></div></form>';

    main.querySelectorAll("[data-member]").forEach(function (row) {
      var uid = row.getAttribute("data-member");
      function save() {
        var role = row.querySelector("[data-role]").value, active = row.querySelector("[data-active]").checked;
        sb.rpc("set_team_member", { p_user: uid, p_role: role, p_active: active }).then(function (r) {
          if (r.error) fail(r.error); else M.toast("Team member updated.");
        });
      }
      row.querySelector("[data-role]").addEventListener("change", save);
      row.querySelector("[data-active]").addEventListener("change", save);
    });
    main.querySelector("#invite").addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = e.target, err = main.querySelector("#inv-err");
      var body = { name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value };
      if (!body.name || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(body.email)) { err.textContent = "Please enter a name and a complete email address."; err.hidden = false; return; }
      err.hidden = true;
      var btn = f.querySelector("button[type=submit]");
      M.setBusy(btn, true, "Sending");
      try { await M.api("invite-team-member", body); M.toast("Invitation sent to " + body.email + "."); viewTeam(); }
      catch (ex) { M.setBusy(btn, false); err.textContent = M.friendlyError(ex); err.hidden = false; }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Activity log                                                        */
  /* ------------------------------------------------------------------ */

  async function viewActivity() {
    var r = await sb.from("audit_log").select("at, actor_name, action, target_type, target_id, detail").order("at", { ascending: false }).limit(300);
    if (r.error) throw r.error;
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Accountability</span><h1>Activity log</h1><p>The latest 300 actions taken in the console and in artists\' studios.</p></div></div>' +
      ((r.data || []).length ? '<div class="list">' + r.data.map(function (h) {
        var href = h.target_type === "application" ? "#/application/" + h.target_id : h.target_type === "artist" ? "#/artist/" + h.target_id : "";
        return (href ? '<a class="lrow" href="' + href + '">' : '<div class="lrow">') +
          '<div class="lm"><b>' + esc(actionLabel(h.action)) + '</b><span class="muted small">' + esc(h.actor_name || "System") + "</span></div>" +
          '<div class="ls"><span class="muted small">' + esc(M.fmtDate(h.at, true)) + "</span></div>" + (href ? "</a>" : "</div>");
      }).join("") + "</div>" : '<div class="empty">Nothing has happened yet.</div>');
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  document.getElementById("logo").insertAdjacentHTML("afterbegin", M.LOGO);
  document.querySelectorAll("[data-signout]").forEach(function (b) { b.addEventListener("click", M.signOut); });

  (async function start() {
    me = await M.requireTeam();
    if (!me) return;
    sb = M.sb;
    canEdit = me.role !== "viewer";
    document.getElementById("who").textContent = me.member.name;
    var t = await sb.from("team_members").select("user_id, name, email, role, active");
    cache.team = t.data || [];
    window.addEventListener("hashchange", route);
    route();
  })();
})();
