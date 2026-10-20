/* M.E.E.T. shared page behaviour: entrances, header state, mobile join bar. */
(function () {
  "use strict";

  // Mark that scripts run, so entrance states only apply when they can finish.
  document.documentElement.classList.add("js");

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    // Entrances: reveal once, then retire stagger delays so hovers never lag.
    var targets = document.querySelectorAll(".reveal, .reveal-img");
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          el.classList.add("in");
          setTimeout(function () { el.classList.add("settled"); }, 1700);
          io.unobserve(el);
        });
      }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
      targets.forEach(function (el) { io.observe(el); });
    } else {
      targets.forEach(function (el) { el.classList.add("in", "settled"); });
    }

    // Header hairline once the page moves.
    var header = document.querySelector(".site-header");
    function onScroll() {
      if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();


    // Pause every loop on hidden tabs.
    document.addEventListener("visibilitychange", function () {
      document.body.classList.toggle("paused", document.hidden);
    });
  });
})();
