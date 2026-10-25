/* M.E.E.T. request forms: a commission idea (Discover & Commission), a
   collaboration between chosen artists (Collaborate) and a project brief
   (Start a Project). Anyone can fill in the form; sending needs a free member
   account. Answers are kept on this device while the visitor signs in or
   creates an account, and cleared once the request is sent. The database
   checks the account type, every field, the chosen artists and the files. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC;
  var form = document.getElementById("rq-form");
  if (!form || !P) return;
  var esc = P.esc;
  var kind = form.getAttribute("data-kind");
  var gate = document.getElementById("rq-gate");
  var summary = document.getElementById("rq-errors");
  var status = document.getElementById("rq-status");
  var submit = document.getElementById("rq-submit");
  var KEY = "meet-request-" + kind;
  var MAX_ARTISTS = 6, MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024;
  var FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  var who = { session: null, account: null };
  var files = [];
  var preselect = (new URLSearchParams(location.search).get("artist") || "").toLowerCase();

  function here() { return location.pathname + (preselect ? "?artist=" + preselect : "") + "#" + (kind === "project" ? "brief" : kind === "commission" ? "commission" : "request"); }

  /* ---------- Draft kept on this device ---------- */
  function values() {
    var v = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === "checkbox" && el.name !== "artist") v[el.name] = el.checked;
      else if (el.type !== "checkbox" && el.type !== "file") v[el.name] = el.value;
    });
    v.artists = checkedArtists();
    return v;
  }
  function saveDraft() { try { localStorage.setItem(KEY, JSON.stringify(values())); } catch (e) { /* storage unavailable */ } }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function clearDraft() { try { localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ } }
  function restore(d) {
    if (!d) return;
    Object.keys(d).forEach(function (k) {
      var el = form.elements[k];
      if (!el || k === "artists" || el.length) return;
      if (el.type === "checkbox") el.checked = !!d[k]; else el.value = d[k] || "";
    });
    syncUndecided();
  }

  /* ---------- "Not decided yet" ---------- */
  function syncUndecided() {
    ["budget", "timeline"].forEach(function (k) {
      var box = form.elements[k + "_undecided"], input = form.elements[k];
      if (!box || !input) return;
      input.disabled = box.checked;
      if (box.checked) input.value = "";
    });
  }
  form.addEventListener("change", function (e) {
    if (/_undecided$/.test(e.target.name || "")) syncUndecided();
    if (e.target.name === "artist") limitArtists();
    saveDraft();
  });
  form.addEventListener("input", saveDraft);

  /* ---------- Artist picker (public, approved artists only) ---------- */
  var pickList = document.getElementById("pick-list");
  function checkedArtists() {
    return Array.prototype.map.call(form.querySelectorAll('input[name="artist"]:checked'), function (i) { return i.value; });
  }
  function limitArtists() {
    var n = checkedArtists().length;
    form.querySelectorAll('input[name="artist"]').forEach(function (i) { i.disabled = !i.checked && n >= MAX_ARTISTS; });
  }
  async function loadArtists(chosen) {
    if (!pickList) return;
    try {
      var r = await P.sb.from("public_artists").select("id, display_name, main_discipline, country, city, avatar_path, directory_rank").order("display_name");
      if (r.error) throw r.error;
      var list = (r.data || []).sort(function (a, b) {
        var x = a.directory_rank == null ? 1e9 : a.directory_rank, y = b.directory_rank == null ? 1e9 : b.directory_rank;
        return x - y || String(a.display_name).localeCompare(b.display_name);
      });
      if (!list.length) { pickList.innerHTML = '<p class="hint">No artists are presented yet.</p>'; return; }
      var urls = await P.signUrls(list.map(function (a) { return a.avatar_path; }));
      pickList.innerHTML = list.map(function (a) {
        var on = chosen.indexOf(a.id) !== -1;
        return '<label class="pick" data-q="' + esc([a.display_name, a.main_discipline, a.country, a.city].join(" ").toLowerCase()) + '"><input type="checkbox" name="artist" value="' + a.id + '"' + (on ? " checked" : "") + ">" +
          '<span class="pm">' + (urls[a.avatar_path] ? '<img src="' + esc(urls[a.avatar_path]) + '" alt="">' : esc((a.display_name || "?").charAt(0))) + "</span>" +
          "<span><b>" + esc(a.display_name) + "</b><small>" + esc([a.main_discipline, P.place(a)].filter(Boolean).join(" · ")) + "</small></span></label>";
      }).join("");
      limitArtists();
    } catch (err) {
      console.error(err);
      pickList.innerHTML = '<p class="hint">The artists could not be loaded. Please refresh the page.</p>';
    }
  }
  var pickQ = document.getElementById("pick-q");
  if (pickQ) pickQ.addEventListener("input", function () {
    var q = pickQ.value.trim().toLowerCase();
    pickList.querySelectorAll(".pick").forEach(function (el) { el.hidden = q && el.getAttribute("data-q").indexOf(q) === -1; });
  });

  /* ---------- Files (project briefs) ---------- */
  var fileInput = document.getElementById("f-files"), fileList = document.getElementById("files-list");
  function drawFiles() {
    if (!fileList) return;
    fileList.innerHTML = files.map(function (f, i) {
      return "<li><span>" + esc(f.name) + " · " + Math.max(1, Math.round(f.size / 1024)) + ' KB</span><button type="button" data-rm="' + i + '">Remove</button></li>';
    }).join("");
  }
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var err = "";
      Array.prototype.forEach.call(fileInput.files, function (f) {
        if (files.length >= MAX_FILES) err = "You can add up to five files.";
        else if (FILE_TYPES.indexOf(f.type) === -1) err = "Please add PDF, JPG, PNG or WebP files.";
        else if (f.size > MAX_BYTES) err = "Each file can be up to 10 MB.";
        else files.push(f);
      });
      fileInput.value = "";
      drawFiles();
      showFieldError("files", err);
    });
    fileList.addEventListener("click", function (e) {
      var b = e.target.closest("[data-rm]");
      if (b) { files.splice(+b.getAttribute("data-rm"), 1); drawFiles(); }
    });
  }

  /* ---------- Who is sending ---------- */
  function signLinks() {
    var next = encodeURIComponent(here());
    return '<div class="row"><a class="btn btn-small" href="/signin?next=' + next + '">Sign in</a><a class="text-link" href="/signup?next=' + next + '">Create a free account</a></div>';
  }
  function drawGate() {
    var msg = "";
    if (!who.session) {
      msg = "<p>Sending a request needs a free M.E.E.T. account, so the team can reply and you can follow each step. You can fill in the form first: your answers are kept on this device while you sign in.</p>" + signLinks();
    } else if (!who.account) {
      msg = "<p>Requests are sent from a member account. Artist studios and team logins cannot send them. If you would like help as an artist, use <b>Support</b> in your studio.</p>";
    } else if (kind === "project" && who.account.account_type === "personal") {
      msg = '<p>Project briefs are sent from Professional and Business &amp; Organization accounts. With your Personal account you can <a class="text-link" href="/discover#commission">send a commission idea</a> or <a class="text-link" href="/collaborate">propose a collaboration</a>.</p>';
    } else {
      msg = "<p>Signed in as <b>" + esc(who.account.full_name) + "</b>. The team will reply to the email address of your account.</p>";
    }
    gate.innerHTML = msg;
    gate.hidden = false;
    submit.disabled = !!who.session && (!who.account || (kind === "project" && who.account.account_type === "personal"));
  }

  /* ---------- Checks before sending ---------- */
  function showFieldError(name, text) {
    var box = form.querySelector('[data-field="' + name + '"]');
    var el = document.getElementById("e-" + name);
    if (box) box.classList.toggle("invalid", !!text);
    if (el) el.textContent = text || "";
  }
  function check(v) {
    var errs = [];
    function need(name, ok, text) { showFieldError(name, ok ? "" : text); if (!ok) errs.push([name, text]); }
    need("description", v.description.trim().length >= 20, kind === "project" ? "Please describe the project in at least 20 characters." : "Please describe your idea in at least 20 characters.");
    if (kind !== "collaboration") need("artwork_type", (v.artwork_type || "").trim().length >= 2, kind === "project" ? "Please tell us the type of project or space." : "Please tell us the type of artwork.");
    need("budget", v.budget_undecided || v.budget.trim() !== "", 'Please give an estimated budget, or tick "Not decided yet".');
    need("timeline", v.timeline_undecided || v.timeline.trim() !== "", 'Please give the timing, or tick "Not decided yet".');
    if (kind === "collaboration") need("artists", v.artists.length >= 1, "Please choose at least one artist.");
    var ul = summary.querySelector("ul");
    ul.innerHTML = errs.map(function (e) {
      var target = form.querySelector('[data-field="' + e[0] + '"] input, [data-field="' + e[0] + '"] textarea');
      return '<li><a href="#' + (target ? target.id : "rq-form") + '">' + esc(e[1]) + "</a></li>";
    }).join("");
    summary.hidden = !errs.length;
    if (errs.length) summary.focus();
    return !errs.length;
  }

  async function uploadFiles() {
    var paths = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var safe = f.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "file";
      var path = who.session.user.id + "/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "-" + safe;
      status.textContent = "Uploading file " + (i + 1) + " of " + files.length + "…";
      var r = await P.sb.storage.from("request-files").upload(path, f, { contentType: f.type, upsert: false });
      if (r.error) throw new Error("A file could not be uploaded. Please try again, or send the brief without it.");
      paths.push(path);
    }
    return paths;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var v = values();
    if (!check(v)) return;
    if (!who.session) { saveDraft(); location.href = "/signin?next=" + encodeURIComponent(here()); return; }
    if (submit.disabled) { gate.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    submit.disabled = true;
    submit.classList.add("loading");
    status.textContent = "Sending…";
    try {
      var payload = {
        kind: kind, description: v.description, artwork_type: v.artwork_type || "", style_refs: v.style_refs || "",
        budget: v.budget || "", budget_undecided: !!v.budget_undecided, timeline: v.timeline || "", timeline_undecided: !!v.timeline_undecided,
        purpose: v.purpose || "", disciplines_wanted: v.disciplines_wanted || "", location: v.location || "", quantity_dims: v.quantity_dims || "",
        artists: v.artists
      };
      if (kind === "project" && files.length) payload.files = await uploadFiles();
      status.textContent = "Sending…";
      var res = await P.api("project-request", payload);
      clearDraft();
      form.hidden = true;
      gate.hidden = true;
      summary.hidden = true;
      var done = document.getElementById("rq-done");
      document.getElementById("rq-ref").textContent = res.reference;
      document.getElementById("rq-follow").href = "/account#/request/" + res.id;
      done.hidden = false;
      done.querySelector("h2").focus();
    } catch (err) {
      status.textContent = err.message || "Something went wrong. Nothing was sent. Please try again.";
      submit.disabled = false;
      submit.classList.remove("loading");
    }
  });

  /* ---------- Start ---------- */
  (async function start() {
    var draft = loadDraft();
    restore(draft);
    var chosen = (draft && draft.artists) || [];
    if (/^[0-9a-f-]{36}$/.test(preselect) && chosen.indexOf(preselect) === -1) chosen.push(preselect);
    syncUndecided();
    try { who = await P.member(); } catch (err) { who = { session: null, account: null }; }
    drawGate();
    await loadArtists(chosen);
  })();
})();
