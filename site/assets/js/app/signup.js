/* Member sign-up: Personal, Professional, Business & Organization.
   Creates a Supabase login (email must be confirmed before sign-in). The
   database turns the sign-up details into a member account; it also checks
   the required fields again, so a tampered request cannot skip them. */
(function () {
  "use strict";
  var M = window.MEET;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("f-signup");
  var type = "";
  var lastEmail = "";

  var LABELS = { personal: "Personal account", professional: "Professional account", business: "Business & Organization account" };
  var REQUIRED = {
    personal: ["full_name", "country", "email", "password", "password2"],
    professional: ["full_name", "country", "professional_role", "company_name", "email", "password", "password2"],
    business: ["business_name", "business_type", "contact_person", "full_name", "country", "email", "password", "password2"]
  };
  var MESSAGES = {
    full_name: "Please enter your full name.",
    country: "Please tell us which country you are based in.",
    professional_role: "Please tell us your professional role.",
    company_name: "Please enter your company or studio name.",
    business_name: "Please enter the business or organization name.",
    business_type: "Please tell us what kind of business or organization it is.",
    contact_person: "Please enter the contact person's name.",
    email: "Please enter your email address.",
    password: "Please choose a password of at least 8 characters.",
    password2: "Please type your password again."
  };

  $("logo").insertAdjacentHTML("afterbegin", M.LOGO);

  // Country suggestions from the same list the artist registration uses.
  (window.MEET_PLACES || []).forEach(function (c) {
    var o = document.createElement("option");
    o.value = c[0];
    $("country-list").appendChild(o);
  });

  function show(step) {
    ["step-type", "step-form", "step-done"].forEach(function (id) { $(id).hidden = id !== step; });
    window.scrollTo({ top: 0 });
  }
  function message(text, kind) {
    var el = $("msg");
    el.textContent = text;
    el.className = "notice" + (kind ? " " + kind : "");
    el.hidden = !text;
  }

  function chooseType(t) {
    type = t;
    $("form-eyebrow").textContent = LABELS[t];
    $("you-legend").textContent = t === "business" ? "About you, the person creating this account" : "About you";
    form.querySelectorAll("[data-for]").forEach(function (fs) { fs.hidden = fs.getAttribute("data-for") !== t; });
    clearErrors();
    show("step-form");
    var first = form.querySelector('fieldset:not([hidden]) input');
    if (first) first.focus();
    try { history.replaceState(null, "", "/signup?type=" + t); } catch (e) { /* ignore */ }
  }

  document.querySelectorAll("[data-type]").forEach(function (b) {
    b.addEventListener("click", function () { chooseType(b.getAttribute("data-type")); });
  });
  $("b-back").addEventListener("click", function () {
    show("step-type");
    try { history.replaceState(null, "", "/signup"); } catch (e) { /* ignore */ }
  });

  function val(name) { return (form.elements[name].value || "").trim(); }
  function looksLikeUrl(v) {
    if (!v) return true;
    var s = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : "https://" + v;
    try { var u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.indexOf(".") > 0 && !/\s/.test(v); }
    catch (e) { return false; }
  }

  function clearErrors() {
    form.querySelectorAll("[data-err]").forEach(function (e) { e.hidden = true; e.textContent = ""; });
    form.querySelectorAll(".inp.invalid").forEach(function (e) { e.classList.remove("invalid"); e.removeAttribute("aria-invalid"); });
    $("err-form").hidden = true;
  }
  function setError(name, text) {
    var e = form.querySelector('[data-err="' + name + '"]');
    if (e) { e.textContent = text; e.hidden = false; }
    var input = form.elements[name];
    if (input && input.classList) { input.classList.add("invalid"); input.setAttribute("aria-invalid", "true"); }
  }

  function validate() {
    var errors = {};
    REQUIRED[type].forEach(function (n) { if (!val(n)) errors[n] = MESSAGES[n]; });
    var email = val("email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) errors.email = "This email address does not look complete, for example name@studio.com";
    var pw = form.elements.password.value;
    if (pw && pw.length < 8) errors.password = "Please use at least 8 characters.";
    if (pw && form.elements.password2.value && pw !== form.elements.password2.value) errors.password2 = "The two passwords do not match.";
    var phone = val("phone");
    if (phone && !/^[+()0-9\s.-]{6,40}$/.test(phone)) errors.phone = "Please use digits only, with an optional + and country code.";
    if (type === "professional" && !looksLikeUrl(val("professional_website"))) errors.professional_website = "Please enter a full web address, for example https://studio.com";
    if (type === "business" && !looksLikeUrl(val("business_website"))) errors.business_website = "Please enter a full web address, for example https://hotel.com";
    if (!form.elements.consent.checked) errors.consent = "Please confirm that you have read the privacy notice.";
    return errors;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearErrors();
    message("");
    var errors = validate();
    var names = Object.keys(errors);
    if (names.length) {
      names.forEach(function (n) { setError(n, errors[n]); });
      var first = form.elements[names[0]];
      if (first && first.focus) first.focus();
      return;
    }
    if (!M.configured) { $("err-form").textContent = "Sign-up is not connected yet."; $("err-form").hidden = false; return; }

    // Only the fields that belong to the chosen account type are sent.
    var data = { account_type: type, full_name: val("full_name"), country: val("country"), phone: val("phone") };
    if (type === "professional") {
      data.professional_role = val("professional_role");
      data.company_name = val("company_name");
      data.professional_website = val("professional_website");
    }
    if (type === "business") {
      data.business_name = val("business_name");
      data.business_type = val("business_type");
      data.contact_person = val("contact_person");
      data.business_website = val("business_website");
    }

    var btn = $("b-submit");
    M.setBusy(btn, true, "Creating your account");
    var r = await M.sb.auth.signUp({
      email: val("email"),
      password: form.elements.password.value,
      options: { data: data, emailRedirectTo: location.origin + "/welcome?type=signup" }
    });
    M.setBusy(btn, false);

    if (r.error) {
      var m = r.error.message || "";
      var text = /already registered|already exists/i.test(m) ? "An account with this email already exists. Please sign in, or reset your password."
        : /password/i.test(m) && /weak|short|characters|pwned|leaked/i.test(m) ? "Please choose a stronger password: at least 8 characters, and not one used on other sites."
        : /rate|too many/i.test(m) ? "Too many attempts. Please wait a few minutes and try again."
        : /Database error|saving new user/i.test(m) ? "Some details could not be saved. Please check the form and try again."
        : /fetch|network/i.test(m) ? "We could not reach the server. Please check your connection and try again."
        : "Your account could not be created. " + m;
      $("err-form").textContent = text;
      $("err-form").hidden = false;
      return;
    }
    lastEmail = val("email");
    $("done-email").textContent = lastEmail;
    form.reset();
    show("step-done");
    $("t-done").focus();
  });

  $("b-resend").addEventListener("click", async function () {
    if (!lastEmail) return;
    M.setBusy(this, true, "Sending");
    var r = await M.sb.auth.resend({ type: "signup", email: lastEmail });
    M.setBusy(this, false);
    message(r.error ? M.friendlyError(r.error) : "We sent the confirmation email again to " + lastEmail + ".", r.error ? "err" : "ok");
  });

  var initial = new URLSearchParams(location.search).get("type");
  if (REQUIRED[initial]) chooseType(initial);
})();
