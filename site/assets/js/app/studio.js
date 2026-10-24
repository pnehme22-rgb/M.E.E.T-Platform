/* M.E.E.T. artist studio: profile, artworks, review status.
   Artists can only reach their own row, works and photo folder (database
   row level security). Status changes go through submit_profile() and
   submit_artwork(); editing an approved item sends it back for review. */
(function () {
  "use strict";
  var M = window.MEET, sb, me, artist;
  var esc = M.esc;
  var TERMS_VERSION = "2026-10-24";   // change when the Artist terms change; artists then agree again
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");

  var STATUS = {
    draft: ["Draft", "", "Not sent for review yet."],
    submitted: ["Waiting for review", "blue", "The M.E.E.T. team is reviewing this."],
    changes_requested: ["Changes requested", "warn", "The team has asked for a few changes. See their note below."],
    approved: ["Approved", "ok", "Approved by the M.E.E.T. team, and public on M.E.E.T."],
    declined: ["Not accepted", "", "This was not accepted. You can write to us if you have questions."]
  };
  function tag(s) { var t = STATUS[s] || [s, ""]; return '<span class="tag ' + t[1] + '">' + esc(t[0]) + "</span>"; }
  function fail(err) { M.toast(M.friendlyError(err)); }

  async function loadArtist() {
    var r = await sb.from("artists").select("*").eq("id", me.user.id).single();
    if (r.error) throw r.error;
    artist = r.data;
  }

  function renderNav(current) {
    var items = [["", "Overview"], ["profile", "Profile"], ["works", "Artworks"]];
    nav.innerHTML = items.map(function (i) {
      return '<a class="ni" href="#/' + i[0] + '"' + (current === i[0] ? ' aria-current="page"' : "") + ">" + esc(i[1]) + "</a>";
    }).join("") + '<a class="ni" href="/welcome">Change password</a>';
  }

  async function route() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("/");
    var view = parts[0] || "";
    main.onclick = null;
    try {
      await loadArtist();
      // The Artist terms come first, once (and again whenever they change).
      if (!artist.terms_accepted_at || artist.terms_version !== TERMS_VERSION) {
        nav.innerHTML = "";
        viewTerms();
        return;
      }
      renderNav(view === "work" ? "works" : view);
      if (view === "") await viewOverview();
      else if (view === "profile") await viewProfile();
      else if (view === "works") await viewWorks();
      else if (view === "work") await viewWork(parts[1] || "new");
      else location.hash = "#/";
    } catch (err) {
      main.innerHTML = '<div class="empty">This page could not be loaded. ' + esc(M.friendlyError(err)) + "</div>";
    }
    main.focus({ preventScroll: true });
  }

  /* ---------------- artist terms (one-time agreement) ---------------- */

  function viewTerms() {
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Before you begin</span><h1>Your work, <em>your rights</em></h1>' +
      "<p>A short agreement about how M.E.E.T. may show your work. Please read it once.</p></div></div>" +
      '<div class="panel stack">' +
      '<ul class="stack" style="gap:10px;margin:0;padding-left:20px">' +
      "<li><b>Your work stays yours.</b> You keep the copyright in your artworks, photographs and texts.</li>" +
      "<li><b>Once the team approves something, it becomes public</b> on M.E.E.T. straight away. M.E.E.T. may also use it to present and promote M.E.E.T. (social media, newsletters, printed materials), always credited to you.</li>" +
      "<li><b>Only what the team approves is public.</b> Your legal name, email and social links stay private. Drafts and changes waiting for review stay private too.</li>" +
      "<li><b>You can change your mind:</b> ask us to remove anything, or your whole studio, at any time.</li>" +
      "<li><b>You confirm</b> the works are your own and you may share the photographs.</li>" +
      "<li>M.E.E.T. never sells your images, never licenses them to others, and never uses them to train AI.</li>" +
      "</ul>" +
      '<p class="small"><a class="link" href="/artist-terms" target="_blank" rel="noopener">Read the full Artist terms</a> (opens in a new tab) · <a class="link" href="/privacy" target="_blank" rel="noopener">Privacy notice</a></p>' +
      '<label class="row" style="gap:12px;align-items:flex-start;font-weight:500"><input type="checkbox" id="agree" style="width:22px;height:22px;margin-top:2px;accent-color:var(--accent)"> <span>I have read and agree to the M.E.E.T. Artist terms.</span></label>' +
      '<p class="err" id="terms-err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn" type="button" id="b-agree">Agree and open my studio</button></div></div>';
    main.querySelector("#b-agree").addEventListener("click", async function () {
      var err = main.querySelector("#terms-err");
      if (!main.querySelector("#agree").checked) { err.textContent = "Please tick the box to agree to the Artist terms."; err.hidden = false; return; }
      err.hidden = true;
      M.setBusy(this, true, "Saving");
      var r = await sb.rpc("accept_terms", { p_version: TERMS_VERSION });
      if (r.error) { M.setBusy(this, false); err.textContent = M.friendlyError(r.error); err.hidden = false; return; }
      M.toast("Thank you. Welcome to your studio.");
      route();
    });
  }

  /* ---------------- overview ---------------- */

  async function viewOverview() {
    var w = await sb.from("artworks").select("id, status").eq("artist_id", artist.id);
    var works = w.data || [];
    var approved = works.filter(function (x) { return x.status === "approved"; }).length;
    var steps = [
      [artist.profile_status === "approved" || artist.profile_status === "submitted", "Complete your profile", "Your name, main discipline, biography and a profile picture.", "#/profile"],
      [works.length > 0, "Add your first artwork", "At least one piece you made yourself, photographed in daylight.", "#/work/new"],
      [works.some(function (x) { return x.status !== "draft"; }), "Send it for review", "The team reviews each item with care and may suggest changes.", "#/works"]
    ];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your studio</span><h1>Welcome, <em>' + esc((artist.display_name || artist.legal_name || "").split(" ")[0] || "artist") + "</em></h1>" +
      "<p>This is your space on M.E.E.T. Build your profile and add your works. The team reviews each one, and what they approve becomes public on M.E.E.T.</p></div></div>" +
      '<div class="kpis">' +
      '<a class="kpi" href="#/profile"><span>Profile</span>' + tag(artist.profile_status) + "</a>" +
      '<a class="kpi" href="#/works"><b class="num">' + works.length + "</b><span>Artworks added</span></a>" +
      '<a class="kpi" href="#/works"><b class="num">' + approved + "</b><span>Approved</span></a></div>" +
      (artist.profile_status === "changes_requested" ? '<div class="notice warn">The team has asked for changes to your profile. <a class="link" href="#/profile">See their note</a>.</div>' : "") +
      '<section class="panel stack"><h2 style="font-size:30px">Your next steps</h2><div class="list">' + steps.map(function (s) {
        return '<a class="lrow" href="' + s[3] + '"><div class="lm"><b>' + (s[0] ? "✓ " : "") + esc(s[1]) + '</b><span class="muted small">' + esc(s[2]) + "</span></div>" +
          '<div class="ls">' + (s[0] ? '<span class="tag ok">Done</span>' : '<span class="tag">To do</span>') + "</div></a>";
      }).join("") + "</div></section>" +
      '<p class="small muted">Questions? Write to <a class="link" href="mailto:minds.exploring.traditions@gmail.com">minds.exploring.traditions@gmail.com</a>.</p>';
  }

  /* ---------------- profile ---------------- */

  async function viewProfile() {
    var a = artist;
    var st = STATUS[a.profile_status] || STATUS.draft;
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your profile</span><h1>How artists and clients will <em>meet</em> you</h1>' +
      "<p>" + esc(st[2]) + "</p></div><div>" + tag(a.profile_status) + "</div></div>" +
      (a.feedback && a.profile_status === "changes_requested" ? '<div class="note"><span class="muted">A note from the M.E.E.T. team</span>' + esc(a.feedback).replace(/\n/g, "<br>") + "</div>" : "") +
      '<form class="stack" id="pf" novalidate>' +
      '<div class="panel stack"><h3 style="font-size:24px">Pictures</h3>' +
      '<div class="row" style="gap:20px;align-items:flex-start">' +
      '<div class="f"><span>Profile picture</span><label class="up round" id="up-avatar">' + (a.avatar_path ? '<img alt="Your profile picture" data-media="' + esc(a.avatar_path) + '">' : "<span>Add a clear portrait</span>") +
      '<input type="file" accept="image/*" data-up="avatar" aria-label="Choose a profile picture"></label></div>' +
      '<div class="f" style="flex:1;min-width:240px"><span>Cover photo <span class="opt">optional</span></span><label class="up wide" id="up-cover">' +
      (a.cover_path ? '<img alt="Your cover photo" data-media="' + esc(a.cover_path) + '">' : "<span>Your studio, your materials or your hands at work</span>") +
      '<input type="file" accept="image/*" data-up="cover" aria-label="Choose a cover photo"></label></div></div></div>' +
      '<div class="panel stack"><h3 style="font-size:24px">About you</h3>' +
      '<div class="grid2"><label class="f">Name shown on your profile<input class="inp" name="display_name" maxlength="120" value="' + esc(a.display_name) + '"></label>' +
      '<label class="f">Legal name <span class="opt">private, for the team only</span><input class="inp" name="legal_name" maxlength="120" value="' + esc(a.legal_name) + '"></label></div>' +
      '<div class="grid2"><label class="f">Country<input class="inp" name="country" maxlength="80" value="' + esc(a.country) + '"></label>' +
      '<label class="f">City<input class="inp" name="city" maxlength="80" value="' + esc(a.city) + '"></label></div>' +
      '<label class="f">Main discipline<span class="hint">Your main art form, for example porcelain painting.</span><input class="inp" name="craft" maxlength="120" value="' + esc(a.craft) + '"></label>' +
      '<div class="grid2"><label class="f">Other disciplines <span class="opt">optional</span><span class="hint">Other kinds of art you also practise.</span><input class="inp" name="other_disciplines" maxlength="400" value="' + esc(a.other_disciplines || "") + '"></label>' +
      '<label class="f">Techniques and materials <span class="opt">optional</span><span class="hint">How you work: techniques, tools, materials.</span><input class="inp" name="techniques" maxlength="400" value="' + esc(a.techniques) + '"></label></div>' +
      '<label class="f">Biography<span class="hint">What you make, how you learned it, what you are exploring now. At least 40 characters.</span>' +
      '<textarea class="inp" name="bio" rows="7" maxlength="1500">' + esc(a.bio) + "</textarea></label></div>" +
      '<div class="panel stack"><h3 style="font-size:24px">Links</h3>' +
      '<div class="grid2"><label class="f">Instagram <span class="opt">optional</span><input class="inp" name="instagram" maxlength="300" autocapitalize="off" spellcheck="false" placeholder="@yourstudio" value="' + esc(a.instagram) + '"></label>' +
      '<label class="f">Website <span class="opt">optional</span><input class="inp" name="website" maxlength="300" autocapitalize="off" spellcheck="false" placeholder="https://" value="' + esc(a.website) + '"></label></div>' +
      '<label class="f">Other link <span class="opt">optional</span><input class="inp" name="other_link" maxlength="300" autocapitalize="off" spellcheck="false" placeholder="Press, Behance, Artsy" value="' + esc(a.other_link) + '"></label></div>' +
      '<p class="err" id="pf-err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn line" type="submit" id="b-save">Save changes</button>' +
      (a.profile_status === "submitted" ? '<span class="small muted">Waiting for review. Saving changes sends it back to draft.</span>'
        : '<button class="btn" type="button" id="b-submit">Save and send for review</button>') + "</div>" +
      (a.profile_status === "approved" ? '<p class="small muted">Your profile is approved and public. If you change it, it is hidden until the team has reviewed the change.</p>' : "") +
      "</form>";
    M.hydrateMedia(main);

    var form = main.querySelector("#pf");
    var FIELDS = ["display_name", "legal_name", "country", "city", "craft", "other_disciplines", "techniques", "bio", "instagram", "website", "other_link"];
    function values() { var v = {}; FIELDS.forEach(function (f) { v[f] = form.elements[f].value.trim(); }); return v; }
    function changed() { var v = values(); return FIELDS.some(function (f) { return v[f] !== (artist[f] || ""); }); }

    async function save() {
      if (!changed()) return true;
      var r = await sb.from("artists").update(values()).eq("id", artist.id);
      if (r.error) { fail(r.error); return false; }
      return true;
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var b = main.querySelector("#b-save");
      M.setBusy(b, true, "Saving");
      var ok = await save();
      M.setBusy(b, false);
      if (ok) { M.toast("Profile saved."); route(); }
    });
    var submit = main.querySelector("#b-submit");
    if (submit) submit.addEventListener("click", async function () {
      var err = main.querySelector("#pf-err");
      var v = values();
      var missing = [];
      if (!v.display_name) missing.push("the name shown on your profile");
      if (!v.craft) missing.push("your main discipline");
      if (v.bio.length < 40) missing.push("a biography of at least 40 characters");
      if (!artist.avatar_path) missing.push("a profile picture");
      if (missing.length) { err.textContent = "Before sending, please add " + missing.join(", ") + "."; err.hidden = false; return; }
      err.hidden = true;
      M.setBusy(submit, true, "Sending");
      var ok = await save();
      if (!ok) { M.setBusy(submit, false); return; }
      var r = await sb.rpc("submit_profile");
      M.setBusy(submit, false);
      if (r.error) { err.textContent = M.friendlyError(r.error); err.hidden = false; return; }
      M.toast("Sent. The team will review your profile.");
      route();
    });

    main.querySelectorAll("[data-up]").forEach(function (input) {
      input.addEventListener("change", async function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var kind = input.getAttribute("data-up");
        var box = input.closest(".up");
        box.style.opacity = ".6";
        try {
          var path = await M.uploadImage(file, artist.id + "/" + kind + "-" + Date.now() + ".jpg");
          var old = artist[kind + "_path"];
          var upd = {}; upd[kind + "_path"] = path;
          var r = await sb.from("artists").update(upd).eq("id", artist.id);
          if (r.error) throw r.error;
          if (old) sb.storage.from("artist-media").remove([old]);
          M.toast(kind === "avatar" ? "Profile picture updated." : "Cover photo updated.");
          // keep any unsaved text the artist typed
          var v = values(); await loadArtist(); viewProfile().then(function () { FIELDS.forEach(function (f) { main.querySelector("#pf").elements[f].value = v[f]; }); });
        } catch (err) { box.style.opacity = ""; fail(err); }
      });
    });
  }

  /* ---------------- artworks ---------------- */

  async function viewWorks() {
    // Tidy away drafts that were opened but never given a title or photograph.
    await sb.from("artworks").delete().eq("artist_id", artist.id).eq("status", "draft").eq("title", "").eq("images", "{}");
    var r = await sb.from("artworks").select("id, title, status, images, created_at").eq("artist_id", artist.id).order("created_at", { ascending: false });
    if (r.error) throw r.error;
    var works = r.data || [];
    main.innerHTML =
      '<div class="head"><div><span class="eyebrow">Your artworks</span><h1>Your <em>works</em></h1>' +
      "<p>Add pieces you made yourself. Photograph each on a plain background, in daylight, with the whole work in frame. Add up to 6 photographs per work.</p></div>" +
      '<div><a class="btn" href="#/work/new">Add an artwork</a></div></div>' +
      (works.length ? '<div class="works">' + works.map(function (w) {
        return '<a class="wcard" href="#/work/' + w.id + '"><div class="ph">' + (w.images && w.images[0] ? '<img alt="" data-media="' + esc(w.images[0]) + '">' : "No photograph yet") + "</div>" +
          '<span class="t">' + esc(w.title || "Untitled") + "</span>" + tag(w.status) + "</a>";
      }).join("") + "</div>" : '<div class="empty">No artworks yet. <a class="link" href="#/work/new">Add your first one</a>.</div>');
    M.hydrateMedia(main);
  }

  async function viewWork(id) {
    var w;
    if (id === "new") {
      // Create the draft straight away so photographs have a home.
      var ins = await sb.from("artworks").insert({ title: "" }).select("*").single();
      if (ins.error) throw ins.error;
      history.replaceState(null, "", "#/work/" + ins.data.id);
      w = ins.data;
    } else {
      var r = await sb.from("artworks").select("*").eq("id", id).eq("artist_id", artist.id).maybeSingle();
      if (r.error) throw r.error;
      w = r.data;
      if (!w) { main.innerHTML = '<div class="empty">This artwork could not be found. <a class="link" href="#/works">Back to your works</a></div>'; return; }
    }
    var st = STATUS[w.status] || STATUS.draft;
    var opt = function (v, cur) { return '<option' + (v === cur ? " selected" : "") + ">" + v + "</option>"; };
    main.innerHTML =
      '<a class="link small" href="#/works">Back to your works</a>' +
      '<div class="head"><div><span class="eyebrow">Artwork</span><h1>' + (w.title ? esc(w.title) : "A new <em>work</em>") + "</h1><p>" + esc(st[2]) + "</p></div><div>" + tag(w.status) + "</div></div>" +
      (w.feedback && w.status === "changes_requested" ? '<div class="note"><span class="muted">A note from the M.E.E.T. team</span>' + esc(w.feedback).replace(/\n/g, "<br>") + "</div>" : "") +
      '<form class="stack" id="wf" novalidate>' +
      '<div class="panel stack"><h3 style="font-size:24px">Photographs <span class="opt">' + (w.images || []).length + " of 6</span></h3>" +
      '<div class="thumbs">' + (w.images || []).map(function (p, i) {
        return '<div class="thumb"><img alt="Photograph ' + (i + 1) + '" data-media="' + esc(p) + '"><button type="button" data-del="' + i + '" aria-label="Remove photograph ' + (i + 1) + '">×</button></div>';
      }).join("") +
      ((w.images || []).length < 6 ? '<label class="up work"><span>Add a photograph</span><input type="file" accept="image/*" id="add-img" aria-label="Add a photograph"></label>' : "") + "</div>" +
      '<p class="small muted">The first photograph is the main one.</p></div>' +
      '<div class="panel stack"><h3 style="font-size:24px">Details</h3>' +
      '<div class="grid2"><label class="f">Title<input class="inp" name="title" maxlength="160" value="' + esc(w.title) + '"></label>' +
      '<label class="f">Year <span class="opt">optional</span><input class="inp" name="year" inputmode="numeric" maxlength="4" value="' + esc(w.year || "") + '"></label></div>' +
      '<label class="f">Materials and technique <span class="opt">optional</span><input class="inp" name="materials" maxlength="300" value="' + esc(w.materials) + '"></label>' +
      '<div class="grid2"><div class="grid2"><label class="f">Height<input class="inp" name="height" inputmode="decimal" value="' + esc(w.height || "") + '"></label>' +
      '<label class="f">Width<input class="inp" name="width" inputmode="decimal" value="' + esc(w.width || "") + '"></label></div>' +
      '<div class="grid2"><label class="f">Depth <span class="opt">optional</span><input class="inp" name="depth" inputmode="decimal" value="' + esc(w.depth || "") + '"></label>' +
      '<label class="f">Unit<select class="inp" name="unit">' + opt("cm", w.unit) + opt("in", w.unit) + "</select></label></div></div>" +
      '<div class="grid2"><label class="f">Edition<select class="inp" name="edition_type">' + ["One of a kind", "Limited edition", "Open edition"].map(function (x) { return opt(x, w.edition_type); }).join("") + "</select></label>" +
      '<label class="f">Edition size <span class="opt">for limited editions</span><input class="inp" name="edition_size" inputmode="numeric" value="' + esc(w.edition_size || "") + '"></label></div>' +
      '<div class="grid2"><div class="grid2"><label class="f">Currency<select class="inp" name="currency">' + ["AED", "USD", "EUR", "GBP", "SAR"].map(function (x) { return opt(x, w.currency); }).join("") + "</select></label>" +
      '<label class="f">Price<input class="inp" name="price" inputmode="decimal" value="' + esc(w.price == null ? "" : w.price) + '"></label></div>' +
      '<label class="row small" style="font-weight:500;align-self:end;min-height:48px"><input type="checkbox" name="price_on_request"' + (w.price_on_request ? " checked" : "") + "> Price on request</label></div>" +
      '<label class="f">Description <span class="opt">optional</span><textarea class="inp" name="description" rows="5" maxlength="1500">' + esc(w.description) + "</textarea></label></div>" +
      '<p class="err" id="wf-err" role="alert" hidden></p>' +
      '<div class="row"><button class="btn line" type="submit" id="b-save">Save</button>' +
      (w.status === "submitted" ? '<span class="small muted">Waiting for review. Saving changes sends it back to draft.</span>' : '<button class="btn" type="button" id="b-submit">Save and send for review</button>') +
      (w.status !== "approved" ? '<button class="btn danger sm" type="button" id="b-del" style="margin-left:auto">Delete this work</button>' : "") + "</div></form>";
    M.hydrateMedia(main);

    var form = main.querySelector("#wf");
    function num(v) { v = String(v || "").replace(",", ".").trim(); return v === "" ? null : Number(v); }
    function values() {
      var e = form.elements;
      return {
        title: e.title.value.trim(), year: e.year.value.trim() ? parseInt(e.year.value, 10) : null,
        materials: e.materials.value.trim(), height: num(e.height.value), width: num(e.width.value), depth: num(e.depth.value),
        unit: e.unit.value, edition_type: e.edition_type.value, edition_size: e.edition_size.value.trim() ? parseInt(e.edition_size.value, 10) : null,
        currency: e.currency.value, price: num(e.price.value), price_on_request: e.price_on_request.checked, description: e.description.value.trim()
      };
    }
    function check(v) {
      if (v.year !== null && (isNaN(v.year) || v.year < 1900 || v.year > 2100)) return "Please enter the year as four digits, for example 2025.";
      if ([v.height, v.width, v.depth].some(function (x) { return x !== null && (isNaN(x) || x <= 0); })) return "Please enter sizes as numbers, for example 32 or 12.5.";
      if (v.price !== null && (isNaN(v.price) || v.price < 0)) return "Please enter the price as a number, without the currency.";
      if (v.edition_size !== null && (isNaN(v.edition_size) || v.edition_size < 1)) return "Please enter the edition size as a whole number.";
      return "";
    }
    async function save() {
      var err = main.querySelector("#wf-err");
      var v = values(), problem = check(v);
      if (problem) { err.textContent = problem; err.hidden = false; return false; }
      err.hidden = true;
      var r = await sb.from("artworks").update(v).eq("id", w.id);
      if (r.error) { err.textContent = M.friendlyError(r.error); err.hidden = false; return false; }
      return true;
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var b = main.querySelector("#b-save");
      M.setBusy(b, true, "Saving");
      var ok = await save();
      M.setBusy(b, false);
      if (ok) { M.toast("Saved."); viewWork(w.id); }
    });
    var submit = main.querySelector("#b-submit");
    if (submit) submit.addEventListener("click", async function () {
      var err = main.querySelector("#wf-err");
      var v = values();
      var missing = [];
      if (!v.title) missing.push("a title");
      if (!(w.images || []).length) missing.push("at least one photograph");
      if (!v.price_on_request && v.price === null) missing.push("a price, or tick price on request");
      if (missing.length) { err.textContent = "Before sending, please add " + missing.join(", ") + "."; err.hidden = false; return; }
      M.setBusy(submit, true, "Sending");
      var ok = await save();
      if (!ok) { M.setBusy(submit, false); return; }
      var r = await sb.rpc("submit_artwork", { p_id: w.id });
      M.setBusy(submit, false);
      if (r.error) { err.textContent = M.friendlyError(r.error); err.hidden = false; return; }
      M.toast("Sent. The team will review this work.");
      location.hash = "#/works";
    });
    var del = main.querySelector("#b-del");
    if (del) del.addEventListener("click", function () {
      M.modal("<h2>Delete this <em>work</em>?</h2><p class=\"muted\">The work and its photographs will be removed from your studio. This cannot be undone.</p>" +
        '<div class="row"><button class="btn danger" type="button" id="m-go">Delete</button><button class="btn line" type="button" data-close>Keep it</button></div>',
        function (box, close) {
          box.querySelector("#m-go").addEventListener("click", async function () {
            var r = await sb.from("artworks").delete().eq("id", w.id);
            if (r.error) return fail(r.error);
            if ((w.images || []).length) await sb.storage.from("artist-media").remove(w.images);
            close();
            M.toast("Work deleted.");
            location.hash = "#/works";
          });
        });
    });

    var add = main.querySelector("#add-img");
    if (add) add.addEventListener("change", async function () {
      var file = add.files && add.files[0];
      if (!file) return;
      var label = add.closest(".up");
      label.style.opacity = ".6";
      label.querySelector("span").textContent = "Uploading";
      try {
        var v = values();
        var path = await M.uploadImage(file, artist.id + "/works/" + w.id + "/" + Date.now() + ".jpg");
        var images = (w.images || []).concat(path).slice(0, 6);
        var r = await sb.from("artworks").update(Object.assign(v, { images: images })).eq("id", w.id);
        if (r.error) { await sb.storage.from("artist-media").remove([path]); throw r.error; }
        viewWork(w.id);
      } catch (err) { label.style.opacity = ""; label.querySelector("span").textContent = "Add a photograph"; fail(err); }
    });
    main.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var i = Number(b.getAttribute("data-del"));
        var gone = w.images[i];
        var images = w.images.filter(function (_, j) { return j !== i; });
        var r = await sb.from("artworks").update(Object.assign(values(), { images: images })).eq("id", w.id);
        if (r.error) return fail(r.error);
        sb.storage.from("artist-media").remove([gone]);
        viewWork(w.id);
      });
    });
  }

  /* ---------------- start ---------------- */

  document.getElementById("logo").insertAdjacentHTML("afterbegin", M.LOGO);
  document.querySelectorAll("[data-signout]").forEach(function (b) { b.addEventListener("click", M.signOut); });

  (async function start() {
    me = await M.requireArtist();
    if (!me) return;
    sb = M.sb;
    document.getElementById("who").textContent = me.artist.display_name || me.user.email;
    window.addEventListener("hashchange", route);
    route();
  })();
})();
