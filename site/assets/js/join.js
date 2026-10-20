/* M.E.E.T. artist registration form.
   Validates on the device, sends to the server, and only shows success
   once the server confirms the application is stored. Nothing typed is
   ever cleared by a failed send. */
(function () {
  "use strict";

  var form = document.getElementById("join-form");
  if (!form) return;

  var DRAFT_KEY = "meet-join-draft-v1";
  var summary = document.getElementById("error-summary");
  var summaryMsg = document.getElementById("error-message");
  var summaryList = document.getElementById("error-list");
  var submitBtn = document.getElementById("submit-btn");
  var submitLabel = submitBtn.querySelector(".btn-label");
  var statusEl = document.getElementById("submit-status");
  var success = document.getElementById("success");
  var nextMobile = document.getElementById("next-mobile");
  var discipline = form.elements.primary_discipline;
  var otherField = document.getElementById("discipline_other-field");
  var practice = form.elements.practice;
  var practiceCount = document.getElementById("practice-count");

  var LABELS = {
    full_name: "Full name",
    artist_name: "Professional or artist name",
    email: "Email address",
    country: "Country",
    city: "City",
    primary_discipline: "Main discipline",
    discipline_other: "Describe your discipline",
    practice: "Your practice",
    additional_disciplines: "Other disciplines",
    website: "Website",
    social: "Professional profile",
    portfolio_links: "More links",
    consent_privacy: "Privacy notice"
  };

  var TEXT_FIELDS = ["full_name", "artist_name", "email", "country", "city", "primary_discipline",
    "discipline_other", "practice", "additional_disciplines", "website", "social",
    "portfolio_links", "heard_about"];
  var CHECK_FIELDS = ["interest_commissions", "interest_collaboration", "consent_privacy"];

  var sending = false;
  var openedAt = Date.now();   // a person takes a few seconds; most bots do not
  var CFG = window.MEET_CONFIG || {};

  /* ---------- draft kept for this browser tab only ---------- */

  function saveDraft() {
    try {
      var data = {};
      TEXT_FIELDS.forEach(function (n) { data[n] = form.elements[n].value; });
      CHECK_FIELDS.forEach(function (n) { data[n] = form.elements[n].checked; });
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable: the form still works */ }
  }
  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      TEXT_FIELDS.forEach(function (n) { if (typeof data[n] === "string") form.elements[n].value = data[n]; });
      CHECK_FIELDS.forEach(function (n) { if (typeof data[n] === "boolean") form.elements[n].checked = data[n]; });
    } catch (e) { /* ignore */ }
  }
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }

  var saveTimer;
  form.addEventListener("input", function (e) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 300);
    var field = e.target.closest(".field");
    if (field && field.classList.contains("invalid")) {
      // Re-check as they fix it, so the error clears the moment it is resolved.
      var errs = validate();
      if (!errs[e.target.name]) clearError(e.target.name);
    }
  });
  form.addEventListener("change", function (e) {
    saveDraft();
    if (e.target.type === "checkbox" && e.target.checked) clearError(e.target.name);
  });

  /* ---------- small helpers ---------- */

  function syncOther() {
    var isOther = discipline.value === "Other";
    otherField.hidden = !isOther;
    form.elements.discipline_other.required = isOther;
    if (!isOther) clearError("discipline_other");
  }
  discipline.addEventListener("change", syncOther);

  function syncCount() {
    var n = practice.value.length;
    practiceCount.textContent = n + " of 1500 characters" + (n > 0 && n < 40 ? ", at least 40 please" : "");
  }
  practice.addEventListener("input", syncCount);

  loadDraft();
  syncOther();
  syncCount();

  /* ---------- country and city suggestions ---------- */

  var PLACES = window.MEET_PLACES || [];

  function fold(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ʻ'’.]/g, "").toLowerCase().trim();
  }

  var countryIndex = PLACES.map(function (c) {
    return { name: c[0], keys: [c[0]].concat(c[1]).map(fold), cities: c[2] };
  });
  var allCities = [];
  countryIndex.forEach(function (c) {
    c.cities.forEach(function (city) { allCities.push({ name: city, key: fold(city), country: c.name }); });
  });

  function findCountry(text) {
    var k = fold(text);
    if (!k) return null;
    for (var i = 0; i < countryIndex.length; i++) {
      if (countryIndex[i].keys.indexOf(k) !== -1) return countryIndex[i];
    }
    return null;
  }

  // Rank: starts with the query, then a word starts with it, then contains it.
  function rank(key, q) {
    if (key === q) return 0;
    if (key.indexOf(q) === 0) return 1;
    if (key.indexOf(" " + q) !== -1 || key.indexOf("-" + q) !== -1) return 2;
    if (key.indexOf(q) !== -1) return 3;
    return -1;
  }

  function countrySuggestions(text) {
    var q = fold(text);
    if (!q) return [];
    var out = [];
    countryIndex.forEach(function (c) {
      var best = -1;
      c.keys.forEach(function (k) { var r = rank(k, q); if (r !== -1 && (best === -1 || r < best)) best = r; });
      if (best !== -1) out.push({ r: best, label: c.name, value: c.name });
    });
    out.sort(function (a, b) { return a.r - b.r || a.label.localeCompare(b.label); });
    return out.slice(0, 8);
  }

  function citySuggestions(text) {
    var q = fold(text);
    if (!q) return [];
    var country = findCountry(form.elements.country.value);
    var pool = country
      ? country.cities.map(function (n) { return { name: n, key: fold(n), country: country.name }; })
      : allCities;
    var out = [];
    pool.forEach(function (c) {
      var r = rank(c.key, q);
      if (r !== -1) out.push({ r: r, label: c.name, value: c.name, hint: country ? "" : c.country, country: c.country });
    });
    out.sort(function (a, b) { return a.r - b.r || a.label.localeCompare(b.label); });
    return out.slice(0, 8);
  }

  function combobox(input, list, suggest, onPick) {
    var items = [];
    var active = -1;

    function close() {
      list.hidden = true;
      list.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      items = [];
      active = -1;
    }

    function setActive(i) {
      var opts = list.querySelectorAll('[role="option"]');
      opts.forEach(function (o, n) { o.setAttribute("aria-selected", n === i ? "true" : "false"); });
      active = i;
      if (i >= 0 && opts[i]) {
        input.setAttribute("aria-activedescendant", opts[i].id);
        opts[i].scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function pick(i) {
      var item = items[i];
      if (!item) return;
      input.value = item.value;
      close();
      if (onPick) onPick(item);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function open() {
      items = suggest(input.value);
      list.innerHTML = "";
      active = -1;
      // Nothing to show, or the text already matches the only suggestion exactly.
      if (!items.length || (items.length === 1 && fold(items[0].value) === fold(input.value))) {
        close();
        return;
      }
      items.forEach(function (item, i) {
        var li = document.createElement("li");
        li.id = list.id + "-opt-" + i;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        var span = document.createElement("span");
        span.textContent = item.label;
        li.appendChild(span);
        if (item.hint) {
          var small = document.createElement("small");
          small.textContent = item.hint;
          li.appendChild(small);
        }
        // mousedown keeps focus in the field; click picks the option
        li.addEventListener("mousedown", function (e) { e.preventDefault(); });
        li.addEventListener("click", function () { pick(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    input.addEventListener("input", function (e) {
      if (e.isTrusted === false) return; // our own event after a pick
      open();
    });
    input.addEventListener("focus", function () { if (input.value) open(); });
    input.addEventListener("blur", function () { setTimeout(close, 120); });
    input.addEventListener("keydown", function (e) {
      if (list.hidden) {
        if (e.key === "ArrowDown" && input.value) { open(); if (items.length) setActive(0); e.preventDefault(); }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(active + 1, items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      else if (e.key === "Enter") { if (active >= 0) { e.preventDefault(); pick(active); } }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") { if (active >= 0) pick(active); else close(); }
    });
  }

  if (PLACES.length) {
    combobox(form.elements.country, document.getElementById("country-list"), countrySuggestions);
    combobox(form.elements.city, document.getElementById("city-list"), citySuggestions, function (item) {
      // Picking a city fills in its country when none is set yet.
      if (!value("country") && item.country) {
        form.elements.country.value = item.country;
        clearError("country");
      }
    });
  }

  function value(name) { return (form.elements[name].value || "").trim(); }

  function looksLikeUrl(v) {
    if (!v) return true;
    var s = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v;
    try {
      var u = new URL(s);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.indexOf(".") > 0 && !/\s/.test(v);
    } catch (e) { return false; }
  }

  /* ---------- validation (mirrors the server, which has the final say) ---------- */

  function validate() {
    var e = {};
    if (!value("full_name")) e.full_name = "Please enter your full name.";
    if (!value("artist_name")) e.artist_name = "Please enter your professional or artist name. It can be the same as your full name.";
    var email = value("email");
    if (!email) e.email = "Please enter your email address.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) e.email = "This email address does not look complete. Please check it, for example name@studio.com";
    if (!value("country")) e.country = "Please tell us which country you are based in.";
    if (!value("primary_discipline")) e.primary_discipline = "Please choose your main discipline.";
    if (value("primary_discipline") === "Other" && !value("discipline_other")) e.discipline_other = "Please describe your discipline in a few words.";
    var p = value("practice");
    if (!p) e.practice = "Please describe your practice in a few sentences.";
    else if (p.length < 40) e.practice = "Please tell us a little more, at least a couple of sentences (40 characters or more).";
    if (!looksLikeUrl(value("website"))) e.website = "Please enter a full web address, for example https://yourname.com";
    var links = value("portfolio_links").split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (links.length > 6) e.portfolio_links = "Please share up to 6 links.";
    else {
      for (var i = 0; i < links.length; i++) {
        if (!looksLikeUrl(links[i])) { e.portfolio_links = "One of these links is not a full web address: " + links[i].slice(0, 60); break; }
      }
    }
    if (!form.elements.consent_privacy.checked) e.consent_privacy = "Please confirm that you have read the privacy notice so we can store your application.";
    return e;
  }

  function fieldWrap(name) {
    var el = form.elements[name];
    return el ? el.closest(".field") : null;
  }

  function clearError(name) {
    var wrap = fieldWrap(name);
    var el = form.elements[name];
    var msg = document.getElementById(name + "-error");
    if (wrap) wrap.classList.remove("invalid");
    if (el) el.removeAttribute("aria-invalid");
    if (msg) msg.textContent = "";
  }

  function clearAllErrors() {
    Object.keys(LABELS).forEach(clearError);
    summary.hidden = true;
    summaryList.innerHTML = "";
    summaryMsg.textContent = "";
  }

  function showErrors(errors, message) {
    clearAllErrors();
    var names = Object.keys(errors);
    names.forEach(function (name) {
      var wrap = fieldWrap(name);
      var el = form.elements[name];
      var msg = document.getElementById(name + "-error");
      if (wrap) wrap.classList.add("invalid");
      if (el) el.setAttribute("aria-invalid", "true");
      if (msg) msg.textContent = errors[name];
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + name;
      a.textContent = LABELS[name] || name;
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var target = form.elements[name];
        if (target) {
          target.scrollIntoView({ block: "center" });
          target.focus({ preventScroll: true });
        }
      });
      li.appendChild(a);
      summaryList.appendChild(li);
    });
    summaryMsg.textContent = message || (names.length === 1 ? "One answer needs your attention." : names.length + " answers need your attention.");
    document.getElementById("error-title").textContent = "Please check a few things";
    summary.hidden = false;
    summary.scrollIntoView({ block: "start" });
    summary.focus({ preventScroll: true });
  }

  function showProblem(title, message) {
    clearAllErrors();
    document.getElementById("error-title").textContent = title;
    summaryMsg.textContent = message;
    summary.hidden = false;
    summary.scrollIntoView({ block: "start" });
    summary.focus({ preventScroll: true });
  }

  function setSending(on) {
    sending = on;
    submitBtn.disabled = on;
    submitBtn.classList.toggle("loading", on);
    submitBtn.setAttribute("aria-busy", on ? "true" : "false");
    submitLabel.textContent = on ? "Sending your application" : "Send my application";
    statusEl.textContent = on ? "Saving your application. Please keep this page open." : "";
  }

  function payload() {
    var data = {};
    TEXT_FIELDS.forEach(function (n) { data[n] = form.elements[n].value; });
    data.interest_commissions = form.elements.interest_commissions.checked;
    data.interest_collaboration = form.elements.interest_collaboration.checked;
    data.consent_privacy = form.elements.consent_privacy.checked;
    data.company_website = form.elements.company_website.value;
    data.elapsed_ms = Date.now() - openedAt;
    return data;
  }

  // Saves through the database's public submit_application function. Visitors
  // can call only this function; they can never read stored applications.
  function post() {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || /YOUR-/.test(CFG.supabaseUrl + CFG.supabaseAnonKey)) return Promise.reject(new Error("not configured"));
    return fetch(CFG.supabaseUrl + "/rest/v1/rpc/submit_application", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CFG.supabaseAnonKey,
        "Authorization": "Bearer " + CFG.supabaseAnonKey
      },
      body: JSON.stringify({ payload: payload() })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    });
  }

  /* ---------- submit ---------- */

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (sending) return;

    var errors = validate();
    if (Object.keys(errors).length) { showErrors(errors); return; }

    clearAllErrors();
    setSending(true);

    post()
      .then(function (result) {
        setSending(false);
        var b = result.body || {};
        if (result.status === 200 && b.ok && b.reference) {
          showSuccess(b.reference);
          return;
        }
        if (b.code === "invalid" && b.errors) {
          showErrors(b.errors, b.message);
          return;
        }
        showProblem("Your application was not sent", (b.message || "Something went wrong on our side.") + " Everything you typed is still here.");
      })
      .catch(function (err) {
        setSending(false);
        if (err && err.message === "not configured") {
          showProblem("Registration is not open yet", "This form is not connected to its database yet. Everything you typed is still here.");
          return;
        }
        showProblem("We could not reach the server", "Your application was not sent, and everything you typed is still here. Please check your connection and press send again.");
      });
  });

  function showSuccess(reference) {
    document.getElementById("success-name").textContent = value("artist_name") || value("full_name");
    document.getElementById("success-email").textContent = value("email");
    document.getElementById("success-ref").textContent = reference;
    clearDraft();
    form.hidden = true;
    if (nextMobile) nextMobile.hidden = true;
    success.hidden = false;
    document.body.classList.add("is-done");
    window.scrollTo({ top: 0 });
    document.getElementById("success-title").focus({ preventScroll: true });
  }

  document.getElementById("another").addEventListener("click", function () {
    form.reset();
    clearDraft();
    clearAllErrors();
    syncOther();
    syncCount();
    success.hidden = true;
    document.body.classList.remove("is-done");
    form.hidden = false;
    if (nextMobile) nextMobile.hidden = false;
    openedAt = Date.now();
    window.scrollTo({ top: 0 });
    form.elements.full_name.focus({ preventScroll: true });
  });
})();
