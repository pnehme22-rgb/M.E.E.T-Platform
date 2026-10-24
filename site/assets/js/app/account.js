/* M.E.E.T. member account: profile, security, inquiries to artists,
   project requests (Professional and Business), deletion request.
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
    var items = [["", "Overview"], ["inquiries", "Inquiries"]];
    if (acct.account_type !== "personal") items.push(["projects", "Project requests"]);
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
      renderNav(view);
      if (view === "") viewOverview();
      else if (view === "profile") viewProfile();
      else if (view === "security") viewSecurity();
      else if (view === "inquiries") await viewInquiries();
      else if (view === "projects" && acct.account_type !== "personal") {
        if (location.hash.split("/")[2] === "new") viewProjectForm(); else await viewProjects();
      }
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
      "<p>Your M.E.E.T. account. Discover artists from different cultures, materials and disciplines.</p></div></div>" +
      (acct.deletion_requested_at ? '<div class="notice warn">You asked us to delete this account on ' + esc(M.fmtDate(acct.deletion_requested_at)) + ". The M.E.E.T. team will complete it and confirm by email.</div>" : "") +
      '<div class="kpis">' +
      '<a class="kpi" href="/artists"><span>Discover</span><b class="word">Artists</b><span>Browse the M.E.E.T. artist directory</span></a>' +
      '<a class="kpi" href="#/profile"><span>Your details</span><b class="word">Profile</b><span>' + esc(name) + " · " + esc(acct.country) + "</span></a>" +
      '<a class="kpi" href="#/inquiries"><span>Your messages</span><b class="word">Inquiries</b><span>To artists, and their replies</span></a>' +
      (acct.account_type !== "personal" ? '<a class="kpi" href="#/projects"><span>Sourcing</span><b class="word">Projects</b><span>Ask the team to find artists for a project</span></a>' : "") +
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

  /* ---------------- project requests (Professional and Business) ---------------- */

  var CLIENT_STATUS = {
    received: ["Received", "blue", "The M.E.E.T. team has your request and will review it."],
    in_discussion: ["In discussion", "warn", "The M.E.E.T. team is working on your request and will be in touch by email."],
    confirmed: ["Confirmed", "ok", "Your project is confirmed."],
    closed: ["Closed", "", "This request is closed. You are welcome to send a new one."]
  };

  async function viewProjects() {
    var r = await sb.rpc("my_project_requests");
    if (r.error) throw r.error;
    var rows = r.data || [];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">For ' + esc(acct.account_type === "business" ? "Business & Organization" : "Professional") + " accounts</span>" +
      "<h1>Project <em>requests</em></h1><p>Looking for artwork for a hotel, an office, a home or another project? Describe it and the M.E.E.T. team will help you find suitable artists.</p></div>" +
      '<div class="row"><a class="btn" href="#/projects/new">New project request</a></div></div>' +
      (rows.length ? '<div class="stack" style="gap:12px">' + rows.map(function (q) {
        var st = CLIENT_STATUS[q.client_status] || [q.client_status, "", ""];
        return '<article class="rblock"><div class="between"><h3 style="font-size:24px">' + esc(q.artwork_type) + "</h3>" +
          '<span class="tag ' + st[1] + '">' + esc(st[0]) + "</span></div>" +
          '<p class="small muted">' + esc(q.reference) + " · sent " + esc(M.fmtDate(q.created_at)) + " · " + esc(st[2]) + "</p>" +
          '<p class="prose">' + esc(q.description) + "</p>" +
          '<div class="kv"><span>Budget</span><b>' + (q.budget_undecided ? "Not decided yet" : esc(q.budget)) + "</b>" +
          "<span>Timeline</span><b>" + (q.timeline_undecided ? "Not decided yet" : esc(q.timeline)) + "</b>" +
          (q.location ? "<span>Location</span><b>" + esc(q.location) + "</b>" : "") +
          (q.quantity_dims ? "<span>Quantity and dimensions</span><b>" + esc(q.quantity_dims) + "</b>" : "") +
          (q.style_refs ? "<span>Style and references</span><b>" + esc(q.style_refs) + "</b>" : "") + "</div></article>";
      }).join("") + "</div>"
        : '<div class="empty">You have not sent a project request yet.</div>');
  }

  function viewProjectForm() {
    main.innerHTML =
      '<a class="link small" href="#/projects">Back to project requests</a>' +
      '<div class="head"><div><span class="eyebrow">New project request</span><h1>Tell us about your <em>project</em></h1>' +
      "<p>Share what you know. If something is not decided yet, say so: the team will help you work it out.</p></div></div>" +
      '<form class="panel stack" id="prj" novalidate>' +
      '<label class="f">Project description<span class="hint">What is the project, where will the artwork live, and what should it feel like?</span>' +
      '<textarea class="inp" name="description" rows="6" maxlength="4000"></textarea></label>' +
      '<label class="f">Type of artwork<span class="hint">For example: large ceramic wall piece, a series of textile works, sculpture for a lobby.</span>' +
      '<input class="inp" name="artwork_type" maxlength="200"></label>' +
      '<div class="grid2"><div class="f"><label class="f" for="p-budget">Estimated budget<span class="hint">With the currency, for example AED 40,000 to 60,000.</span></label>' +
      '<input class="inp" id="p-budget" name="budget" maxlength="200"><label class="row small" style="font-weight:500"><input type="checkbox" name="budget_undecided"> Not decided yet</label></div>' +
      '<div class="f"><label class="f" for="p-time">Timeline<span class="hint">For example: installed by March 2027.</span></label>' +
      '<input class="inp" id="p-time" name="timeline" maxlength="200"><label class="row small" style="font-weight:500"><input type="checkbox" name="timeline_undecided"> Not decided yet</label></div></div>' +
      '<label class="f"><span>Project location <span class="opt">optional</span></span><input class="inp" name="location" maxlength="200" placeholder="City and country"></label>' +
      '<label class="f"><span>Quantity and dimensions <span class="opt">optional</span></span><textarea class="inp" name="quantity_dims" rows="3" maxlength="1000"></textarea></label>' +
      '<label class="f"><span>Style and references <span class="opt">optional</span></span><span class="hint">Colours, materials, moods, or links to images you like.</span><textarea class="inp" name="style_refs" rows="3" maxlength="2000"></textarea></label>' +
      '<p class="small muted">Your request is linked to your account: ' + esc(acct.account_type === "business" ? acct.business_name : acct.company_name || acct.full_name) + ", " + esc(acct.country) + ". Only you and the M.E.E.T. team can see it.</p>" +
      '<p class="err" id="prj-err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn" type="submit" id="b-prj">Send project request</button><a class="btn line" href="#/projects">Cancel</a></div></form>';
    var f = main.querySelector("#prj");
    ["budget", "timeline"].forEach(function (k) {
      f.elements[k + "_undecided"].addEventListener("change", function () { f.elements[k].disabled = this.checked; if (this.checked) f.elements[k].value = ""; });
    });
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var err = main.querySelector("#prj-err");
      var v = {
        description: f.elements.description.value.trim(), artwork_type: f.elements.artwork_type.value.trim(),
        budget: f.elements.budget.value.trim(), budget_undecided: f.elements.budget_undecided.checked,
        timeline: f.elements.timeline.value.trim(), timeline_undecided: f.elements.timeline_undecided.checked,
        location: f.elements.location.value.trim(), quantity_dims: f.elements.quantity_dims.value.trim(), style_refs: f.elements.style_refs.value.trim()
      };
      var problem = v.description.length < 20 ? ["description", "Please describe the project in at least 20 characters."]
        : v.artwork_type.length < 2 ? ["artwork_type", "Please tell us what type of artwork you are looking for."]
        : !v.budget && !v.budget_undecided ? ["budget", "Please give an estimated budget, or tick “Not decided yet”."]
        : !v.timeline && !v.timeline_undecided ? ["timeline", "Please give a timeline, or tick “Not decided yet”."] : null;
      if (problem) { err.textContent = problem[1]; err.hidden = false; f.elements[problem[0]].focus(); return; }
      err.hidden = true;
      var b = main.querySelector("#b-prj");
      M.setBusy(b, true, "Sending");
      try {
        var res = await M.api("project-request", v);
        main.innerHTML = '<div class="panel stack" role="status"><span class="eyebrow">Request sent</span><h1>Thank you</h1>' +
          "<p>We have received your project request with the reference <b>" + esc(res.reference) + "</b>. " +
          (res.emailed && res.emailed.member === false ? "We could not send the confirmation email, but your request is saved. " : "We have emailed you a confirmation. ") +
          "The M.E.E.T. team will review it and contact you by email.</p>" +
          '<div class="row"><a class="btn line" href="#/projects">View my project requests</a></div></div>';
      } catch (ex) { M.setBusy(b, false); err.textContent = M.friendlyError(ex); err.hidden = false; }
    });
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
