/* Sign-in: email and password, then two-step verification for team members. */
(function () {
  "use strict";
  var M = window.MEET;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var next = params.get("next") || "";
  var factorId = null;

  $("logo").insertAdjacentHTML("afterbegin", M.LOGO);

  function show(step) {
    ["step-password", "step-enroll", "step-verify"].forEach(function (id) { $(id).hidden = id !== step; });
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
    if (dest.indexOf("/signin?step=mfa") === 0) { await startMfa(); return; }
    location.replace(dest);
  }

  async function startMfa() {
    var list = await M.sb.auth.mfa.listFactors();
    if (list.error) { message(M.friendlyError(list.error), "err"); return; }
    var verified = (list.data.totp || []).filter(function (f) { return f.status === "verified"; });
    if (verified.length) {
      factorId = verified[0].id;
      show("step-verify");
      return;
    }
    // Clear any half-finished setup, then start a fresh one.
    var stale = (list.data.all || []).filter(function (f) { return f.status !== "verified"; });
    for (var i = 0; i < stale.length; i++) await M.sb.auth.mfa.unenroll({ factorId: stale[i].id });
    var en = await M.sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "M.E.E.T. team " + new Date().toISOString().slice(0, 10) });
    if (en.error) { message(M.friendlyError(en.error), "err"); return; }
    factorId = en.data.id;
    $("qr").src = en.data.totp.qr_code;
    $("secret").textContent = en.data.totp.secret;
    show("step-enroll");
  }

  async function verifyCode(inputId, errId, btnId) {
    var code = $(inputId).value.replace(/\D/g, "");
    if (code.length !== 6) { fieldError(errId, "Please enter the 6-digit code from your authenticator app."); return; }
    fieldError(errId, "");
    M.setBusy($(btnId), true, "Checking");
    var r = await M.sb.auth.mfa.challengeAndVerify({ factorId: factorId, code: code });
    M.setBusy($(btnId), false);
    if (r.error) {
      fieldError(errId, "That code did not work. Codes change every 30 seconds, so please try the newest one.");
      $(inputId).select();
      return;
    }
    var s = await M.session();
    M.setGateCookie(s);
    location.replace(next && /^\/(team|prototype)(\/|#|$)/.test(next) ? next : "/team");
  }

  $("f-password").addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("email").value.trim(), pw = $("password").value;
    if (!email || !pw) { fieldError("err-password", "Please enter your email and password."); return; }
    fieldError("err-password", "");
    message("");
    M.setBusy($("b-password"), true, "Signing in");
    var r = await M.sb.auth.signInWithPassword({ email: email, password: pw });
    M.setBusy($("b-password"), false);
    if (r.error) {
      fieldError("err-password", /fetch|network/i.test(r.error.message)
        ? "We could not reach the server. Please check your connection and try again."
        : "That email and password do not match. Please try again, or reset your password.");
      return;
    }
    go();
  });

  $("f-enroll").addEventListener("submit", function (e) { e.preventDefault(); verifyCode("code-enroll", "err-enroll", "b-enroll"); });
  $("f-verify").addEventListener("submit", function (e) { e.preventDefault(); verifyCode("code-verify", "err-verify", "b-verify"); });
  document.querySelectorAll("[data-signout]").forEach(function (b) { b.addEventListener("click", M.signOut); });

  // Already signed in: carry on from where they are.
  (async function () {
    var s = await M.session();
    if (s && !params.get("out")) go();
  })();
})();
