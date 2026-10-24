/* M.E.E.T. member account: profile, security, enquiries, deletion request.
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
    var items = [["", "Overview"], ["profile", "Profile"], ["security", "Security"], ["enquiries", "Enquiries"]];
    if (acct.account_type !== "personal") items.push(["projects", "Project requests"]);
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
    try {
      await load();
      renderNav(view);
      if (view === "") viewOverview();
      else if (view === "profile") viewProfile();
      else if (view === "security") viewSecurity();
      else if (view === "enquiries") viewComing("Enquiries", "Messages you send to artists through M.E.E.T. will appear here, with their status. Sending enquiries opens in the next stage of M.E.E.T.");
      else if (view === "projects" && acct.account_type !== "personal") viewComing("Project requests", "Project requests you submit to the M.E.E.T. team (for example artwork for a hotel, office or home) will appear here with their status. This opens in the next stage of M.E.E.T.");
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
      '<a class="kpi" href="/artists"><span>Discover</span><b style="font-size:28px">Artists</b><span>Browse the M.E.E.T. artist directory</span></a>' +
      '<a class="kpi" href="#/profile"><span>Your details</span><b style="font-size:28px">Profile</b><span>' + esc(name) + " · " + esc(acct.country) + "</span></a>" +
      '<a class="kpi" href="#/security"><span>Sign-in</span><b style="font-size:28px">Security</b><span>Password and devices</span></a></div>';
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

  function viewComing(title, text) {
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">' + esc(title) + "</span><h1>" + esc(title) + "</h1></div></div>" +
      '<div class="coming">' + esc(text) + "</div>" +
      '<div class="empty">Nothing here yet.</div>';
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
