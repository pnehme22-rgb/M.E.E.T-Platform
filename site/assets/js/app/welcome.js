/* Welcome / reset landing: confirms the emailed link, then sets a password. */
(function () {
  "use strict";
  var M = window.MEET;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var tokenHash = params.get("th") || params.get("token_hash") || "";
  var type = params.get("type") || "invite";
  if (["invite", "recovery", "magiclink", "signup"].indexOf(type) === -1) type = "invite";

  $("logo").insertAdjacentHTML("afterbegin", M.LOGO);

  function show(step) {
    ["step-open", "step-password", "step-expired"].forEach(function (id) { $(id).hidden = id !== step; });
    // An unconfirmed member account gets a fresh confirmation email from the sign-in page.
    if (step === "step-expired" && type === "signup") {
      var again = document.querySelector("#step-expired .btn");
      again.href = "/signin";
      again.textContent = "Sign in to get a new confirmation email";
    }
  }
  function message(text, kind) {
    var el = $("msg");
    el.textContent = text;
    el.className = "notice" + (kind ? " " + kind : "");
    el.hidden = !text;
  }

  if (!M.configured) { message("The site is not connected to its database yet.", "warn"); return; }

  var isWelcome = params.get("w") === "1";   // invites to people who already have an account arrive as password links
  if (type === "recovery" && !isWelcome) {
    $("open-eyebrow").textContent = "Password reset";
    $("open-title").innerHTML = "Choose a new <em>password</em>";
    $("open-text").textContent = "Press continue to set a new password for your M.E.E.T. account.";
  } else if (type === "signup") {
    $("open-eyebrow").textContent = "Confirm your email";
    $("open-title").innerHTML = "One last <em>step</em>";
    $("open-text").textContent = "Press continue to confirm your email address and open your M.E.E.T. account.";
  } else if (type === "magiclink") {
    $("open-title").innerHTML = "Welcome <em>back</em>";
    $("open-text").textContent = "Press continue to sign in to your M.E.E.T. studio.";
  }

  async function finish() {
    var dest = await M.routeAfterSignIn("");
    location.replace(dest || "/signin?noaccess=1");
  }

  $("b-open").addEventListener("click", async function () {
    M.setBusy($("b-open"), true, "Opening");
    var r = await M.sb.auth.verifyOtp({ token_hash: tokenHash, type: type === "magiclink" ? "magiclink" : type });
    M.setBusy($("b-open"), false);
    // The link has done its job: take it out of the address bar and history.
    history.replaceState(null, "", "/welcome");
    if (r.error) { show("step-expired"); return; }
    if (type === "magiclink" || type === "signup") { finish(); return; }
    $("pw-for").textContent = "For " + (r.data.user && r.data.user.email || "your account") + ".";
    await prepareMfa();
    show("step-password");
    $("pw1").focus();
  });

  // Accounts with two-step sign-in (the team) must enter their code before
  // Supabase allows a password change.
  var mfaFactor = null;
  async function prepareMfa() {
    var aal = await M.sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.data && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
      var list = await M.sb.auth.mfa.listFactors();
      var f = (list.data && list.data.totp || []).filter(function (x) { return x.status === "verified"; })[0];
      if (f) { mfaFactor = f.id; $("mfa-box").hidden = false; }
    }
  }

  $("f-password").addEventListener("submit", async function (e) {
    e.preventDefault();
    var a = $("pw1").value, b = $("pw2").value, err = $("err-password");
    var problem = a.length < 8 ? "Please use at least 8 characters." : a !== b ? "The two passwords do not match." : "";
    err.textContent = problem; err.hidden = !problem;
    if (problem) return;
    M.setBusy($("b-password"), true, "Saving");
    if (mfaFactor) {
      var code = $("mfa-code").value.replace(/\D/g, "");
      if (code.length !== 6) { M.setBusy($("b-password"), false); err.textContent = "Please enter the 6-digit code from your authenticator app."; err.hidden = false; return; }
      var v = await M.sb.auth.mfa.challengeAndVerify({ factorId: mfaFactor, code: code });
      if (v.error) { M.setBusy($("b-password"), false); err.textContent = "That code did not work. Codes change every 30 seconds, so please try the newest one."; err.hidden = false; return; }
      mfaFactor = null;
      $("mfa-box").hidden = true;
    }
    var r = await M.sb.auth.updateUser({ password: a });
    M.setBusy($("b-password"), false);
    if (r.error) {
      err.textContent = /weak|pwned|leaked/i.test(r.error.message)
        ? "This password is too easy to guess or has appeared in a data leak. Please choose another."
        : M.friendlyError(r.error);
      err.hidden = false;
      return;
    }
    finish();
  });

  (async function () {
    if (tokenHash) { show("step-open"); $("b-open").focus(); return; }
    // Supabase's standard confirmation email (if the custom template is not
    // set) returns here with the sign-in in the address fragment instead.
    var frag = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (frag.get("access_token") && frag.get("refresh_token")) {
      var set = await M.sb.auth.setSession({ access_token: frag.get("access_token"), refresh_token: frag.get("refresh_token") });
      history.replaceState(null, "", "/welcome");
      if (!set.error && type === "signup") { finish(); return; }
      if (set.error) { show("step-expired"); return; }
    }
    // No link in the address: someone already confirmed it and may still need a password.
    var s = await M.session();
    if (s) { $("pw-for").textContent = "For " + s.user.email + "."; await prepareMfa(); show("step-password"); return; }
    show("step-expired");
  })();
})();
