/* M.E.E.T. Artists directory: public artists with combined filters for
   country, artistic discipline, and materials & techniques. The options come
   from the artists' own approved profiles and approved artworks. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC, esc = P.esc;
  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid"), empty = $("empty"), count = $("count");
  var sel = { country: $("f-country"), discipline: $("f-discipline"), material: $("f-material") };
  var LABEL_ALL = { country: "All countries", discipline: "All disciplines", material: "All materials and techniques" };
  var artists = [];

  function key(s) { return String(s || "").trim().toLowerCase(); }

  function readQuery() {
    var q = new URLSearchParams(location.search);
    return { country: q.get("country") || "", discipline: q.get("discipline") || "", material: q.get("material") || "" };
  }
  function writeQuery(f) {
    var q = new URLSearchParams();
    Object.keys(f).forEach(function (k) { if (f[k]) q.set(k, f[k]); });
    var s = q.toString();
    try { history.replaceState(null, "", location.pathname + (s ? "?" + s : "")); } catch (e) { /* ignore */ }
  }
  function current() { return { country: sel.country.value, discipline: sel.discipline.value, material: sel.material.value }; }

  function matches(a, f, skip) {
    if (skip !== "country" && f.country && key(a.country) !== key(f.country)) return false;
    if (skip !== "discipline" && f.discipline && a.facets.discipline.indexOf(key(f.discipline)) === -1) return false;
    if (skip !== "material" && f.material && a.facets.material.indexOf(key(f.material)) === -1) return false;
    return true;
  }

  // Each list offers only choices that still give results with the other two
  // filters, with how many artists each one has. A chosen value always stays.
  function fillOptions(f) {
    Object.keys(sel).forEach(function (name) {
      var counts = {}, labels = {};
      artists.forEach(function (a) {
        if (!matches(a, f, name)) return;
        var values = name === "country" ? (a.country ? [a.country] : []) : a.labels[name];
        values.forEach(function (v) { var k = key(v); counts[k] = (counts[k] || 0) + 1; labels[k] = labels[k] || v; });
      });
      if (f[name] && !counts[key(f[name])]) { counts[key(f[name])] = 0; labels[key(f[name])] = f[name]; }
      var keys = Object.keys(counts).sort(function (x, y) { return labels[x].localeCompare(labels[y]); });
      sel[name].innerHTML = '<option value="">' + esc(LABEL_ALL[name]) + "</option>" + keys.map(function (k) {
        return '<option value="' + esc(labels[k]) + '"' + (key(f[name]) === k ? " selected" : "") + ">" + esc(labels[k]) + " (" + counts[k] + ")</option>";
      }).join("");
      sel[name].disabled = !keys.length;
    });
  }

  function card(a) {
    var img = a.image
      ? '<img alt="" loading="lazy" decoding="async" data-path="' + esc(a.image) + '">'
      : '<span class="card-initial" aria-hidden="true">' + esc((a.display_name || "?").charAt(0)) + "</span>";
    var disc = [a.main_discipline].concat(P.terms(a.other_disciplines)).filter(Boolean).slice(0, 3).join(" · ");
    return '<a class="a-card" href="' + P.artistUrl(a.id) + '">' +
      '<span class="a-media">' + img + "</span>" +
      '<span class="a-name">' + esc(a.display_name) + "</span>" +
      (disc ? '<span class="a-disc">' + esc(disc) + "</span>" : "") +
      (P.place(a) ? '<span class="a-place">' + esc(P.place(a)) + "</span>" : "") +
      "</a>";
  }

  var urls = {};
  function render() {
    var f = current();
    writeQuery(f);
    fillOptions(f);
    var list = artists.filter(function (a) { return matches(a, f); });
    var filtered = !!(f.country || f.discipline || f.material);
    $("f-clear").hidden = !filtered;
    grid.removeAttribute("aria-busy");

    if (!artists.length) {
      grid.innerHTML = ""; grid.hidden = true; count.textContent = "";
      $("filters").hidden = true;
      empty.innerHTML = "<h2>The first artists are on their way</h2><p>M.E.E.T. artists appear here once the team has reviewed their profile. Please come back soon.</p>" +
        '<p><a class="text-link" href="/join">Are you an artist? Join M.E.E.T.</a></p>';
      empty.hidden = false;
      return;
    }
    if (!list.length) {
      grid.innerHTML = ""; grid.hidden = true;
      count.textContent = "No artists match these filters.";
      empty.innerHTML = "<h2>No artists match these filters</h2><p>Try removing one of the filters to see more artists.</p>" +
        '<p><button class="btn btn-small" type="button" data-clear>Clear filters</button></p>';
      empty.hidden = false;
      return;
    }
    empty.hidden = true; grid.hidden = false;
    count.textContent = list.length + (list.length === 1 ? " artist" : " artists") + (filtered ? (list.length === 1 ? " matches" : " match") + " your filters" : "");
    grid.innerHTML = list.map(card).join("");
    grid.querySelectorAll("img[data-path]").forEach(function (img) {
      var u = urls[img.getAttribute("data-path")];
      if (u) img.src = u; else img.closest(".a-media").classList.add("no-img");
    });
  }

  function clear() {
    Object.keys(sel).forEach(function (k) { sel[k].value = ""; });
    render();
    sel.country.focus();
  }
  Object.keys(sel).forEach(function (k) { sel[k].addEventListener("change", render); });
  $("f-clear").addEventListener("click", clear);
  empty.addEventListener("click", function (e) { if (e.target.closest("[data-clear]")) clear(); });
  $("filters").addEventListener("submit", function (e) { e.preventDefault(); });

  (async function load() {
    try {
      if (!P.sb) throw new Error("not connected");
      var ra = await P.sb.from("public_artists").select("*").order("display_name");
      if (ra.error) throw ra.error;
      var rw = await P.sb.from("public_artworks").select("artist_id, materials, images, approved_at").order("approved_at", { ascending: false });
      if (rw.error) throw rw.error;
      var works = {};
      (rw.data || []).forEach(function (w) { (works[w.artist_id] = works[w.artist_id] || []).push(w); });

      artists = (ra.data || []).map(function (a) {
        var mine = works[a.id] || [];
        var disciplines = P.terms([a.main_discipline, a.other_disciplines].join(","));
        var materials = P.terms([a.techniques].concat(mine.map(function (w) { return w.materials; })).join(","));
        var firstWork = mine.filter(function (w) { return (w.images || []).length; })[0];
        a.image = a.cover_path || (firstWork && firstWork.images[0]) || a.avatar_path || "";
        a.labels = { discipline: disciplines, material: materials };
        a.facets = { discipline: disciplines.map(key), material: materials.map(key) };
        return a;
      });
      urls = await P.signUrls(artists.map(function (a) { return a.image; }));

      var q = readQuery();
      fillOptions(q);
      Object.keys(sel).forEach(function (k) { sel[k].value = q[k] ? (Array.prototype.find.call(sel[k].options, function (o) { return key(o.value) === key(q[k]); }) || {}).value || "" : ""; });
      render();
    } catch (err) {
      console.error(err);
      grid.innerHTML = ""; grid.removeAttribute("aria-busy");
      $("filters").hidden = true;
      empty.innerHTML = "<h2>The artists could not be loaded</h2><p>Please check your connection and refresh the page.</p>";
      empty.hidden = false;
    }
  })();
})();
