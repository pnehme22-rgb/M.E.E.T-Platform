/* Password reset request. Always gives the same answer, so nobody can use
   this page to find out which emails have accounts. */
(function () {
  "use strict";
  var M = window.MEET;
  var $ = function (id) { return document.getElementById(id); };
  $("logo").insertAdjacentHTML("afterbegin", M.LOGO);

  // An earlier error disappears as soon as the address is edited.
  $("email").addEventListener("input", function () { $("err").hidden = true; });

  $("f-reset").addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("email").value.trim();
    var err = $("err");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      err.textContent = "Please enter a complete email address, for example name@studio.com";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    if (!M.configured) { err.textContent = "The site is not connected to its database yet."; err.hidden = false; return; }
    M.setBusy($("b-reset"), true, "Sending");
    var r = await M.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/welcome?type=recovery" });
    M.setBusy($("b-reset"), false);
    if (r.error && /fetch|network/i.test(r.error.message)) {
      err.textContent = "We could not reach the server. Please check your connection and try again.";
      err.hidden = false;
      return;
    }
    if (r.error && (r.error.status >= 500 || /sending|smtp/i.test(r.error.message))) {
      err.textContent = "We could not send the email just now. Please try again in a few minutes, or write to minds.exploring.traditions@gmail.com and we will help you.";
      err.hidden = false;
      return;
    }
    if (r.error && /rate|too many/i.test(r.error.message)) {
      err.textContent = "Too many requests. Please wait a few minutes and try again.";
      err.hidden = false;
      return;
    }
    $("sent-to").textContent = email;
    $("step-ask").hidden = true;
    $("step-sent").hidden = false;
  });
})();
