/* M.E.E.T. Artists directory: public artists in the order the M.E.E.T. team
   curates (artists without a place follow, by name), with a text search and
   combined filters for region, country, discipline, materials and techniques.
   The filters sit in a panel opened by the Filters button (from the right on
   wider screens, from the bottom on phones).
   Every option comes from the artists' own approved profiles and approved
   artworks, and an artist working across several appears under each. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC, esc = P.esc;
  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid"), empty = $("empty"), count = $("count"), search = $("f-q");
  var FACETS = ["region", "country", "discipline", "material", "technique"];
  var sel = {};
  FACETS.forEach(function (k) { sel[k] = $("f-" + k); });
  var LABEL_ALL = { region: "All regions", country: "All countries", discipline: "All disciplines", material: "All materials", technique: "All techniques" };
  var artists = [];

  function key(s) { return String(s || "").trim().toLowerCase(); }

  function readQuery() {
    var q = new URLSearchParams(location.search), f = { q: q.get("q") || "" };
    FACETS.forEach(function (k) { f[k] = q.get(k) || ""; });
    return f;
  }
  function writeQuery(f) {
    var q = new URLSearchParams();
    Object.keys(f).forEach(function (k) { if (f[k]) q.set(k, f[k]); });
    var s = q.toString();
    try { history.replaceState(null, "", location.pathname + (s ? "?" + s : "")); } catch (e) { /* ignore */ }
  }
  function current() {
    var f = { q: search.value.trim() };
    FACETS.forEach(function (k) { f[k] = sel[k].value; });
    return f;
  }

  function matches(a, f, skip) {
    for (var i = 0; i < FACETS.length; i++) {
      var k = FACETS[i];
      if (skip !== k && f[k] && a.facets[k].indexOf(key(f[k])) === -1) return false;
    }
    if (f.q) {
      var words = key(f.q).split(/\s+/);
      if (!words.every(function (w) { return a.text.indexOf(w) !== -1; })) return false;
    }
    return true;
  }

  // Each list offers only choices that still give results with the other
  // filters, with how many artists each one has. A chosen value always stays.
  function fillOptions(f) {
    FACETS.forEach(function (name) {
      var counts = {}, labels = {};
      artists.forEach(function (a) {
        if (!matches(a, f, name)) return;
        a.labels[name].forEach(function (v) { var k = key(v); counts[k] = (counts[k] || 0) + 1; labels[k] = labels[k] || v; });
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
    var disc = a.labels.discipline.slice(0, 3).join(" · ");
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
    var filtered = !!(f.q || FACETS.some(function (k) { return f[k]; }));
    var nF = FACETS.filter(function (k) { return f[k]; }).length;
    $("f-clear").hidden = !nF;
    $("f-n").textContent = nF; $("f-n").hidden = !nF;
    $("f-open").setAttribute("aria-label", nF ? "Filters, " + nF + " active" : "Filters");
    grid.removeAttribute("aria-busy");

    if (!artists.length) {
      grid.innerHTML = ""; grid.hidden = true; count.textContent = "";
      $("filters").hidden = true;
      empty.innerHTML = "<h2>The first artists are on their way</h2><p>M.E.E.T. artists appear here once the team has reviewed their profile. Please come back soon.</p>" +
        '<p><a class="text-link" href="/for-artists">Are you an artist? Join M.E.E.T.</a></p>';
      empty.hidden = false;
      return;
    }
    if (!list.length) {
      $("f-show").textContent = "Show results";
      grid.innerHTML = ""; grid.hidden = true;
      count.textContent = "No artists match your search.";
      empty.innerHTML = "<h2>No artists match your search</h2><p>Try fewer words, or remove one of the filters.</p>" +
        '<p><button class="btn btn-small" type="button" data-clear>Clear search and filters</button></p>' +
        '<p class="muted-note">Looking for something specific? <a class="text-link" href="/discover#commission">Send us your idea</a> and the M.E.E.T. team will help.</p>';
      empty.hidden = false;
      return;
    }
    empty.hidden = true; grid.hidden = false;
    count.textContent = list.length + (list.length === 1 ? " artist" : " artists") + (filtered ? (list.length === 1 ? " matches" : " match") + " your search" : "");
    $("f-show").textContent = "Show " + list.length + (list.length === 1 ? " artist" : " artists");
    grid.innerHTML = list.map(card).join("");
    grid.querySelectorAll("img[data-path]").forEach(function (img) {
      var u = urls[img.getAttribute("data-path")];
      if (u) img.src = u; else img.closest(".a-media").classList.add("no-img");
    });
  }

  function clear() {
    search.value = "";
    FACETS.forEach(function (k) { sel[k].value = ""; });
    render();
    if (panel.hidden) search.focus();
  }

  // The filter panel: opens from the Filters button, closes with ×, Show,
  // a click outside it, or Escape. Results update while it is open.
  var panel = $("f-panel"), scrim = $("f-scrim"), opener = $("f-open");
  function openPanel() {
    panel.hidden = false; scrim.hidden = false; opener.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    $("f-panel-h").focus();
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true; scrim.hidden = true; opener.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    opener.focus();
  }
  opener.addEventListener("click", openPanel);
  $("f-close").addEventListener("click", closePanel);
  $("f-show").addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });
  FACETS.forEach(function (k) { sel[k].addEventListener("change", render); });
  var timer;
  search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 200); });
  $("f-clear").addEventListener("click", function () { FACETS.forEach(function (k) { sel[k].value = ""; }); render(); });
  empty.addEventListener("click", function (e) { if (e.target.closest("[data-clear]")) clear(); });
  $("filters").addEventListener("submit", function (e) { e.preventDefault(); render(); });

  (async function load() {
    try {
      if (!P.sb) throw new Error("not connected");
      var ra = await P.sb.from("public_artists").select("*").order("display_name");
      if (ra.error) throw ra.error;
      var rw = await P.sb.from("public_artworks").select("artist_id, title, materials, images, approved_at").order("approved_at", { ascending: false });
      if (rw.error) throw rw.error;
      var works = {};
      (rw.data || []).forEach(function (w) { (works[w.artist_id] = works[w.artist_id] || []).push(w); });

      // The team's order first; the rest by name.
      var rows = (ra.data || []).sort(function (a, b) {
        var x = a.directory_rank == null ? Infinity : a.directory_rank, y = b.directory_rank == null ? Infinity : b.directory_rank;
        return x !== y ? (x < y ? -1 : 1) : String(a.display_name).localeCompare(b.display_name);
      });
      artists = rows.map(function (a) {
        var mine = works[a.id] || [];
        var disciplines = P.terms([a.main_discipline, a.other_disciplines].join(","));
        var materials = P.terms([a.materials].concat(mine.map(function (w) { return w.materials; })).join(","));
        var techniques = P.terms(a.techniques);
        var region = P.region(a.country);
        var firstWork = mine.filter(function (w) { return (w.images || []).length; })[0];
        a.image = a.cover_path || (firstWork && firstWork.images[0]) || a.avatar_path || "";
        a.labels = { region: region ? [region] : [], country: a.country ? [a.country] : [], discipline: disciplines, material: materials, technique: techniques };
        a.facets = {};
        FACETS.forEach(function (k) { a.facets[k] = a.labels[k].map(key); });
        a.text = key([a.display_name, a.city, a.country, region, a.bio].concat(disciplines, materials, techniques, mine.map(function (w) { return w.title; })).join(" "));
        return a;
      });
      urls = await P.signUrls(artists.map(function (a) { return a.image; }));

      var q = readQuery();
      search.value = q.q;
      fillOptions(q);
      FACETS.forEach(function (k) { sel[k].value = q[k] ? (Array.prototype.find.call(sel[k].options, function (o) { return key(o.value) === key(q[k]); }) || {}).value || "" : ""; });
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
