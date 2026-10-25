/* M.E.E.T. member account: profile, security, inquiries to artists,
   requests to the M.E.E.T. team (commissions, collaborations, project briefs)
   with their status, updates and proposals, deletion request.
   Members can only read and edit their own row (database row level security);
   the account type and email cannot be changed here. */
(function () {
  "use strict";
  var M = window.MEET, sb, me, acct;
  var esc = M.esc;
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");

  var TYPE_LABEL = { personal: "Personal", professional: "Professional", business: "Business & Organization" };
  var FIELDS = {
    personal: [["full_name", "Full name", true], ["country", "Country", true], ["phone", "Phone number", false]],
    professional: [["full_name", "Full name", true], ["country", "Country", true], ["phone", "Phone number", false],
      ["professional_role", "Professional role", true], ["company_name", "Company or studio name", true], ["professional_website", "Professional website", false]],
    business: [["business_name", "Business or organization name", true], ["business_type", "Business type", true],
      ["contact_person", "Contact person's name", true], ["business_website", "Business website", false],
      ["full_name", "Your full name", true], ["country", "Country", true], ["phone", "Phone number", false]]
  };

  function looksLikeUrl(v) {
    var s = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v;
    try { var u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.indexOf(".") > 0 && !/\s/.test(v); }
    catch (e) { return false; }
  }

  function renderNav(current) {
    var items = [["", "Overview"], ["inquiries", "Inquiries"], ["requests", "Requests"]];
    items.push(["profile", "Profile"], ["security", "Security"]);
    items.push(["delete", "Delete account"]);
    nav.innerHTML = items.map(function (i) {
      return '<a class="ni" href="#/' + i[0] + '"' + (current === i[0] ? ' aria-current="page"' : "") + ">" + esc(i[1]) + "</a>";
    }).join("") + '<a class="ni" href="/artists">Discover artists</a>';
  }

  async function load() {
    var r = await sb.from("member_accounts").select("*").eq("id", me.user.id).single();
    if (r.error) throw r.error;
    acct = r.data;
  }

  async function route() {
    var view = location.hash.replace(/^#\/?/, "").split("/")[0] || "";
    main.onclick = null;
    try {
      await load();
      renderNav(view === "request" || view === "projects" ? "requests" : view);
      if (view === "") viewOverview();
      else if (view === "profile") viewProfile();
      else if (view === "security") viewSecurity();
      else if (view === "inquiries") await viewInquiries();
      else if (view === "requests" || view === "projects") await viewRequests();
      else if (view === "request") await viewRequest(location.hash.split("/")[2] || "");
      else if (view === "delete") viewDelete();
      else location.hash = "#/";
    } catch (err) {
      main.innerHTML = '<div class="empty">This page could not be loaded. ' + esc(M.friendlyError(err)) + "</div>";
    }
    main.focus({ preventScroll: true });
  }

  function viewOverview() {
    var name = acct.account_type === "business" ? acct.business_name : acct.full_name;
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">' + esc(TYPE_LABEL[acct.account_type]) + " account</span>" +
      "<h1>Welcome, <em>" + esc((acct.full_name || "").split(" ")[0] || name) + "</em></h1>" +
      "<p>Your M.E.E.T. account. Discover artists, write to them, and follow the requests you send to the M.E.E.T. team.</p></div></div>" +
      (acct.deletion_requested_at ? '<div class="notice warn">You asked us to delete this account on ' + esc(M.fmtDate(acct.deletion_requested_at)) + ". The M.E.E.T. team will complete it and confirm by email.</div>" : "") +
      '<div class="kpis">' +
      '<a class="kpi" href="/artists"><span>Discover</span><b class="word">Artists</b><span>Browse the M.E.E.T. artist directory</span></a>' +
      '<a class="kpi" href="#/profile"><span>Your details</span><b class="word">Profile</b><span>' + esc(name) + " · " + esc(acct.country) + "</span></a>" +
      '<a class="kpi" href="#/inquiries"><span>Your messages</span><b class="word">Inquiries</b><span>To artists, and their replies</span></a>' +
      '<a class="kpi" href="#/requests"><span>With the M.E.E.T. team</span><b class="word">Requests</b><span>Commissions, collaborations' + (acct.account_type !== "personal" ? " and projects" : "") + "</span></a>" +
      "</div>";
  }

  function viewProfile() {
    var f = FIELDS[acct.account_type];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your profile</span><h1>Your <em>details</em></h1>' +
      "<p>Only you and the M.E.E.T. team can see these details.</p></div></div>" +
      '<form class="panel stack" id="pf" novalidate>' +
      '<div class="kv"><span>Account type</span><b>' + esc(TYPE_LABEL[acct.account_type]) + '</b><span>Email</span><b>' + esc(acct.email) + "</b></div>" +
      '<p class="small muted">To change your email address or account type, write to <a class="link" href="mailto:minds.exploring.traditions@gmail.com">minds.exploring.traditions@gmail.com</a>.</p>' +
      f.map(function (x) {
        var type = x[0] === "phone" ? "tel" : "text";
        var extra = x[0] === "country" ? ' list="country-list" autocomplete="country-name"' : /website/.test(x[0]) ? ' inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://"' : "";
        return '<label class="f">' + (x[2] ? esc(x[1]) : "<span>" + esc(x[1]) + ' <span class="opt">optional</span></span>') +
          '<input class="inp" name="' + x[0] + '" type="' + type + '" maxlength="300" value="' + esc(acct[x[0]] || "") + '"' + extra + "></label>";
      }).join("") +
      '<p class="err" id="pf-err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn" type="submit" id="b-save">Save changes</button></div></form>' +
      '<datalist id="country-list"></datalist>';
    (window.MEET_PLACES || []).forEach(function (c) { var o = document.createElement("option"); o.value = c[0]; main.querySelector("#country-list").appendChild(o); });

    var form = main.querySelector("#pf");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var err = main.querySelector("#pf-err");
      var v = {}, missing = [];
      f.forEach(function (x) {
        v[x[0]] = form.elements[x[0]].value.trim();
        if (x[2] && !v[x[0]]) missing.push(x[1].toLowerCase());
      });
      if (missing.length) { err.textContent = "Please fill in: " + missing.join(", ") + "."; err.hidden = false; return; }
      if (v.phone && !/^[+()0-9\s.-]{6,40}$/.test(v.phone)) { err.textContent = "Please use digits only for the phone number, with an optional + and country code."; err.hidden = false; return; }
      var badSite = ["professional_website", "business_website"].filter(function (k) { return v[k] && !looksLikeUrl(v[k]); })[0];
      if (badSite) { err.textContent = "Please enter a full web address, for example https://studio.com"; err.hidden = false; form.elements[badSite].focus(); return; }
      err.hidden = true;
      var b = main.querySelector("#b-save");
      M.setBusy(b, true, "Saving");
      var r = await sb.from("member_accounts").update(v).eq("id", acct.id);
      M.setBusy(b, false);
      if (r.error) { err.textContent = M.friendlyError(r.error); err.hidden = false; return; }
      M.toast("Profile saved.");
      route();
    });
  }

  function viewSecurity() {
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Security</span><h1>Sign-in and <em>security</em></h1></div></div>' +
      '<form class="panel stack" id="pw" novalidate><h3 style="font-size:24px">Change your password</h3>' +
      '<div class="grid2"><label class="f">New password<input class="inp" name="p1" type="password" minlength="8" autocomplete="new-password"><span class="hint">At least 8 characters.</span></label>' +
      '<label class="f">Type it again<input class="inp" name="p2" type="password" minlength="8" autocomplete="new-password"></label></div>' +
      '<p class="err" id="pw-err" role="alert" hidden></p><div class="row"><button class="btn" type="submit" id="b-pw">Change password</button></div></form>' +
      '<div class="panel stack"><h3 style="font-size:24px">Signed in somewhere else?</h3>' +
      '<p class="small muted">If you signed in on a shared or lost device, sign out everywhere. You will need your password to sign in again.</p>' +
      '<div class="row"><button class="btn line" type="button" id="b-out-all">Sign out on all devices</button></div></div>' +
      '<div class="panel stack"><h3 style="font-size:24px">Forgotten password</h3><p class="small muted">You can always choose a new password from the sign-in page with <a class="link" href="/reset">Forgotten your password?</a></p></div>';
    main.querySelector("#pw").addEventListener("submit", async function (e) {
      e.preventDefault();
      var a = this.elements.p1.value, b2 = this.elements.p2.value, err = main.querySelector("#pw-err");
      var problem = a.length < 8 ? "Please use at least 8 characters." : a !== b2 ? "The two passwords do not match." : "";
      err.textContent = problem; err.hidden = !problem;
      if (problem) return;
      var btn = main.querySelector("#b-pw");
      M.setBusy(btn, true, "Saving");
      var r = await sb.auth.updateUser({ password: a });
      M.setBusy(btn, false);
      if (r.error) { err.textContent = /weak|pwned|leaked/i.test(r.error.message) ? "This password is too easy to guess or has appeared in a data leak. Please choose another." : M.friendlyError(r.error); err.hidden = false; return; }
      this.reset();
      M.toast("Password changed.");
    });
    main.querySelector("#b-out-all").addEventListener("click", async function () {
      M.setBusy(this, true, "Signing out");
      await sb.auth.signOut({ scope: "global" });
      location.replace("/signin?out=1");
    });
  }

  /* ---------------- inquiries to artists ---------------- */

  var INQ_STATUS = { new: ["New", "red"], viewed: ["Viewed", "blue"], responded: ["Responded", "ok"], closed: ["Closed", ""] };
  var TOPIC = { artwork: "An artwork", commission: "A commission", collaboration: "A collaboration or project", other: "Something else" };
  function tagOf(map, k) { var t = map[k] || [k, ""]; return '<span class="tag ' + t[1] + '">' + esc(t[0]) + "</span>"; }

  async function viewInquiries() {
    var r = await sb.from("artist_inquiries").select("*").eq("member_id", acct.id).order("created_at", { ascending: false });
    if (r.error) throw r.error;
    var rows = r.data || [];
    var names = {};
    if (rows.length) {
      var ids = rows.map(function (x) { return x.artist_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var pa = await sb.from("public_artists").select("id, display_name").in("id", ids);
      (pa.data || []).forEach(function (x) { names[x.id] = x.display_name; });
    }
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your inquiries</span><h1>Inquiries to <em>artists</em></h1>' +
      "<p>Messages you sent to artists through M.E.E.T., and their replies. Artists see your name, account type and country, never your email address or phone number.</p></div>" +
      '<div class="row"><a class="btn line sm" href="/artists">Discover artists</a></div></div>' +
      (rows.length ? '<div class="stack" style="gap:12px">' + rows.map(function (q) {
        var name = names[q.artist_id];
        return '<article class="rblock"><div class="between"><h3 style="font-size:24px">' +
          (name ? '<a class="link" href="/artists/' + q.artist_id + '">' + esc(name) + "</a>" : "An artist no longer on M.E.E.T.") + "</h3>" + tagOf(INQ_STATUS, q.status) + "</div>" +
          '<p class="small muted">' + esc(TOPIC[q.topic] || "") + (q.artwork_title ? ": “" + esc(q.artwork_title) + "”" : "") + " · sent " + esc(M.fmtDate(q.created_at, true)) + "</p>" +
          '<div class="note"><span class="muted">Your message</span>' + esc(q.message).replace(/\n/g, "<br>") + "</div>" +
          (q.response ? '<div class="note reply"><span class="muted">Reply from ' + esc(name || "the artist") + ", " + esc(M.fmtDate(q.responded_at, true)) + "</span>" + esc(q.response).replace(/\n/g, "<br>") + "</div>" : "") +
          "</article>";
      }).join("") + "</div>"
        : '<div class="empty">You have not sent any inquiries yet. Open an artist\'s profile and use "Inquire about this artist".</div>');
  }

  /* ---------------- requests to the M.E.E.T. team ---------------- */

  // What the member sees: a plain status that is never further along than the
  // team's own record, the team's updates, and the proposals sent to them.
  var KIND_LABEL = { commission: "Commission", collaboration: "Collaboration", project: "Project" };
  var STEPS = [
    ["received", "Received", "The M.E.E.T. team has your request."],
    ["under_review", "Under review", "The team is reviewing your request."],
    ["finding_artists", "Contacting artists", "The team is checking availability, pricing and timing with artists."],
    ["preparing_proposal", "Preparing your proposal", "The team is preparing a proposal for you."],
    ["proposal_ready", "Proposal ready", "Your proposal is ready. Please review it below."],
    ["in_discussion", "In discussion", "The team is refining the request with you."],
    ["confirmed", "Confirmed", "You accepted the proposal. The team will be in touch about the next steps."]
  ];
  var STEP = {}; STEPS.forEach(function (s, i) { STEP[s[0]] = { i: i, label: s[1], text: s[2] }; });
  var STEP_TAG = { received: "blue", under_review: "blue", finding_artists: "warn", preparing_proposal: "warn", proposal_ready: "red", in_discussion: "warn", confirmed: "ok", closed: "" };
  function statusTag(s) { return '<span class="tag ' + (STEP_TAG[s] || "") + '">' + esc(s === "closed" ? "Closed" : (STEP[s] || { label: s }).label) + "</span>"; }
  var PROPOSAL_STATUS = { sent: ["Waiting for your answer", "red"], accepted: ["Accepted", "ok"], changes_requested: ["You asked for changes", "warn"], declined: ["Declined", ""], withdrawn: ["Replaced or withdrawn", ""] };

  async function viewRequests() {
    var r = await sb.rpc("my_project_requests");
    if (r.error) throw r.error;
    var rows = r.data || [];
    var biz = acct.account_type !== "personal";
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your requests</span><h1>Requests to the <em>M.E.E.T. team</em></h1>' +
      "<p>Commission ideas, collaborations" + (biz ? " and project briefs" : "") + " you sent to the team. Follow each step here, read the team's updates and answer proposals.</p></div>" +
      '<div class="row"><a class="btn line sm" href="/discover#commission">New commission idea</a><a class="btn line sm" href="/collaborate">New collaboration</a>' +
      (biz ? '<a class="btn line sm" href="/start-a-project#brief">New project brief</a>' : "") + "</div></div>" +
      (rows.length ? '<div class="list">' + rows.map(function (q) {
        return '<a class="lrow" href="#/request/' + q.id + '"><div class="lm"><b>' + esc(KIND_LABEL[q.kind] || "Request") + " · " + esc(q.kind === "collaboration" ? (q.description || "").slice(0, 70) : q.artwork_type) + "</b>" +
          '<span class="muted small">' + esc(q.reference) + " · sent " + esc(M.fmtDate(q.created_at)) + "</span></div>" +
          '<div class="ls">' + (q.needs_answer ? '<span class="tag red">Your answer is needed</span>' : statusTag(q.client_status)) + "</div></a>";
      }).join("") + "</div>"
        : '<div class="empty">You have not sent a request to the team yet. Start with a <a class="link" href="/discover#commission">commission idea</a> or <a class="link" href="/collaborate">a collaboration</a>.</div>');
  }

  async function viewRequest(id) {
    var list = await sb.rpc("my_project_requests");
    if (list.error) throw list.error;
    var q = (list.data || []).filter(function (x) { return x.id === id; })[0];
    if (!q) { main.innerHTML = '<div class="empty">This request could not be found. <a class="link" href="#/requests">Back to your requests</a></div>'; return; }
    var d = await sb.rpc("my_request_detail", { p_id: id });
    if (d.error) throw d.error;
    d = d.data;
    var cur = d.client_status, closed = cur === "closed", at = closed ? -1 : (STEP[cur] || { i: 0 }).i;
    var visible = STEPS.filter(function (s, i) { return !(s[0] === "in_discussion" && at < 5 && cur !== "in_discussion"); });
    var stepper = closed ? '<div class="notice">This request is closed. You are welcome to send a new one at any time.</div>'
      : '<ol class="stepper">' + visible.map(function (s) {
        var i = STEP[s[0]].i;
        return '<li class="' + (s[0] === cur ? "now" : i < at ? "done" : "") + '"' + (s[0] === cur ? ' aria-current="step"' : "") + "><b>" + esc(s[1]) + "</b>" + (s[0] === cur ? "<span>" + esc(s[2]) + "</span>" : "") + "</li>";
      }).join("") + "</ol>";
    var open = d.proposals.filter(function (p) { return p.status === "sent"; })[0];
    function proposal(p) {
      var st = PROPOSAL_STATUS[p.status] || [p.status, ""];
      return '<article class="rblock proposal"><div class="between"><h3 style="font-size:24px">Proposal ' + p.version + "</h3>" + '<span class="tag ' + st[1] + '">' + esc(st[0]) + "</span></div>" +
        '<p class="small muted">Sent ' + esc(M.fmtDate(p.sent_at, true)) + (p.decided_at ? " · answered " + esc(M.fmtDate(p.decided_at, true)) : "") + "</p>" +
        (p.message ? '<div class="note"><span class="muted">From the M.E.E.T. team</span>' + esc(p.message).replace(/\n/g, "<br>") + "</div>" : "") +
        '<h4 class="ph">Creative direction</h4><p class="prose">' + esc(p.creative_direction).replace(/\n/g, "<br>") + "</p>" +
        '<h4 class="ph">Artists and their contribution</h4><div class="stack" style="gap:8px">' + (p.artists || []).map(function (a) {
          return '<div class="note"><b><a class="link" href="/artists/' + esc(a.artist_id) + '" target="_blank" rel="noopener">' + esc(a.name) + "</a></b>" +
            (a.contribution ? "<br>" + esc(a.contribution) : "") + (a.materials ? '<br><span class="muted small">' + esc(a.materials) + "</span>" : "") +
            (a.price ? '<br><span class="small">Estimated: ' + esc(a.price) + "</span>" : "") + "</div>";
        }).join("") + "</div>" +
        '<div class="kv" style="margin-top:12px"><span>Estimated budget</span><b>' + esc(p.budget) + "</b><span>Timeline</span><b>" + esc(p.timeline) + "</b></div>" +
        (p.client_response ? '<div class="note reply"><span class="muted">Your answer</span>' + esc(p.client_response).replace(/\n/g, "<br>") + "</div>" : "") +
        (p.status === "sent" ? '<div class="panel stack" style="gap:10px;margin-top:14px"><p class="small">Nothing goes ahead until you accept. You can also ask for changes or alternatives, or decline.</p>' +
          '<label class="f"><span>Message to the team <span class="opt" id="msg-opt">optional</span></span><textarea class="inp" id="p-msg" rows="3" maxlength="2000"></textarea></label>' +
          '<p class="err" id="p-err" role="alert" hidden></p>' +
          '<div class="row"><button class="btn" type="button" data-decide="accept" data-id="' + p.id + '">Accept the proposal</button>' +
          '<button class="btn line" type="button" data-decide="changes" data-id="' + p.id + '">Ask for changes</button>' +
          '<button class="btn quiet" type="button" data-decide="decline" data-id="' + p.id + '">Decline</button></div></div>' : "") +
        "</article>";
    }
    main.innerHTML =
      '<a class="link small" href="#/requests">Back to your requests</a>' +
      '<div class="head"><div><span class="eyebrow">' + esc(KIND_LABEL[q.kind] || "Request") + " · " + esc(q.reference) + "</span>" +
      "<h1>" + esc(q.kind === "collaboration" ? "Your collaboration" : q.artwork_type) + "</h1>" +
      "<p>Sent " + esc(M.fmtDate(q.created_at, true)) + (d.contact ? ". Your contact at M.E.E.T. is <b>" + esc(d.contact) + "</b>" : "") + ".</p></div>" +
      '<div class="row">' + statusTag(cur) + "</div></div>" +
      stepper +
      (open ? proposal(open) : "") +
      (d.updates.length ? '<section class="rblock"><h3 style="font-size:24px">Updates from the team</h3>' + d.updates.map(function (u) {
        return '<div class="note"><span class="muted">' + esc(M.fmtDate(u.at, true)) + "</span>" + esc(u.body).replace(/\n/g, "<br>") + "</div>";
      }).join("") + "</section>" : "") +
      '<section class="rblock"><h3 style="font-size:24px">Your request</h3><p class="prose">' + esc(q.description).replace(/\n/g, "<br>") + '</p><div class="kv">' +
      (q.kind !== "collaboration" ? "<span>" + (q.kind === "project" ? "Project type or space" : "Type of artwork") + "</span><b>" + esc(q.artwork_type) + "</b>" : "") +
      (d.nominated.length ? "<span>" + (q.kind === "collaboration" ? "Artists to bring together" : "Artists you suggested") + "</span><b>" + d.nominated.map(function (a) { return esc(a.name); }).join(", ") + "</b>" : "") +
      (q.purpose ? "<span>Purpose</span><b>" + esc(q.purpose) + "</b>" : "") +
      (q.disciplines_wanted ? "<span>Disciplines or materials</span><b>" + esc(q.disciplines_wanted) + "</b>" : "") +
      "<span>Budget</span><b>" + (q.budget_undecided ? "Not decided yet" : esc(q.budget)) + "</b>" +
      "<span>Timing</span><b>" + (q.timeline_undecided ? "Not decided yet" : esc(q.timeline)) + "</b>" +
      (q.location ? "<span>Location</span><b>" + esc(q.location) + "</b>" : "") +
      (q.quantity_dims ? "<span>Quantity and dimensions</span><b>" + esc(q.quantity_dims) + "</b>" : "") +
      (q.style_refs ? "<span>Inspiration</span><b>" + esc(q.style_refs) + "</b>" : "") +
      (q.file_count ? "<span>Files</span><b>" + q.file_count + " attached</b>" : "") + "</div></section>" +
      d.proposals.filter(function (p) { return p !== open; }).map(proposal).join("") +
      '<p class="small muted">Direct messages with artists are not available yet. For anything else about this request, reply to any email from the team or write to <a class="link" href="mailto:minds.exploring.traditions@gmail.com">minds.exploring.traditions@gmail.com</a>.</p>';

    main.onclick = async function (e) {
      var b = e.target.closest("[data-decide]");
      if (!b) return;
      var decision = b.getAttribute("data-decide"), msg = main.querySelector("#p-msg").value.trim(), err = main.querySelector("#p-err");
      if (decision === "changes" && msg.length < 10) { err.textContent = "Please tell the team what you would like to change (at least 10 characters)."; err.hidden = false; main.querySelector("#p-msg").focus(); return; }
      if (decision === "accept" && !confirm("Accept this proposal? The M.E.E.T. team will confirm the next steps with you.")) return;
      if (decision === "decline" && !confirm("Decline this proposal?")) return;
      M.setBusy(b, true, "Sending");
      try {
        await M.api("proposal-response", { id: b.getAttribute("data-id"), decision: decision, message: msg });
        M.toast(decision === "accept" ? "Thank you. You accepted the proposal." : decision === "changes" ? "Your request for changes was sent." : "You declined the proposal.");
        route();
      } catch (ex) { M.setBusy(b, false); err.textContent = M.friendlyError(ex); err.hidden = false; }
    };
  }

  function viewDelete() {
    var pending = !!acct.deletion_requested_at;
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your data</span><h1>Delete your <em>account</em></h1>' +
      "<p>We will permanently delete your account and the personal details you gave us. This cannot be undone.</p></div></div>" +
      (pending
        ? '<div class="notice warn">You asked us to delete this account on ' + esc(M.fmtDate(acct.deletion_requested_at, true)) + ". The M.E.E.T. team will complete it within 30 days and confirm by email.</div>"
        : '<div class="panel stack"><p>How it works: you send the request here, the M.E.E.T. team deletes your account within 30 days, and we confirm by email.</p>' +
          '<label class="f">Type <b>DELETE</b> to confirm<input class="inp" id="confirm" autocomplete="off" autocapitalize="characters"></label>' +
          '<p class="err" id="del-err" role="alert" hidden></p>' +
          '<div class="row"><button class="btn danger" type="button" id="b-del">Request account deletion</button></div></div>');
    var b = main.querySelector("#b-del");
    if (b) b.addEventListener("click", async function () {
      var err = main.querySelector("#del-err");
      if (main.querySelector("#confirm").value.trim().toUpperCase() !== "DELETE") { err.textContent = "Please type DELETE to confirm."; err.hidden = false; return; }
      M.setBusy(b, true, "Sending");
      try { await M.api("account-deletion", {}); M.toast("Request received."); route(); }
      catch (ex) { M.setBusy(b, false); err.textContent = M.friendlyError(ex); err.hidden = false; }
    });
  }

  document.getElementById("logo").insertAdjacentHTML("afterbegin", M.LOGO);
  document.querySelectorAll("[data-signout]").forEach(function (b) { b.addEventListener("click", M.signOut); });

  (async function start() {
    me = await M.requireAccount();
    if (!me) return;
    sb = M.sb;
    document.getElementById("who").textContent = me.account.full_name || me.user.email;
    window.addEventListener("hashchange", route);
    route();
  })();
})();
