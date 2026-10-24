/* Sign-in: email and password, then an emailed code for team members. */
(function () {
  "use strict";
  var M = window.MEET;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var next = params.get("next") || "";

  $("logo").insertAdjacentHTML("afterbegin", M.LOGO);

  function show(step) {
    ["step-password", "step-code"].forEach(function (id) { $(id).hidden = id !== step; });
    var input = $(step).querySelector("input");
    if (input) setTimeout(function () { input.focus(); }, 30);
  }
  function message(text, kind) {
    var el = $("msg");
    el.textContent = text;
    el.className = "notice" + (kind ? " " + kind : "");
    el.hidden = !text;
  }
  function fieldError(id, text) {
    var el = $(id);
    el.textContent = text || "";
    el.hidden = !text;
  }

  if (!M.configured) {
    message("The site is not connected to its database yet. Add the Supabase details to assets/js/config.js.", "warn");
    $("b-password").disabled = true;
    return;
  }
  if (params.get("out")) message("You have signed out.", "ok");
  if (params.get("noaccess")) message("This account does not have access yet. If you think this is a mistake, write to minds.exploring.traditions@gmail.com.", "warn");
  if (params.get("reset")) message("Your password has been updated. Please sign in.", "ok");

  async function go() {
    var dest = await M.routeAfterSignIn(next);
    if (dest === null) {
      await M.sb.auth.signOut();
      show("step-password");
      message("This account does not have access yet. If you think this is a mistake, write to minds.exploring.traditions@gmail.com.", "warn");
      return;
    }
    if (dest.indexOf("/signin?step=code") === 0) { await sendCode(); return; }
    location.replace(dest);
  }

  function nextPage() {
    return next && /^\/(team|prototype)(\/|#|$)/.test(next) ? next : "/team";
  }

  async function sendCode() {
    show("step-code");
    fieldError("err-code", "");
    try {
      var r = await M.api("team-code", { action: "send" });
      if (r.confirmed) { M.setGateCookie(await M.session()); location.replace(nextPage()); return; }
      $("code-sent").textContent = "We have emailed a 6-digit code to " + (r.sent_to || "your email") + ". Enter it below to finish signing in.";
    } catch (err) {
      fieldError("err-code", M.friendlyError(err));
    }
  }

  // Sends the email-confirmation link again (for new member accounts).
  function showResend(email) {
    var box = $("resend-box");
    box.hidden = false;
    $("b-resend-confirm").onclick = async function () {
      M.setBusy(this, true, "Sending");
      var r = await M.sb.auth.resend({ type: "signup", email: email });
      M.setBusy(this, false);
      message(r.error ? M.friendlyError(r.error) : "We sent a new confirmation email to " + email + ". Check your spam folder too.", r.error ? "err" : "ok");
    };
  }

  $("f-code").addEventListener("submit", async function (e) {
    e.preventDefault();
    var code = $("code").value.replace(/\D/g, "");
    if (code.length !== 6) { fieldError("err-code", "Please enter the 6 digits from the email."); return; }
    fieldError("err-code", "");
    M.setBusy($("b-code"), true, "Checking");
    try {
      await M.api("team-code", { action: "verify", code: code });
      M.setGateCookie(await M.session());
      location.replace(nextPage());
    } catch (err) {
      M.setBusy($("b-code"), false);
      fieldError("err-code", M.friendlyError(err));
      $("code").select();
    }
  });

  $("b-resend").addEventListener("click", function () {
    $("code").value = "";
    sendCode();
  });

  $("f-password").addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("email").value.trim(), pw = $("password").value;
    if (!email || !pw) { fieldError("err-password", "Please enter your email and password."); return; }
    fieldError("err-password", "");
    message("");
    M.setBusy($("b-password"), true, "Signing in");
    var r = await M.sb.auth.signInWithPassword({ email: email, password: pw });
    M.setBusy($("b-password"), false);
    if (r.error && /not confirmed/i.test(r.error.message)) {
      fieldError("err-password", "Please confirm your email first: open the email we sent when you signed up and press the button in it.");
      showResend(email);
      return;
    }
    if (r.error) {
      fieldError("err-password", /fetch|network/i.test(r.error.message)
        ? "We could not reach the server. Please check your connection and try again."
        : "That email and password do not match. Please try again, or reset your password.");
      return;
    }
    go();
  });

  document.querySelectorAll("[data-signout]").forEach(function (b) { b.addEventListener("click", M.signOut); });

  // Already signed in: carry on from where they are.
  (async function () {
    var s = await M.session();
    if (s && !params.get("out")) go();
  })();
})();
