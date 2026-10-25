/* M.E.E.T. shared page behaviour: entrances, header state, mobile join bar. */
(function () {
  "use strict";

  // Mark that scripts run, so entrance states only apply when they can finish.
  document.documentElement.classList.add("js");

  // The homepage is drawn from the published content (home.js). Hold it for a
  // moment so visitors do not see the built-in version swap; never longer.
  if (location.pathname === "/" || location.pathname === "/index.html") {
    document.documentElement.classList.add("home-wait");
    setTimeout(function () { document.documentElement.classList.remove("home-wait"); }, 1800);
  }

  // Remember where a visitor came from (?from=qr-dubai etc.) until they register.
  try {
    var from = (new URLSearchParams(location.search).get("from") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (from) sessionStorage.setItem("meet-source", from);
  } catch (e) { /* storage unavailable */ }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  // Entrances: reveal once, then retire stagger delays so hovers never lag.
  // Pages that draw content later (the homepage) call it again for new parts.
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      el.classList.add("in");
      setTimeout(function () { el.classList.add("settled"); }, 1700);
      io.unobserve(el);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }) : null;
  function reveal(root) {
    (root || document).querySelectorAll(".reveal:not(.in), .reveal-img:not(.in)").forEach(function (el) {
      if (io) io.observe(el); else el.classList.add("in", "settled");
    });
  }
  window.MEET_REVEAL = reveal;

  ready(function () {
    reveal(document);

    // Header hairline once the page moves.
    var header = document.querySelector(".site-header");
    function onScroll() {
      if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();


    // Signed in on this browser: show the way to the account instead of
    // Sign in / Sign up. Navigation only; access is checked by each page.
    var home = null;
    try {
      if (localStorage.getItem("meet-auth")) home = JSON.parse(localStorage.getItem("meet-home") || "null");
      else localStorage.removeItem("meet-home");
    } catch (e) { home = null; }
    if (home && /^\/(account|studio|team)$/.test(home.href)) {
      document.querySelectorAll('a[href="/signin"]').forEach(function (a) {
        if (!a.closest(".site-header")) return;
        a.setAttribute("href", home.href);
        a.textContent = home.label;
        a.classList.add("is-account");
      });
      document.querySelectorAll('.site-header a[href="/signup"]').forEach(function (a) {
        var li = a.closest("li"); (li || a).hidden = true;
      });
      // Artists and the team already have their place; members may still apply as artists.
      if (home.kind !== "member") document.querySelectorAll('.site-header a.btn[href="/for-artists"], .site-header .nav-m a[href="/for-artists"]').forEach(function (a) {
        var li = a.closest("li"); (li || a).hidden = true;
      });
    }

    // Phone menu: Artists, Sign in and Create an account fold into one panel.
    var toggle = document.querySelector(".nav-toggle");
    var menu = document.getElementById("nav-menu");
    if (toggle && menu) {
      var setOpen = function (open) {
        menu.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.textContent = open ? "Close" : "Menu";
      };
      toggle.addEventListener("click", function () { setOpen(!menu.classList.contains("open")); });
      menu.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && menu.classList.contains("open")) { setOpen(false); toggle.focus(); }
      });
    }

    // Pause every loop on hidden tabs.
    document.addEventListener("visibilitychange", function () {
      document.body.classList.toggle("paused", document.hidden);
    });
  });
})();
