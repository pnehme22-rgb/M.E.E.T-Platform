/* M.E.E.T. team console: applications, artists, members, inquiries, homepage,
   sales (projects, follow-ups, reports), team, activity.
   Every read and write goes through the signed-in team member's session, so
   the database's row level security decides what is allowed. Approvals and
   emails go through Netlify functions (/api/...). */
(function () {
  "use strict";
  var M = window.MEET, sb, me, canEdit, isSales;
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
    var del = await sb.from("member_accounts").select("id", { count: "exact", head: true }).not("deletion_requested_at", "is", null);
    var c = { apps: {}, profiles: 0, works: 0, deletions: del.count || 0, projects: 0, overdue: 0 };
    if (isSales) {
      var np = await sb.from("project_requests").select("id", { count: "exact", head: true }).eq("status", "new");
      var od = await sb.from("project_tasks").select("id", { count: "exact", head: true }).eq("done", false).eq("assigned_to", me.user.id).lt("due_on", new Date().toISOString().slice(0, 10));
      c.projects = np.count || 0; c.overdue = od.count || 0;
    }
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
      ["members", "Members", c.deletions],
      ["inquiries", "Artist inquiries", 0],
      ["homepage", "Homepage", 0],
      ["activity", "Activity log", 0]
    ];
    if (me.role === "founder") items.splice(6, 0, ["team", "Team", 0]);
    function link(i) {
      return '<a class="ni" href="#/' + i[0] + '"' + (current === i[0] ? ' aria-current="page"' : "") + ">" + esc(i[1]) +
        (i[2] ? '<span class="badge">' + i[2] + "</span>" : "") + "</a>";
    }
    var sales = isSales ? [["projects", "Projects", c.projects], ["followups", "Follow-ups", c.overdue]] : [];
    if (me.role === "founder") sales.push(["reports", "Reports", 0]);
    nav.innerHTML = '<p class="nav-l">Workspaces</p>' + items.map(link).join("") +
      (sales.length ? '<p class="nav-l">Sales</p>' + sales.map(link).join("") : "") +
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
    var section = { application: "applications", artist: "artists", member: "members", inquiry: "inquiries", project: "projects" }[r.view] || r.view;
    main.onclick = null;
    try {
      var c = await renderNav(section);
      if (r.view === "overview") await viewOverview(c);
      else if (r.view === "applications") await viewApplications(r.q);
      else if (r.view === "application") await viewApplication(r.id);
      else if (r.view === "artists") await viewArtists(r.q);
      else if (r.view === "artist") await viewArtist(r.id);
      else if (r.view === "members") await viewMembers(r.q);
      else if (r.view === "member") await viewMember(r.id);
      else if (r.view === "homepage") await viewHomepage();
      else if (r.view === "inquiries") await viewInquiries(r.q);
      else if (r.view === "inquiry") await viewInquiry(r.id);
      else if (r.view === "projects" && isSales) await viewProjects(r.q);
      else if (r.view === "project" && isSales) await viewProject(r.id);
      else if (r.view === "followups" && isSales) await viewFollowups(r.q);
      else if (r.view === "reports" && me.role === "founder") await viewReports(r.q);
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
      "<p>Your next step is to open your studio. Set your password with the button below, then add your profile and a few of your works. The M.E.E.T. team reviews your profile and each artwork before they appear publicly on M.E.E.T.</p>" +
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
      "artist.terms_accepted": "Artist terms agreed", "artist.deleted": "Artist and their data deleted", "application.deleted": "Application deleted",
      "featured.add": "Featured on the homepage", "featured.remove": "Removed from the homepage",
      "member.deletion_requested": "Member asked to delete their account", "member.deleted": "Member account deleted",
      "inquiry.created": "Inquiry sent to an artist", "inquiry.viewed": "Inquiry viewed by the artist", "inquiry.responded": "Artist replied to an inquiry",
      "inquiry.closed": "Inquiry closed by the artist", "inquiry.open": "Inquiry reopened by the artist", "project.status": "Project status changed"
    })[a] || a;
  }

  function openApprove(a, done) {
    var again = a.status === "approved";
    M.modal(
      "<h2>" + (again ? "Send a new studio <em>link</em>" : "Approve <em>" + esc(a.artist_name) + "</em>") + "</h2>" +
      "<p class=\"muted\">" + (again
        ? "A fresh link will be emailed to " + esc(a.email) + ". The old one stops working."
        : "This creates their private studio and sends this email to " + esc(a.email) + " from hello@meetstudio.art. Their reply reaches the team inbox.") + "</p>" +
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
      : type === "member" ? "the member account of <b>" + esc(name) + "</b> and its login"
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
            M.toast(type === "artist" ? "Artist and all their data deleted." : type === "member" ? "Member account deleted." : "Application deleted.");
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
      "<p>Artists you have approved, and the studios they are building. Approved profiles and approved artworks are public on M.E.E.T.</p></div>" +
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
    // Public visibility is decided by the database (see the public_artists view).
    var pr = await sb.rpc("artist_is_public", { p_artist: id });
    var isPublic = pr.data === true;
    var fr = await sb.from("featured_items").select("kind, item_id");
    var featured = {};
    (fr.data || []).forEach(function (f) { featured[f.kind + ":" + f.item_id] = true; });
    function featureBtn(kind, itemId) {
      if (!canEdit || !isPublic) return "";
      var on = featured[kind + ":" + itemId];
      return '<button class="btn line sm" type="button" data-feature="' + kind + '" data-id="' + itemId + '" data-on="' + (on ? 1 : 0) + '">' +
        (on ? "Remove from homepage" : "Feature on homepage") + "</button>";
    }
    var whyNot = a.profile_status !== "approved" ? "the profile is not approved yet"
      : !a.terms_accepted_at ? "the artist has not agreed to the Artist terms yet"
      : "the artist must agree to the latest Artist terms (they are asked when they next open their studio)";
    var publicLine = isPublic
      ? '<span class="tag ok">Public on M.E.E.T.</span>'
      : '<span class="tag">Not public</span> <span class="small muted">because ' + esc(whyNot) + "</span>";

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
      '<div class="row" style="gap:8px">' + publicLine + (isPublic ? ' <a class="link small" href="/artists/' + a.id + '" target="_blank" rel="noopener">View public profile</a>' : "") +
      (featured["artist:" + a.id] ? ' <span class="tag blue">On the homepage</span>' : "") + featureBtn("artist", a.id) + "</div>" +
      '<div class="rblock"><div class="between"><h3>Profile</h3>' + tag(REVIEW_STATUS, a.profile_status) + "</div>" +
      (a.cover_path ? '<img class="cover-lg" alt="Cover photo" data-media="' + esc(a.cover_path) + '">' : "") +
      '<div class="row" style="gap:18px;align-items:flex-start">' +
      (a.avatar_path ? '<img class="avatar-lg" alt="Profile picture" data-media="' + esc(a.avatar_path) + '">' : '<span class="av" style="width:120px;height:120px;font-size:30px">' + esc(M.initials(a.display_name)) + "</span>") +
      '<div class="kv" style="flex:1;min-width:240px"><span>Legal name</span><b>' + esc(a.legal_name) + "</b><span>Shown as</span><b>" + esc(a.display_name) + "</b>" +
      "<span>Main discipline</span><b>" + esc(a.craft) + "</b>" +
      (a.other_disciplines ? "<span>Other disciplines</span><b>" + esc(a.other_disciplines) + "</b>" : "") +
      (a.techniques ? "<span>Techniques and materials</span><b>" + esc(a.techniques) + "</b>" : "") +
      (a.traditions ? "<span>Cultural traditions</span><b>" + esc(a.traditions) + "</b>" : "") +
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
        return '<div class="rblock"><div class="between"><h3>' + esc(w.title || "Untitled") + "</h3>" +
          '<div class="row" style="gap:6px">' + (w.status === "approved" && isPublic ? '<a class="tag ok" href="/artworks/' + w.id + '" target="_blank" rel="noopener">Public</a>' : "") +
          (featured["artwork:" + w.id] ? '<span class="tag blue">On the homepage</span>' : "") + tag(REVIEW_STATUS, w.status) + "</div></div>" +
          '<div class="gallery">' + (w.images || []).map(function (p) { return '<img alt="" data-media="' + esc(p) + '">'; }).join("") + "</div>" +
          '<div class="kv">' + (w.year ? "<span>Year</span><b>" + w.year + "</b>" : "") + (w.materials ? "<span>Materials</span><b>" + esc(w.materials) + "</b>" : "") +
          (size ? "<span>Size</span><b>" + esc(size + " " + w.unit) + "</b>" : "") +
          "<span>Edition</span><b>" + esc(w.edition_type + (w.edition_size ? " of " + w.edition_size : "")) + "</b>" +
          "<span>Price</span><b>" + (w.price_on_request ? "On request" : esc(w.currency + " " + Number(w.price || 0).toLocaleString("en-US"))) + "</b></div>" +
          (w.description ? '<p class="prose">' + esc(w.description) + "</p>" : "") +
          (w.feedback && w.status !== "approved" ? '<div class="note"><span class="muted">Feedback sent</span>' + esc(w.feedback) + "</div>" : "") +
          actions("artwork", w.id, w.status, w.title || "Untitled") +
          (w.status === "approved" ? '<div class="row">' + featureBtn("artwork", w.id) + "</div>" : "") + "</div>";
      }).join("") : '<div class="empty">No works added yet.</div>') +
      (me.role === "founder" ? '<div class="panel stack" style="gap:8px;margin-top:12px"><h3 style="font-size:22px">Remove this artist</h3>' +
        '<p class="small muted">For deletion requests: removes their studio, artworks, photographs, login and application.</p>' +
        '<div><button class="btn danger sm" type="button" id="del-artist">Delete artist and all their data</button></div></div>' : "");
    M.hydrateMedia(main);
    var del = main.querySelector("#del-artist");
    if (del) del.addEventListener("click", function () { openDelete("artist", a.id, a.display_name || a.legal_name || a.email, function () { location.hash = "#/artists"; }); });

    main.querySelectorAll("[data-feature]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var on = b.getAttribute("data-on") === "1";
        M.setBusy(b, true, "Saving");
        var r = await sb.rpc(on ? "unfeature_item" : "feature_item", { p_kind: b.getAttribute("data-feature"), p_id: b.getAttribute("data-id") });
        if (r.error) { M.setBusy(b, false); return fail(r.error); }
        M.toast(on ? "Removed from the homepage." : "Featured on the homepage.");
        viewArtist(id);
      });
    });

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
                 : '<p class="muted">' + (type === "profile" ? "Approving makes this profile public on M.E.E.T. (once the artist has agreed to the current Artist terms)." : "Approving makes this artwork public on M.E.E.T. as soon as the artist's profile is public.") + '</p>') +
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
  /* Members (Personal, Professional, Business & Organization)          */
  /* ------------------------------------------------------------------ */

  var ACCOUNT_TYPE = { personal: ["Personal", ""], professional: ["Professional", "blue"], business: ["Business & Organization", "ok"] };
  function memberName(m) { return m.account_type === "business" && m.business_name ? m.business_name : m.full_name; }

  async function viewMembers(q) {
    var type = q.get("type") || "";
    var term = (q.get("q") || "").trim().toLowerCase();
    var res = await sb.from("member_accounts").select("*").order("created_at", { ascending: false }).limit(5000);
    if (res.error) throw res.error;
    var all = res.data || [];
    var rows = all.filter(function (m) {
      if (type === "deletion" ? !m.deletion_requested_at : type && m.account_type !== type) return false;
      if (!term) return true;
      return [m.full_name, m.email, m.country, m.business_name, m.company_name, m.business_type, m.professional_role].join(" ").toLowerCase().indexOf(term) !== -1;
    });
    var chips = [["", "All"], ["personal", "Personal"], ["professional", "Professional"], ["business", "Business & Organization"], ["deletion", "Deletion requested"]];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Accounts</span><h1>Members</h1>' +
      "<p>People who created a Personal, Professional or Business &amp; Organization account. Artists are listed under Artists.</p></div>" +
      '<div class="row"><button class="btn line sm" type="button" id="export-members">Export members CSV</button></div></div>' +
      '<div class="filters"><div class="chips" role="group" aria-label="Filter by account type">' + chips.map(function (c) {
        var n = !c[0] ? all.length : c[0] === "deletion" ? all.filter(function (m) { return m.deletion_requested_at; }).length : all.filter(function (m) { return m.account_type === c[0]; }).length;
        return '<button class="chip" type="button" data-type="' + c[0] + '" aria-pressed="' + (type === c[0]) + '">' + esc(c[1]) + " · " + n + "</button>";
      }).join("") + "</div>" +
      '<label class="visually-hidden" for="search">Search members</label><input class="inp search" id="search" type="search" placeholder="Search name, email, company, country" value="' + esc(q.get("q") || "") + '"></div>' +
      (rows.length ? '<div class="list">' + rows.map(function (m) {
        var sub = [m.account_type === "business" ? m.full_name : "", m.account_type === "professional" ? [m.professional_role, m.company_name].filter(Boolean).join(", ") : "",
          m.account_type === "business" ? m.business_type : "", m.country].filter(Boolean).join(" · ");
        return '<a class="lrow" href="#/member/' + m.id + '"><div class="lm"><b>' + esc(memberName(m)) + '</b><span class="muted small">' + esc(sub) + "</span></div>" +
          '<div class="ls">' + tag(ACCOUNT_TYPE, m.account_type) + (m.deletion_requested_at ? '<span class="tag red">Deletion requested</span>' : "") +
          '<span class="muted small">' + esc(M.fmtWhen(m.created_at)) + "</span></div></a>";
      }).join("") + "</div>" : '<div class="empty">' + (all.length ? "No members match." : "No member accounts yet. They appear here when someone signs up at /signup and confirms their email.") + "</div>");

    function go(t, s) {
      var p = new URLSearchParams();
      if (t) p.set("type", t);
      if (s) p.set("q", s);
      location.hash = "#/members" + (p.toString() ? "?" + p.toString() : "");
    }
    main.querySelectorAll("[data-type]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-type"), q.get("q") || ""); }); });
    var timer, search = document.getElementById("search");
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { go(type, search.value.trim()); setTimeout(function () { var s = document.getElementById("search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 50); }, 400);
    });
    document.getElementById("export-members").addEventListener("click", function () {
      var header = ["account_type", "full_name", "email", "country", "phone", "professional_role", "company_name", "professional_website",
        "business_name", "contact_person", "business_type", "business_website", "deletion_requested_at", "created_at"];
      downloadCsv("meet-members", header, all.map(function (m) { return header.map(function (h) { return h === "account_type" ? ACCOUNT_TYPE[m.account_type][0] : m[h]; }); }));
      M.toast("CSV downloaded: " + all.length + " members.");
    });
  }

  async function viewMember(id) {
    var r = await sb.from("member_accounts").select("*").eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    var m = r.data;
    if (!m) { main.innerHTML = '<div class="empty">This member could not be found. <a class="link" href="#/members">Back to members</a></div>'; return; }
    function kv(label, v, link) {
      if (!v) return "";
      return "<span>" + esc(label) + "</span><b>" + (link && /^https?:\/\//i.test(v) ? '<a class="link" href="' + esc(v) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(v.replace(/^https?:\/\//, "")) + "</a>" : esc(v)) + "</b>";
    }
    main.innerHTML =
      '<a class="link small" href="#/members">Back to members</a>' +
      '<div class="head"><div><span class="eyebrow">' + esc(ACCOUNT_TYPE[m.account_type][0]) + " account · joined " + esc(M.fmtDate(m.created_at)) + "</span>" +
      "<h1>" + esc(memberName(m)) + "</h1></div><div class=\"row\">" + tag(ACCOUNT_TYPE, m.account_type) + "</div></div>" +
      (m.deletion_requested_at ? '<div class="notice warn">Asked to delete this account on ' + esc(M.fmtDate(m.deletion_requested_at, true)) + ". Please complete it within 30 days and confirm to them by email.</div>" : "") +
      '<div class="rblock"><h3>Details</h3><div class="kv">' +
      kv("Business or organization", m.business_name) + kv("Business type", m.business_type) + kv("Contact person", m.contact_person) + kv("Business website", m.business_website, true) +
      kv("Full name", m.full_name) + kv("Professional role", m.professional_role) + kv("Company or studio", m.company_name) + kv("Professional website", m.professional_website, true) +
      '<span>Email</span><b><a class="link" href="mailto:' + esc(m.email) + '">' + esc(m.email) + "</a></b>" +
      kv("Country", m.country) + kv("Phone", m.phone) + kv("Last updated", M.fmtDate(m.updated_at, true)) +
      "</div><p class=\"small muted\">The account type is fixed. Members cannot change it themselves.</p></div>" +
      (me.role === "founder" ? '<div class="panel stack" style="gap:8px;margin-top:12px"><h3 style="font-size:22px">Remove this member</h3>' +
        '<p class="small muted">For deletion requests: removes their member account and their login.</p>' +
        '<div><button class="btn danger sm" type="button" id="del-member">Delete member account</button></div></div>' : "");
    var del = main.querySelector("#del-member");
    if (del) del.addEventListener("click", function () { openDelete("member", m.id, memberName(m), function () { location.hash = "#/members"; renderNav("members"); }); });
  }

  /* ------------------------------------------------------------------ */
  /* Homepage selection                                                  */
  /* ------------------------------------------------------------------ */

  async function viewHomepage() {
    var f = await sb.from("featured_items").select("kind, item_id, position").order("position");
    if (f.error) throw f.error;
    var pa = await sb.from("public_artists").select("id, display_name, main_discipline, city, country").order("display_name");
    var pw = await sb.from("public_artworks").select("id, artist_id, title, year").order("approved_at", { ascending: false });
    var artists = pa.data || [], works = pw.data || [];
    var byArtist = {}; artists.forEach(function (a) { byArtist[a.id] = a; });
    var byWork = {}; works.forEach(function (w) { byWork[w.id] = w; });
    var feat = f.data || [];
    var fa = feat.filter(function (x) { return x.kind === "artist"; }), fw = feat.filter(function (x) { return x.kind === "artwork"; });
    var taken = {}; feat.forEach(function (x) { taken[x.kind + ":" + x.item_id] = true; });

    function list(kind, items) {
      if (!items.length) return '<div class="empty">Nothing featured yet.</div>';
      return '<div class="list">' + items.map(function (x, i) {
        var label, sub, live = true;
        if (kind === "artist") { var a = byArtist[x.item_id]; live = !!a; label = a ? a.display_name : "No longer public"; sub = a ? [a.main_discipline, place(a)].filter(Boolean).join(" · ") : "Hidden from the homepage until it is public again"; }
        else { var w = byWork[x.item_id]; live = !!w; label = w ? (w.title || "Untitled") : "No longer public"; sub = w ? (byArtist[w.artist_id] || {}).display_name || "" : "Hidden from the homepage until it is public again"; }
        return '<div class="lrow"><div class="lm"><b>' + (i + 1) + ". " + esc(label) + '</b><span class="muted small">' + esc(sub) + "</span></div>" +
          '<div class="row" style="gap:6px">' + (live ? "" : '<span class="tag warn">Hidden</span>') +
          (canEdit ? '<button class="btn line sm" type="button" data-move="-1" data-kind="' + kind + '" data-id="' + x.item_id + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Move earlier">↑</button>' +
          '<button class="btn line sm" type="button" data-move="1" data-kind="' + kind + '" data-id="' + x.item_id + '"' + (i === items.length - 1 ? " disabled" : "") + ' aria-label="Move later">↓</button>' +
          '<button class="btn line sm" type="button" data-remove data-kind="' + kind + '" data-id="' + x.item_id + '">Remove</button>' : "") + "</div></div>";
      }).join("") + "</div>";
    }
    function picker(kind, options) {
      if (!canEdit) return "";
      if (!options.length) return '<p class="small muted">' + (kind === "artist" ? "Every public artist is already featured, or no artist is public yet." : "Every public artwork is already featured, or no artwork is public yet.") + "</p>";
      return '<div class="row"><label class="visually-hidden" for="add-' + kind + '">Choose ' + kind + '</label><select class="inp" id="add-' + kind + '" style="width:auto;min-width:260px;flex:1">' +
        options.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>" +
        '<button class="btn sm" type="button" data-add="' + kind + '">Feature ' + kind + "</button></div>";
    }
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Public website</span><h1>Homepage <em>selection</em></h1>' +
      "<p>Choose the artists and artworks shown on the homepage, in this order. Only public artists and artworks can be chosen. If one stops being public, it disappears from the homepage by itself. The section is hidden while nothing is chosen.</p></div>" +
      '<div class="row"><a class="btn line sm" href="/" target="_blank" rel="noopener">Open the homepage</a></div></div>' +
      '<section class="rblock"><h3>Featured artists · ' + fa.length + "</h3>" + list("artist", fa) +
      picker("artist", artists.filter(function (a) { return !taken["artist:" + a.id]; }).map(function (a) { return [a.id, a.display_name + (a.main_discipline ? " · " + a.main_discipline : "")]; })) + "</section>" +
      '<section class="rblock"><h3>Featured artworks · ' + fw.length + "</h3>" + list("artwork", fw) +
      picker("artwork", works.filter(function (w) { return !taken["artwork:" + w.id]; }).map(function (w) { return [w.id, (w.title || "Untitled") + " · " + ((byArtist[w.artist_id] || {}).display_name || "")]; })) + "</section>";

    main.onclick = async function (e) {
      var b = e.target.closest("[data-move],[data-remove],[data-add]");
      if (!b || !main.contains(b) || b.disabled) return;
      var kind = b.getAttribute("data-kind") || b.getAttribute("data-add");
      var r;
      M.setBusy(b, true, "…");
      if (b.hasAttribute("data-add")) r = await sb.rpc("feature_item", { p_kind: kind, p_id: main.querySelector("#add-" + kind).value });
      else if (b.hasAttribute("data-remove")) r = await sb.rpc("unfeature_item", { p_kind: kind, p_id: b.getAttribute("data-id") });
      else r = await sb.rpc("move_featured", { p_kind: kind, p_id: b.getAttribute("data-id"), p_dir: +b.getAttribute("data-move") });
      if (r.error) { M.setBusy(b, false); return fail(r.error); }
      viewHomepage();
    };
  }

  /* ------------------------------------------------------------------ */
  /* Artist inquiries (tracking only: artists answer from their studio)  */
  /* ------------------------------------------------------------------ */

  var INQ_STATUS = { new: ["New", "red"], viewed: ["Viewed", "blue"], responded: ["Responded", "ok"], closed: ["Closed", ""] };
  var INQ_TOPIC = { artwork: "An artwork", commission: "A commission", collaboration: "A collaboration or project", other: "Something else" };
  var ACCOUNT_LABEL = { personal: "Personal", professional: "Professional", business: "Business & Organization" };

  async function artistNames(ids) {
    var out = {};
    if (!ids.length) return out;
    var r = await sb.from("artists").select("id, display_name, legal_name").in("id", ids);
    (r.data || []).forEach(function (a) { out[a.id] = a.display_name || a.legal_name; });
    return out;
  }
  function uniq(list) { return list.filter(function (v, i, a) { return v && a.indexOf(v) === i; }); }
  function countryOptions(values, current, allLabel) {
    return '<option value="">' + esc(allLabel) + "</option>" + uniq(values.map(function (v) { return v || "Not recorded"; })).sort().map(function (c) {
      return '<option' + (c === current ? " selected" : "") + ">" + esc(c) + "</option>";
    }).join("");
  }

  async function viewInquiries(q) {
    var status = q.get("status") || "", country = q.get("country") || "", term = (q.get("q") || "").trim().toLowerCase();
    var r = await sb.from("artist_inquiries").select("*").order("created_at", { ascending: false }).limit(5000);
    if (r.error) throw r.error;
    var all = r.data || [];
    var names = await artistNames(uniq(all.map(function (x) { return x.artist_id; })));
    var rows = all.filter(function (x) {
      if (status && x.status !== status) return false;
      if (country && (x.member_country || "Not recorded") !== country) return false;
      return !term || [x.member_name, x.member_country, names[x.artist_id], x.artwork_title, x.message].join(" ").toLowerCase().indexOf(term) !== -1;
    });
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Members and artists</span><h1>Artist inquiries</h1>' +
      "<p>Inquiries members sent to artists, and how far each one has gone. Artists read and answer them in their studio; this page is for following their progress.</p></div></div>" +
      '<div class="filters"><div class="chips" role="group" aria-label="Filter by status">' + [["", "All"]].concat(Object.keys(INQ_STATUS).map(function (k) { return [k, INQ_STATUS[k][0]]; })).map(function (c) {
        var n = c[0] ? all.filter(function (x) { return x.status === c[0]; }).length : all.length;
        return '<button class="chip" type="button" data-f="status" data-v="' + c[0] + '" aria-pressed="' + (status === c[0]) + '">' + esc(c[1]) + " · " + n + "</button>";
      }).join("") + "</div>" +
      '<div class="toolbar"><label class="visually-hidden" for="f-country">Member country</label><select class="inp" id="f-country">' + countryOptions(all.map(function (x) { return x.member_country; }), country, "All countries") + "</select>" +
      '<label class="visually-hidden" for="search">Search inquiries</label><input class="inp search" id="search" type="search" placeholder="Search member, artist, message" value="' + esc(q.get("q") || "") + '"></div></div>' +
      (rows.length ? '<div class="list">' + rows.map(function (x) {
        return '<a class="lrow" href="#/inquiry/' + x.id + '"><div class="lm"><b>' + esc(x.member_name) + " → " + esc(names[x.artist_id] || "Artist") + '</b><span class="muted small">' +
          esc(ACCOUNT_LABEL[x.member_type]) + " · " + esc(x.member_country || "Country not recorded") + " · " + esc(INQ_TOPIC[x.topic]) + (x.artwork_title ? ": “" + esc(x.artwork_title) + "”" : "") + "</span></div>" +
          '<div class="ls">' + tag(INQ_STATUS, x.status) + '<span class="muted small">' + esc(M.fmtWhen(x.created_at)) + "</span></div></a>";
      }).join("") + "</div>" : '<div class="empty">' + (all.length ? "No inquiries match these filters." : "No inquiries yet. They appear here when a member writes to an artist from a public profile.") + "</div>");
    hashFilters("inquiries", q);
  }

  // Shared filter wiring for list views: chips, selects and search update the address.
  function hashFilters(view, q) {
    function go(k, v) {
      var p = new URLSearchParams(q.toString());
      if (v) p.set(k, v); else p.delete(k);
      if (k !== "page") p.delete("page");
      location.hash = "#/" + view + (p.toString() ? "?" + p.toString() : "");
    }
    main.querySelectorAll("[data-f]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-f"), b.getAttribute("data-v")); }); });
    main.querySelectorAll("select[data-sel]").forEach(function (s) { s.addEventListener("change", function () { go(s.getAttribute("data-sel"), s.value); }); });
    var c = main.querySelector("#f-country");
    if (c) c.addEventListener("change", function () { go("country", c.value); });
    var search = main.querySelector("#search"), timer;
    if (search) search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { go("q", search.value.trim()); setTimeout(function () { var s = document.getElementById("search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 50); }, 400);
    });
  }

  async function viewInquiry(id) {
    var r = await sb.from("artist_inquiries").select("*").eq("id", id).maybeSingle();
    if (r.error) throw r.error;
    var x = r.data;
    if (!x) { main.innerHTML = '<div class="empty">This inquiry could not be found. <a class="link" href="#/inquiries">Back to inquiries</a></div>'; return; }
    var names = await artistNames([x.artist_id]);
    var m = await sb.from("member_accounts").select("email, phone").eq("id", x.member_id).maybeSingle();
    var hist = await sb.from("audit_log").select("at, action").eq("target_id", id).order("at", { ascending: true });
    main.innerHTML =
      '<a class="link small" href="#/inquiries">Back to inquiries</a>' +
      '<div class="head"><div><span class="eyebrow">Inquiry · ' + esc(M.fmtDate(x.created_at, true)) + "</span><h1>" + esc(x.member_name) + " → " + esc(names[x.artist_id] || "Artist") + "</h1>" +
      "<p>" + esc(INQ_TOPIC[x.topic]) + (x.artwork_title ? ": “" + esc(x.artwork_title) + "”" : "") + "</p></div><div>" + tag(INQ_STATUS, x.status) + "</div></div>" +
      '<div class="rgrid"><div class="stack">' +
      '<div class="rblock"><h3>Message</h3><p class="prose">' + esc(x.message) + "</p></div>" +
      '<div class="rblock"><h3>Artist\'s reply</h3>' + (x.response ? '<p class="prose">' + esc(x.response) + "</p>" : '<p class="small muted">No reply yet.</p>') + "</div></div>" +
      '<aside class="raside"><div class="panel stack" style="gap:10px"><h3 style="font-size:22px">Member</h3><div class="kv">' +
      "<span>Name</span><b>" + esc(x.member_name) + "</b><span>Account type</span><b>" + esc(ACCOUNT_LABEL[x.member_type]) + "</b>" +
      "<span>Country</span><b>" + esc(x.member_country || "Not recorded") + "</b>" +
      (m.data ? '<span>Email</span><b><a class="link" href="mailto:' + esc(m.data.email) + '">' + esc(m.data.email) + "</a></b>" + (m.data.phone ? "<span>Phone</span><b>" + esc(m.data.phone) + "</b>" : "") : "") +
      '</div><p class="small muted">The artist sees the name, account type and country only.</p></div>' +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">Artist</h3><a class="link" href="#/artist/' + x.artist_id + '">' + esc(names[x.artist_id] || "Open artist") + "</a></div>" +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">Progress</h3><div class="timeline">' +
      "<div><b>Sent</b><br><span class=\"muted small\">" + esc(M.fmtDate(x.created_at, true)) + "</span></div>" +
      (x.viewed_at ? "<div><b>Viewed by the artist</b><br><span class=\"muted small\">" + esc(M.fmtDate(x.viewed_at, true)) + "</span></div>" : "") +
      (x.responded_at ? "<div><b>Artist replied</b><br><span class=\"muted small\">" + esc(M.fmtDate(x.responded_at, true)) + "</span></div>" : "") +
      (x.closed_at ? "<div><b>Closed</b><br><span class=\"muted small\">" + esc(M.fmtDate(x.closed_at, true)) + "</span></div>" : "") +
      ((hist.data || []).filter(function (h) { return h.action === "inquiry.open"; }).map(function (h) { return "<div><b>Reopened</b><br><span class=\"muted small\">" + esc(M.fmtDate(h.at, true)) + "</span></div>"; }).join("")) +
      "</div></div></aside></div>";
  }

  /* ------------------------------------------------------------------ */
  /* Sales: project requests, pipeline, matching, follow-ups, revenue    */
  /* ------------------------------------------------------------------ */

  var PIPE = [["new", "New", "red"], ["contacted", "Contacted", "blue"], ["proposal_sent", "Proposal Sent", "blue"],
    ["negotiation", "Negotiation", "warn"], ["confirmed", "Project Confirmed", "ok"], ["not_confirmed", "Not Confirmed", ""]];
  var PROJECT_STATUS = {}; PIPE.forEach(function (p) { PROJECT_STATUS[p[0]] = [p[1], p[2]]; });
  var REASONS = [["budget", "Budget didn't fit"], ["timeline", "Timeline didn't fit"], ["changed_mind", "Client changed their mind"],
    ["no_response", "No response"], ["match", "Artist/artwork match unsuitable"], ["requirements", "Requirements changed"], ["other", "Other"]];
  var REASON_LABEL = {}; REASONS.forEach(function (r) { REASON_LABEL[r[0]] = r[1]; });
  var PAYMENT = [["not_recorded", "Not recorded"], ["not_due", "Not due yet"], ["awaiting", "Awaiting payment"], ["partly_paid", "Partly paid"], ["paid", "Paid in full"], ["not_applicable", "Not applicable"]];
  var PAYMENT_LABEL = {}; PAYMENT.forEach(function (p) { PAYMENT_LABEL[p[0]] = p[1]; });
  var CLIENT_VIEW = { new: "received", confirmed: "confirmed", not_confirmed: "closed" };
  function clientStatus(s) { return CLIENT_VIEW[s] || "in_discussion"; }
  var CLIENT_LABEL = { received: "Received", in_discussion: "In discussion", confirmed: "Confirmed", closed: "Closed" };
  function clientName(p) { return p.client_organization ? p.client_organization + " (" + p.client_name + ")" : p.client_name; }
  function money(n, cur) {
    if (n === null || n === undefined || n === "") return "";
    try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur || "USD", currencyDisplay: "code", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n); }
    catch (e) { return (cur || "") + " " + Number(n).toLocaleString("en-GB"); }
  }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function salesPeople() { return cache.team.filter(function (m) { return m.active && (m.role === "founder" || m.role === "sales"); }); }

  async function viewProjects(q) {
    var status = q.get("status") || "", who = q.get("who") || "", country = q.get("country") || "";
    var term = (q.get("q") || "").trim().toLowerCase(), sort = q.get("sort") || "new", page = Math.max(1, parseInt(q.get("page") || "1", 10));
    var r = await sb.from("project_requests").select("*").order("created_at", { ascending: false }).limit(5000);
    if (r.error) throw r.error;
    var all = r.data || [];
    var base = all.filter(function (p) {
      if (who === "mine" && p.assigned_to !== me.user.id) return false;
      if (who === "none" && p.assigned_to) return false;
      if (country && (p.client_country || "Not recorded") !== country) return false;
      return !term || [p.reference, p.client_name, p.client_organization, p.client_country, p.artwork_type, p.description, p.location].join(" ").toLowerCase().indexOf(term) !== -1;
    });
    var rows = base.filter(function (p) { return !status || p.status === status; });
    rows.sort(function (a, b) {
      if (sort === "old") return a.created_at < b.created_at ? -1 : 1;
      if (sort === "updated") return a.updated_at < b.updated_at ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    var per = 20, pages = Math.max(1, Math.ceil(rows.length / per));
    if (page > pages) page = pages;
    var shown = rows.slice((page - 1) * per, page * per);
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Sales</span><h1>Project requests</h1>' +
      "<p>Requests from Professional and Business &amp; Organization members. Founders manage every project; sales team members manage the projects assigned to them.</p></div></div>" +
      '<nav class="pipe" aria-label="Pipeline">' + PIPE.map(function (s) {
        var n = base.filter(function (p) { return p.status === s[0]; }).length;
        return '<a href="#" data-f="status" data-v="' + (status === s[0] ? "" : s[0]) + '" aria-pressed="' + (status === s[0]) + '"><b>' + n + "</b>" + esc(s[1]) + "</a>";
      }).join("") + "</nav>" +
      '<div class="toolbar">' +
      '<label class="visually-hidden" for="f-who">Assignment</label><select class="inp" id="f-who" data-sel="who">' +
      [["", "Everyone's projects"], ["mine", "Assigned to me"], ["none", "Unassigned"]].map(function (o) { return '<option value="' + o[0] + '"' + (who === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      '<label class="visually-hidden" for="f-country">Client country</label><select class="inp" id="f-country">' + countryOptions(all.map(function (p) { return p.client_country; }), country, "All countries") + "</select>" +
      '<label class="visually-hidden" for="f-sort">Sort</label><select class="inp" id="f-sort" data-sel="sort">' +
      [["new", "Newest first"], ["old", "Oldest first"], ["updated", "Recently updated"]].map(function (o) { return '<option value="' + o[0] + '"' + (sort === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      '<label class="visually-hidden" for="search">Search projects</label><input class="inp search" id="search" type="search" placeholder="Search reference, client, artwork" value="' + esc(q.get("q") || "") + '"></div>' +
      (shown.length ? '<div class="list">' + shown.map(function (p) {
        return '<a class="lrow" href="#/project/' + p.id + '"><div class="lm"><b>' + esc(p.reference) + " · " + esc(clientName(p)) + '</b><span class="muted small">' +
          esc(p.artwork_type) + " · " + esc(ACCOUNT_LABEL[p.client_type]) + " · " + esc(p.client_country || "Country not recorded") + "</span></div>" +
          '<div class="ls">' + tag(PROJECT_STATUS, p.status) + '<span class="muted small">' + (p.assigned_to ? esc(teamName(p.assigned_to)) : "Unassigned") + " · " + esc(M.fmtWhen(p.created_at)) + "</span></div></a>";
      }).join("") + "</div>" : '<div class="empty">' + (all.length ? "No projects match these filters." : "No project requests yet. They arrive here when a Professional or Business member sends one from their account.") + "</div>") +
      (pages > 1 ? '<div class="pager"><span class="muted">Page ' + page + " of " + pages + " · " + rows.length + " projects</span><span class=\"row\">" +
        (page > 1 ? '<button class="btn line sm" type="button" data-f="page" data-v="' + (page - 1) + '">Previous</button>' : "") +
        (page < pages ? '<button class="btn line sm" type="button" data-f="page" data-v="' + (page + 1) + '">Next</button>' : "") + "</span></div>" : "");
    main.querySelectorAll(".pipe a").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); }); });
    hashFilters("projects", q);
  }

  // Suggests public artists for a project from what is recorded: disciplines,
  // techniques, the materials of their approved artworks, and their country.
  // Nothing else is assumed (no availability, prices or capabilities).
  var STOP = "about also artwork artworks being between could every from have hotel into large looking made make more need office piece pieces project should small some space that their there these they this those want which while with would your".split(" ");
  function words(text) {
    return uniq(String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(function (w) { return w.length > 3 && STOP.indexOf(w) === -1; }));
  }
  function termList(text) { return String(text || "").split(/[,;\/\n·•|]+/).map(function (t) { return t.trim(); }).filter(function (t) { return t.length > 1; }); }
  function matchArtists(p, artists, works) {
    var projectWords = words([p.artwork_type, p.description, p.style_refs, p.quantity_dims].join(" "));
    var place = String(p.location || "").toLowerCase();
    function hits(term) { var w = words(term); return w.length && w.some(function (x) { return projectWords.indexOf(x) !== -1 || projectWords.some(function (y) { return y.length > 4 && (y.indexOf(x) === 0 || x.indexOf(y) === 0); }); }); }
    return artists.map(function (a) {
      var why = [], score = 0;
      termList([a.main_discipline, a.other_disciplines].join(",")).forEach(function (t) { if (hits(t)) { why.push("Discipline: " + t); score += 3; } });
      termList(a.techniques).forEach(function (t) { if (hits(t)) { why.push("Technique: " + t); score += 2; } });
      uniq(works.filter(function (w) { return w.artist_id === a.id; }).map(function (w) { return w.materials; }).join(",").split(/[,;\/\n]+/).map(function (t) { return t.trim(); }))
        .forEach(function (t) { if (t && hits(t) && why.indexOf("Technique: " + t) === -1) { why.push("Artwork material: " + t); score += 2; } });
      if (a.country && place && place.indexOf(a.country.toLowerCase()) !== -1) { why.push("Based in " + a.country + ", the project location"); score += 2; }
      else if (a.country && p.client_country && a.country === p.client_country) { why.push("Based in " + a.country + ", the client's country"); score += 1; }
      return { artist: a, why: uniq(why), score: score };
    }).filter(function (m) { return m.score > 0; }).sort(function (x, y) { return y.score - x.score; });
  }

  var EVENT_LABEL = {
    created: "Request received", status: "Status changed", reopened: "Reopened", assigned: "Assignment changed",
    artist_considered: "Artist considered", artist_recommended: "Artist recommended", artist_removed: "Artist removed from the list",
    task_added: "Follow-up added", task_done: "Follow-up completed", task_reopened: "Follow-up reopened", task_deleted: "Follow-up deleted", money: "Value and revenue updated"
  };
  function eventText(e) {
    var d = e.detail || {};
    if (e.kind === "status" || e.kind === "reopened") return (PROJECT_STATUS[d.from] || [d.from])[0] + " → " + (PROJECT_STATUS[d.to] || [d.to])[0] + (d.reason ? " · " + (REASON_LABEL[d.reason] || d.reason) : "") + (d.note ? ": " + d.note : "");
    if (e.kind === "assigned") return d.to_name ? "Assigned to " + d.to_name : "Unassigned";
    if (/^artist_/.test(e.kind)) return d.name || "";
    if (/^task_/.test(e.kind)) return d.title || "";
    if (e.kind === "money") return [d.payment_status ? "Payment: " + (PAYMENT_LABEL[d.payment_status] || d.payment_status) : ""].join("");
    return "";
  }

  async function viewProject(id) {
    var pr = await sb.from("project_requests").select("*").eq("id", id).maybeSingle();
    if (pr.error) throw pr.error;
    var p = pr.data;
    if (!p) { main.innerHTML = '<div class="empty">This project could not be found. <a class="link" href="#/projects">Back to projects</a></div>'; return; }
    var res = await Promise.all([
      sb.rpc("can_manage_project", { p_id: id }),
      sb.from("project_notes").select("*").eq("project_id", id).order("created_at", { ascending: true }),
      sb.from("project_artists").select("*").eq("project_id", id).order("updated_at", { ascending: false }),
      sb.from("project_tasks").select("*").eq("project_id", id).order("due_on", { ascending: true }),
      sb.from("project_events").select("*").eq("project_id", id).order("at", { ascending: false }).limit(100),
      p.member_id ? sb.from("member_accounts").select("email, phone, professional_website, business_website").eq("id", p.member_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("public_artists").select("id, display_name, main_discipline, other_disciplines, techniques, country, city").order("display_name"),
      sb.from("public_artworks").select("artist_id, materials")
    ]);
    var manage = res[0].data === true, notes = res[1].data || [], chosen = res[2].data || [], tasks = res[3].data || [], events = res[4].data || [];
    var contact = res[5].data, publicArtists = res[6].data || [], publicWorks = res[7].data || [];
    var chosenIds = chosen.map(function (c) { return c.artist_id; });
    var names = {}; publicArtists.forEach(function (a) { names[a.id] = a.display_name; });
    Object.assign(names, await artistNames(chosenIds.filter(function (i) { return !names[i]; })));
    var suggestions = matchArtists(p, publicArtists, publicWorks).filter(function (m) { return chosenIds.indexOf(m.artist.id) === -1; }).slice(0, 8);
    var others = publicArtists.filter(function (a) { return chosenIds.indexOf(a.id) === -1; });
    var t = today();
    var assignee = p.assigned_to ? teamName(p.assigned_to) : "";
    var canClaim = !p.assigned_to && me.role === "sales";

    function field(label, v) { return v ? "<span>" + esc(label) + "</span><b>" + v + "</b>" : ""; }
    var dis = manage ? "" : " disabled";

    main.innerHTML =
      '<a class="link small" href="#/projects">Back to projects</a>' +
      '<div class="head"><div><span class="eyebrow">' + esc(p.reference) + " · received " + esc(M.fmtDate(p.created_at, true)) + "</span>" +
      "<h1>" + esc(p.client_organization || p.client_name) + "</h1><p>" + esc(p.artwork_type) + "</p></div>" +
      '<div class="row">' + tag(PROJECT_STATUS, p.status) + "</div></div>" +
      (!manage ? '<div class="notice">' + (canClaim ? "Nobody is working on this project yet. Take it to manage it." : "You can read this project and add notes. Founders and the assigned team member can change it.") + "</div>" : "") +
      '<div class="rgrid"><div class="stack">' +

      '<section class="rblock"><h3>The request</h3><p class="prose">' + esc(p.description) + '</p><div class="kv">' +
      field("Type of artwork", esc(p.artwork_type)) +
      field("Estimated budget", p.budget_undecided ? "Not decided yet" : esc(p.budget)) +
      field("Timeline", p.timeline_undecided ? "Not decided yet" : esc(p.timeline)) +
      field("Location", esc(p.location)) + field("Quantity and dimensions", esc(p.quantity_dims)) + field("Style and references", esc(p.style_refs)) +
      "</div></section>" +

      '<section class="rblock"><div class="between"><h3>Artists</h3><span class="small muted">Internal. Nothing here is sent to the client.</span></div>' +
      (chosen.length ? chosen.map(function (c) {
        return '<div class="match"><div><b>' + esc(names[c.artist_id] || "Artist") + "</b> " + (c.state === "recommended" ? '<span class="tag ok">Recommended</span>' : '<span class="tag">Considered</span>') +
          (c.reason ? '<p class="small" style="margin-top:4px">' + esc(c.reason) + "</p>" : "") + "</div>" +
          '<div class="row" style="align-self:start">' + (names[c.artist_id] && publicArtists.some(function (a) { return a.id === c.artist_id; }) ? '<a class="link small" href="/artists/' + c.artist_id + '" target="_blank" rel="noopener">Profile</a>' : '<span class="small muted">No longer public</span>') +
          (manage ? '<button class="btn line sm" type="button" data-artist="' + c.artist_id + '" data-state="' + (c.state === "recommended" ? "considered" : "recommended") + '" data-reason="' + esc(c.reason) + '">' + (c.state === "recommended" ? "Mark as considered" : "Recommend") + "</button>" +
            '<button class="btn quiet sm" type="button" data-unartist="' + c.artist_id + '">Remove</button>' : "") + "</div></div>";
      }).join("") : '<p class="small muted">No artists recorded yet.</p>') +
      '<h4 style="margin:10px 0 0;font-size:14px">Possible matches</h4><p class="small muted">From approved, public profiles only, based on recorded disciplines, techniques, artwork materials and country.</p>' +
      (suggestions.length ? suggestions.map(function (m) {
        var a = m.artist;
        return '<div class="match"><div><b>' + esc(a.display_name) + '</b> <span class="small muted">' + esc([a.main_discipline, place(a)].filter(Boolean).join(" · ")) + "</span>" +
          '<div class="why">' + m.why.map(function (w) { return "<span>" + esc(w) + "</span>"; }).join("") + "</div></div>" +
          '<div class="row" style="align-self:start"><a class="link small" href="/artists/' + a.id + '" target="_blank" rel="noopener">Profile</a>' +
          (manage ? '<button class="btn line sm" type="button" data-artist="' + a.id + '" data-state="considered" data-reason="' + esc(m.why.join("; ")) + '">Consider</button>' : "") + "</div></div>";
      }).join("") : '<p class="small muted">No public artist matches the words in this request. You can still choose one below.</p>') +
      (manage && others.length ? '<div class="row"><label class="visually-hidden" for="pick-artist">Choose a public artist</label><select class="inp" id="pick-artist" style="width:auto;flex:1;min-width:220px">' +
        others.map(function (a) { return '<option value="' + a.id + '">' + esc(a.display_name + (a.main_discipline ? " · " + a.main_discipline : "")) + "</option>"; }).join("") +
        '</select><button class="btn line sm" type="button" id="b-pick">Consider this artist</button></div>' : "") +
      "</section>" +

      '<section class="rblock"><h3>Follow-ups</h3>' +
      (tasks.length ? '<div class="list">' + tasks.map(function (k) {
        var late = !k.done && k.due_on < t, can = manage || k.assigned_to === me.user.id;
        return '<div class="lrow"><div class="lm"><b>' + (k.done ? "✓ " : "") + esc(k.title) + '</b><span class="muted small">' + esc(teamName(k.assigned_to) || "Unassigned") + " · due " + esc(M.fmtDate(k.due_on)) +
          (k.notes ? " · " + esc(k.notes) : "") + "</span></div>" +
          '<div class="row">' + (late ? '<span class="tag overdue">Overdue</span>' : k.done ? '<span class="tag ok">Done</span>' : "") +
          (can ? '<button class="btn line sm" type="button" data-task="' + k.id + '" data-done="' + (!k.done) + '">' + (k.done ? "Reopen" : "Mark done") + "</button>" : "") +
          (manage ? '<button class="btn quiet sm" type="button" data-deltask="' + k.id + '" aria-label="Delete follow-up">Delete</button>' : "") + "</div></div>";
      }).join("") + "</div>" : '<p class="small muted">No follow-ups yet.</p>') +
      (manage ? '<form class="stack" id="task-form" novalidate style="gap:10px"><div class="grid2"><label class="f">Follow-up<input class="inp" name="title" maxlength="200" placeholder="For example: send the proposal"></label>' +
        '<label class="f">Due date<input class="inp" name="due" type="date" value="' + t + '"></label></div>' +
        '<div class="grid2"><label class="f">Assigned to<select class="inp" name="assignee">' + salesPeople().map(function (m) { return '<option value="' + m.user_id + '"' + (m.user_id === (p.assigned_to || me.user.id) ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>Notes <span class="opt">optional</span></span><input class="inp" name="notes" maxlength="2000"></label></div>' +
        '<p class="err" id="task-err" hidden></p><div><button class="btn line sm" type="submit">Add follow-up</button></div></form>' : "") +
      "</section>" +

      '<section class="rblock"><h3>Value and revenue</h3><p class="small muted">Recorded by hand. The client\'s project value and M.E.E.T.\'s own revenue are kept apart, and nothing is calculated from a rate. Payment status is what the team records; the website does not process or verify payments.</p>' +
      '<form class="money" id="money" novalidate>' +
      '<label class="f">Currency<input class="inp" name="currency" maxlength="3" list="currencies" autocapitalize="characters" value="' + esc(p.currency) + '"' + dis + '></label>' +
      '<label class="f">Estimated project value <span class="hint">The client\'s budget for the whole project.</span><input class="inp" name="estimated_value" inputmode="decimal" value="' + esc(p.estimated_value == null ? "" : p.estimated_value) + '"' + dis + "></label>" +
      '<label class="f full">Agreed M.E.E.T. fee or commission <span class="hint">As agreed with the client or artist, for example "10% of the artwork price" or "USD 3,000".</span><input class="inp" name="fee_terms" maxlength="300" value="' + esc(p.fee_terms) + '"' + dis + "></label>" +
      '<label class="f">Final project value <span class="hint">Once confirmed.</span><input class="inp" name="final_value" inputmode="decimal" value="' + esc(p.final_value == null ? "" : p.final_value) + '"' + (manage && p.status === "confirmed" ? "" : " disabled") + "></label>" +
      '<label class="f">Final M.E.E.T. revenue <span class="hint">What M.E.E.T. earns. Once confirmed.</span><input class="inp" name="final_revenue" inputmode="decimal" value="' + esc(p.final_revenue == null ? "" : p.final_revenue) + '"' + (manage && p.status === "confirmed" ? "" : " disabled") + "></label>" +
      '<label class="f">Payment status <span class="hint">Recorded by hand.</span><select class="inp" name="payment_status"' + dis + ">" + PAYMENT.map(function (o) { return '<option value="' + o[0] + '"' + (p.payment_status === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f full">Notes and dates <span class="opt">optional</span><textarea class="inp" name="revenue_notes" rows="3" maxlength="2000"' + dis + ">" + esc(p.revenue_notes) + "</textarea></label>" +
      (manage ? '<p class="err full" id="money-err" hidden></p><div class="full"><button class="btn line sm" type="submit">Save value and revenue</button></div>' : "") +
      '</form><datalist id="currencies"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option><option>SAR</option></datalist></section>' +

      '<section class="rblock"><h3>Internal notes</h3><p class="small muted">Visible to founders and the sales team only. Never shown to the client or to artists.</p>' +
      (notes.map(function (n) { return '<div class="note"><span class="muted">' + esc(teamName(n.author) || "Team") + " · " + esc(M.fmtDate(n.created_at, true)) + "</span>" + esc(n.body).replace(/\n/g, "<br>") + "</div>"; }).join("") || '<p class="small muted">No notes yet.</p>') +
      '<label class="f">Add a note<textarea class="inp" id="note" rows="3" maxlength="4000"></textarea></label><div><button class="btn line sm" type="button" id="b-note">Save note</button></div></section>' +
      "</div>" +

      '<aside class="raside">' +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">Pipeline</h3>' + tag(PROJECT_STATUS, p.status) +
      (p.status === "not_confirmed" && p.not_confirmed_reason ? '<p class="small">Reason: ' + esc(REASON_LABEL[p.not_confirmed_reason]) + (p.not_confirmed_note ? ". " + esc(p.not_confirmed_note) : "") + "</p>" : "") +
      '<p class="small muted">The client sees: ' + esc(CLIENT_LABEL[clientStatus(p.status)]) + ".</p>" +
      (manage ? '<button class="btn sm" type="button" id="b-status">' + (p.status === "not_confirmed" ? "Reopen or change status" : "Change status") + "</button>" : "") + "</div>" +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">Responsible</h3>' +
      "<p>" + (assignee ? "<b>" + esc(assignee) + "</b>" + (p.assigned_to === me.user.id ? " (you)" : "") : '<span class="muted">Nobody yet</span>') + "</p>" +
      (me.role === "founder" ? '<label class="visually-hidden" for="assign">Assign to</label><select class="inp" id="assign"><option value="">Unassigned</option>' +
        salesPeople().map(function (m) { return '<option value="' + m.user_id + '"' + (p.assigned_to === m.user_id ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("") + "</select>"
        : canClaim ? '<button class="btn line sm" type="button" id="b-claim">Take this project</button>' : "") + "</div>" +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">Client</h3><div class="kv">' +
      field("Name", esc(p.client_name)) + field(p.client_type === "business" ? "Organization" : "Company or studio", esc(p.client_organization)) +
      field("Account type", esc(ACCOUNT_LABEL[p.client_type])) + field("Country", esc(p.client_country || "Not recorded")) +
      (contact ? field("Email", '<a class="link" href="mailto:' + esc(contact.email) + '">' + esc(contact.email) + "</a>") + field("Phone", esc(contact.phone)) : "") +
      "</div>" + (!p.member_id ? '<p class="small muted">The client\'s account has been deleted.</p>' : "") + "</div>" +
      '<div class="panel stack" style="gap:10px"><h3 style="font-size:22px">History</h3><div class="timeline">' +
      (events.map(function (e) { return "<div><b>" + esc(EVENT_LABEL[e.kind] || e.kind) + "</b>" + (eventText(e) ? "<br>" + esc(eventText(e)) : "") + '<br><span class="muted small">' + esc(e.actor_name || "Client") + " · " + esc(M.fmtDate(e.at, true)) + "</span></div>"; }).join("") || '<p class="small muted">No history yet.</p>') +
      "</div></div></aside></div>";

    function reload() { viewProject(id); renderNav("projects"); }
    async function call(fn, args, done) { var r = await sb.rpc(fn, args); if (r.error) { fail(r.error); return false; } if (done) M.toast(done); reload(); return true; }

    var assign = main.querySelector("#assign");
    if (assign) assign.addEventListener("change", function () { call("assign_project", { p_id: id, p_user: assign.value || null }, "Assignment updated."); });
    var claim = main.querySelector("#b-claim");
    if (claim) claim.addEventListener("click", function () { call("assign_project", { p_id: id, p_user: me.user.id }, "This project is now yours."); });
    var bs = main.querySelector("#b-status");
    if (bs) bs.addEventListener("click", function () { openProjectStatus(p, reload); });
    main.querySelector("#b-note").addEventListener("click", async function () {
      var body = main.querySelector("#note").value.trim();
      if (!body) { M.toast("Write a note first."); return; }
      M.setBusy(this, true, "Saving");
      if (!(await call("add_project_note", { p_id: id, p_body: body }, "Note saved."))) M.setBusy(this, false);
    });
    var pick = main.querySelector("#b-pick");
    if (pick) pick.addEventListener("click", function () { openArtistReason(id, main.querySelector("#pick-artist").value, names[main.querySelector("#pick-artist").value] || publicArtists.filter(function (a) { return a.id === main.querySelector("#pick-artist").value; })[0].display_name, "considered", "", reload); });
    var tf = main.querySelector("#task-form");
    if (tf) tf.addEventListener("submit", async function (e) {
      e.preventDefault();
      var err = main.querySelector("#task-err");
      if (tf.elements.title.value.trim().length < 2 || !tf.elements.due.value) { err.textContent = "Please describe the follow-up and choose a due date."; err.hidden = false; return; }
      await call("add_project_task", { p_id: id, p_title: tf.elements.title.value, p_assignee: tf.elements.assignee.value || null, p_due: tf.elements.due.value, p_notes: tf.elements.notes.value }, "Follow-up added.");
    });
    var mf = main.querySelector("#money");
    if (mf && manage) mf.addEventListener("submit", async function (e) {
      e.preventDefault();
      var v = {}, err = main.querySelector("#money-err");
      ["currency", "estimated_value", "fee_terms", "final_value", "final_revenue", "payment_status", "revenue_notes"].forEach(function (k) { if (!mf.elements[k].disabled) v[k] = mf.elements[k].value.trim(); });
      if (mf.elements.final_value.disabled) { v.final_value = p.final_value == null ? "" : String(p.final_value); v.final_revenue = p.final_revenue == null ? "" : String(p.final_revenue); }
      ["estimated_value", "final_value", "final_revenue"].forEach(function (k) { v[k] = String(v[k] || "").replace(/[\s,]/g, ""); });
      var r = await sb.rpc("update_project_money", { p_id: id, p: v });
      if (r.error) { err.textContent = M.friendlyError(r.error); err.hidden = false; return; }
      M.toast("Value and revenue saved."); reload();
    });
    main.onclick = function (e) {
      var a = e.target.closest("[data-artist]"), u = e.target.closest("[data-unartist]"), k = e.target.closest("[data-task]"), d = e.target.closest("[data-deltask]");
      if (a) openArtistReason(id, a.getAttribute("data-artist"), names[a.getAttribute("data-artist")] || "this artist", a.getAttribute("data-state"), a.getAttribute("data-reason") || "", reload);
      if (u) call("remove_project_artist", { p_id: id, p_artist: u.getAttribute("data-unartist") }, "Removed from the list.");
      if (k) call("set_project_task_done", { p_task: k.getAttribute("data-task"), p_done: k.getAttribute("data-done") === "true" }, "Follow-up updated.");
      if (d && confirm("Delete this follow-up?")) call("delete_project_task", { p_task: d.getAttribute("data-deltask") }, "Follow-up deleted.");
    };
  }

  function openArtistReason(projectId, artistId, name, state, reason, done) {
    M.modal(
      "<h2>" + (state === "recommended" ? "Recommend" : "Consider") + " <em>" + esc(name) + "</em></h2>" +
      '<p class="muted">Why is this artist a good match? This stays internal: nothing is sent to the client until the team decides to share it.</p>' +
      '<label class="f">Reason<textarea class="inp" id="m-why" rows="4" maxlength="2000">' + esc(reason) + "</textarea></label>" +
      '<p class="err" id="m-err" hidden></p><div class="row"><button class="btn" type="button" id="m-go">Save</button><button class="btn line" type="button" data-close>Cancel</button></div>',
      function (box, close) {
        box.querySelector("#m-go").addEventListener("click", async function () {
          var why = box.querySelector("#m-why").value.trim(), err = box.querySelector("#m-err");
          if (why.length < 3) { err.textContent = "Please write why this artist could be a good match."; err.hidden = false; return; }
          M.setBusy(this, true, "Saving");
          var r = await sb.rpc("set_project_artist", { p_id: projectId, p_artist: artistId, p_state: state, p_reason: why });
          if (r.error) { M.setBusy(this, false); err.textContent = M.friendlyError(r.error); err.hidden = false; return; }
          close(); M.toast(state === "recommended" ? "Artist recommended." : "Artist added as considered."); done();
        });
      });
  }

  function openProjectStatus(p, done) {
    M.modal(
      "<h2>Pipeline <em>status</em></h2><p class=\"muted\">" + esc(p.reference) + " · " + esc(p.client_organization || p.client_name) + "</p>" +
      '<label class="f">New status<select class="inp" id="m-status">' + PIPE.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === p.status ? " selected" : "") + ">" + esc(s[1]) + "</option>"; }).join("") + "</select></label>" +
      '<fieldset class="fs" id="m-reasons" hidden><legend style="font-family:var(--sans);font-size:13px;font-weight:600">Why was it not confirmed?</legend>' +
      REASONS.map(function (r) { return '<label class="row small" style="font-weight:500"><input type="radio" name="m-reason" value="' + r[0] + '"' + (p.not_confirmed_reason === r[0] ? " checked" : "") + "> " + esc(r[1]) + "</label>"; }).join("") +
      '<label class="f"><span>Explanation <span class="opt" id="m-note-opt">optional</span></span><textarea class="inp" id="m-note" rows="3" maxlength="1000">' + esc(p.not_confirmed_note || "") + "</textarea></label></fieldset>" +
      '<label class="row small" style="font-weight:500" id="m-mail-row" hidden><input type="checkbox" id="m-mail"> <span id="m-mail-text"></span></label>' +
      '<p class="err" id="m-err" hidden></p><div class="row"><button class="btn" type="button" id="m-go">Save status</button><button class="btn line" type="button" data-close>Cancel</button></div>',
      function (box, close) {
        var sel = box.querySelector("#m-status");
        function sync() {
          var to = sel.value, nc = to === "not_confirmed";
          box.querySelector("#m-reasons").hidden = !nc;
          var cFrom = clientStatus(p.status), cTo = clientStatus(to), show = cFrom !== cTo && cTo !== "received";
          box.querySelector("#m-mail-row").hidden = !show;
          box.querySelector("#m-mail").checked = show && cTo !== "closed";
          box.querySelector("#m-mail-text").textContent = "Email the client that their request is now “" + CLIENT_LABEL[cTo] + "”";
          var other = (box.querySelector('input[name="m-reason"]:checked') || {}).value === "other";
          box.querySelector("#m-note-opt").textContent = other ? "required for Other" : "optional";
        }
        sel.addEventListener("change", sync);
        box.querySelectorAll('input[name="m-reason"]').forEach(function (r) { r.addEventListener("change", sync); });
        sync();
        box.querySelector("#m-go").addEventListener("click", async function () {
          var to = sel.value, err = box.querySelector("#m-err");
          var reason = (box.querySelector('input[name="m-reason"]:checked') || {}).value || null, note = box.querySelector("#m-note").value.trim();
          if (to === "not_confirmed" && !reason) { err.textContent = "Please choose why the project was not confirmed."; err.hidden = false; return; }
          if (to === "not_confirmed" && reason === "other" && note.length < 3) { err.textContent = "Please explain the reason."; err.hidden = false; return; }
          M.setBusy(this, true, "Saving");
          try {
            var res = await M.api("sales-status", { id: p.id, status: to, reason: to === "not_confirmed" ? reason : null, note: to === "not_confirmed" ? note : "", notify: !box.querySelector("#m-mail-row").hidden && box.querySelector("#m-mail").checked });
            close(); M.toast(!res.changed ? "No change." : res.emailed ? "Status saved. The client was emailed." : "Status saved."); done();
          } catch (ex) { M.setBusy(this, false); err.textContent = M.friendlyError(ex); err.hidden = false; }
        });
      });
  }

  async function viewFollowups(q) {
    var tab = q.get("tab") || "overdue", who = q.get("who") || "mine";
    var r = await sb.from("project_tasks").select("*, project_requests(id, reference, client_name, client_organization, assigned_to)").order("due_on", { ascending: true }).limit(5000);
    if (r.error) throw r.error;
    var t = today();
    var all = (r.data || []).filter(function (k) { return who !== "mine" || k.assigned_to === me.user.id; });
    var groups = {
      overdue: all.filter(function (k) { return !k.done && k.due_on < t; }),
      upcoming: all.filter(function (k) { return !k.done && k.due_on >= t; }),
      done: all.filter(function (k) { return k.done; }).reverse()
    };
    var rows = groups[tab] || [];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Sales</span><h1>Follow-ups</h1><p>Tasks attached to projects. ' +
      "A reminder email goes to each person on the morning a follow-up is due, and again each morning while it is overdue.</p></div></div>" +
      '<div class="filters"><div class="chips" role="group" aria-label="Which follow-ups">' +
      [["overdue", "Overdue"], ["upcoming", "Upcoming"], ["done", "Completed"]].map(function (c) {
        return '<button class="chip" type="button" data-f="tab" data-v="' + c[0] + '" aria-pressed="' + (tab === c[0]) + '">' + esc(c[1]) + " · " + groups[c[0]].length + "</button>";
      }).join("") + "</div>" +
      '<div class="toolbar"><label class="visually-hidden" for="f-who">Whose follow-ups</label><select class="inp" id="f-who" data-sel="who">' +
      [["mine", "Assigned to me"], ["all", "Everyone"]].map(function (o) { return '<option value="' + o[0] + '"' + (who === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      (me.role === "founder" ? '<button class="btn line sm" type="button" data-job="reminders">Send due reminders now</button>' : "") + "</div></div>" +
      (rows.length ? '<div class="list">' + rows.map(function (k) {
        var pr = k.project_requests || {};
        return '<div class="lrow"><div class="lm"><b>' + esc(k.title) + '</b><span class="muted small"><a class="link" href="#/project/' + pr.id + '">' + esc(pr.reference || "") + " · " + esc(pr.client_organization || pr.client_name || "") + "</a> · " + esc(teamName(k.assigned_to) || "Unassigned") + (k.notes ? " · " + esc(k.notes) : "") + "</span></div>" +
          '<div class="ls">' + (tab === "overdue" ? '<span class="tag overdue">Due ' + esc(M.fmtDate(k.due_on)) + "</span>" : '<span class="muted small">' + (tab === "done" ? "Done " + esc(M.fmtDate(k.done_at)) : "Due " + esc(M.fmtDate(k.due_on))) + "</span>") +
          (k.assigned_to === me.user.id || me.role === "founder" || pr.assigned_to === me.user.id ? '<button class="btn line sm" type="button" data-task="' + k.id + '" data-done="' + (!k.done) + '">' + (k.done ? "Reopen" : "Mark done") + "</button>" : "") + "</div></div>";
      }).join("") + "</div>" : '<div class="empty">' + (tab === "overdue" ? "Nothing overdue." : tab === "upcoming" ? "No upcoming follow-ups." : "No completed follow-ups yet.") + "</div>");
    hashFilters("followups", q);
    runJobButtons();
    main.onclick = async function (e) {
      var k = e.target.closest("[data-task]");
      if (!k) return;
      var x = await sb.rpc("set_project_task_done", { p_task: k.getAttribute("data-task"), p_done: k.getAttribute("data-done") === "true" });
      if (x.error) return fail(x.error);
      M.toast("Follow-up updated."); route();
    };
  }

  /* Founders: reports by registered country. Counts are counts, never revenue,
     and amounts in different currencies are never added together. */
  async function viewReports(q) {
    var country = q.get("country") || "";
    var res = await Promise.all([
      sb.from("artist_inquiries").select("status, member_country").limit(20000),
      sb.from("project_requests").select("status, client_country, currency, estimated_value, final_value, final_revenue, payment_status, not_confirmed_reason").limit(20000)
    ]);
    if (res[0].error) throw res[0].error;
    if (res[1].error) throw res[1].error;
    var inq = res[0].data || [], prj = res[1].data || [];
    function c(v) { return v || "Not recorded"; }
    var countries = uniq(inq.map(function (x) { return c(x.member_country); }).concat(prj.map(function (x) { return c(x.client_country); }))).sort();
    var inqF = inq.filter(function (x) { return !country || c(x.member_country) === country; });
    var prjF = prj.filter(function (x) { return !country || c(x.client_country) === country; });
    function byCountry(list, key) { var m = {}; list.forEach(function (x) { (m[c(x[key])] = m[c(x[key])] || []).push(x); }); return Object.keys(m).sort().map(function (k) { return [k, m[k]]; }); }
    function n(list, f) { return list.filter(f).length; }
    function table(head, rows) {
      return '<div class="rwrap"><table class="rtable"><thead><tr>' + head.map(function (h, i) { return "<th" + (i ? ' class="n"' : "") + ">" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        (rows.length ? rows.map(function (r) { return "<tr>" + r.map(function (v, i) { return "<td" + (i ? ' class="n"' : "") + ">" + v + "</td>"; }).join("") + "</tr>"; }).join("") : '<tr><td colspan="' + head.length + '" class="muted">No data yet.</td></tr>') +
        "</tbody></table></div>";
    }
    function sums(list, key) {
      var m = {};
      list.forEach(function (x) { if (x[key] != null && x.currency) m[x.currency] = (m[x.currency] || 0) + Number(x[key]); });
      var k = Object.keys(m);
      return k.length ? k.sort().map(function (cur) { return esc(money(m[cur], cur)); }).join("<br>") : '<span class="muted">None recorded</span>';
    }
    var open = prjF.filter(function (x) { return ["new", "contacted", "proposal_sent", "negotiation"].indexOf(x.status) !== -1; });
    var confirmed = prjF.filter(function (x) { return x.status === "confirmed"; });
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Founders</span><h1>Reports</h1>' +
      "<p>By each person's registered country, as given in their account. Inquiry counts are not revenue. Amounts in different currencies are shown separately and never added together.</p></div>" +
      '<div class="toolbar"><label class="visually-hidden" for="f-country">Country</label><select class="inp" id="f-country">' + countryOptions(countries, country, "All countries") + "</select>" +
      '<button class="btn line sm" type="button" data-job="export">Email the export now</button></div></div>' +
      '<p class="small muted">Every Monday at 05:00 UTC, founders receive an email with CSV copies of all inquiry and sales records. It is a copy of the records, not a full database backup.</p>' +
      '<section class="rblock"><h3>Revenue records</h3><p class="small muted">From the figures the team recorded by hand.</p>' +
      table(["", "Projects", "Amounts"], [
        ["Open pipeline, estimated project value", String(open.length), sums(open, "estimated_value")],
        ["Confirmed projects, final project value", String(confirmed.length), sums(confirmed, "final_value")],
        ["Confirmed projects, recorded M.E.E.T. revenue", String(confirmed.length), sums(confirmed, "final_revenue")],
        ["Confirmed projects marked paid in full", String(n(confirmed, function (x) { return x.payment_status === "paid"; })), ""]
      ]) + "</section>" +
      '<section class="rblock"><h3>Artist inquiries by country</h3>' +
      table(["Member country", "Total", "New", "Viewed", "Responded", "Closed"], byCountry(inqF, "member_country").map(function (r) {
        return [esc(r[0]), String(r[1].length)].concat(["new", "viewed", "responded", "closed"].map(function (s) { return String(n(r[1], function (x) { return x.status === s; })); }));
      })) + "</section>" +
      '<section class="rblock"><h3>Project requests by country and pipeline status</h3>' +
      table(["Client country", "Total"].concat(PIPE.map(function (s) { return s[1]; })), byCountry(prjF, "client_country").map(function (r) {
        return [esc(r[0]), String(r[1].length)].concat(PIPE.map(function (s) { return String(n(r[1], function (x) { return x.status === s[0]; })); }));
      })) + "</section>" +
      '<section class="rblock"><h3>Confirmed projects by country</h3>' +
      table(["Client country", "Confirmed", "Final project value", "Recorded M.E.E.T. revenue"], byCountry(confirmed, "client_country").map(function (r) {
        return [esc(r[0]), String(r[1].length), sums(r[1], "final_value"), sums(r[1], "final_revenue")];
      })) + "</section>" +
      '<section class="rblock"><h3>Why projects were not confirmed</h3>' +
      table(["Reason", "Projects"], REASONS.map(function (r) { return [esc(r[1]), String(n(prjF, function (x) { return x.status === "not_confirmed" && x.not_confirmed_reason === r[0]; }))]; })
        .filter(function (r) { return r[1] !== "0"; })) + "</section>";
    hashFilters("reports", q);
    runJobButtons();
  }

  // Founders: run a scheduled job now (same code as the schedule).
  function runJobButtons() {
    main.querySelectorAll("[data-job]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var job = b.getAttribute("data-job");
        M.setBusy(b, true, job === "export" ? "Sending" : "Running");
        try {
          var r = await M.api("run-job", { job: job });
          M.toast(job === "export" ? "Export emailed to " + r.sent + " founder" + (r.sent === 1 ? "" : "s") + "."
            : r.due ? "Reminders sent for " + r.due + " follow-up" + (r.due === 1 ? "" : "s") + "." : "No follow-ups are due today.");
        } catch (err) { fail(err); }
        M.setBusy(b, false);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Team (founders only)                                                */
  /* ------------------------------------------------------------------ */

  var ROLES = [["founder", "Founder · everything"], ["operations", "Operations · applications and studios"], ["verification", "Verification · reviews"],
    ["partnerships", "Partnerships · reviews"], ["sales", "Sales · project requests and clients"], ["viewer", "Viewer · can look, cannot change"]];

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
        var href = h.target_type === "application" ? "#/application/" + h.target_id : h.target_type === "artist" ? "#/artist/" + h.target_id
          : h.target_type === "member" && h.action !== "member.deleted" ? "#/member/" + h.target_id
          : h.target_type === "inquiry" ? "#/inquiry/" + h.target_id
          : h.target_type === "project" && isSales ? "#/project/" + h.target_id : "";
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
    // The sales role works in Sales; elsewhere it can look but not change.
    canEdit = me.role !== "viewer" && me.role !== "sales";
    isSales = me.role === "founder" || me.role === "sales";
    document.getElementById("who").textContent = me.member.name;
    var t = await sb.from("team_members").select("user_id, name, email, role, active");
    cache.team = t.data || [];
    window.addEventListener("hashchange", route);
    route();
  })();
})();
