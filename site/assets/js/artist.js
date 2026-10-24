/* M.E.E.T. public artist profile: portrait, biography and approach,
   disciplines, materials and techniques, cultural traditions, and the
   artist's approved artworks. Never shows contact details or links. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC, esc = P.esc;
  var view = document.getElementById("view");

  function notFound() {
    document.title = "Artist not found | M.E.E.T.";
    view.removeAttribute("aria-busy");
    view.innerHTML = '<div class="dir-empty"><h1 class="h2">This artist profile is not available</h1>' +
      "<p>The link may be incomplete, or the profile is not public at the moment.</p>" +
      '<p><a class="btn btn-small" href="/artists">See all artists</a></p></div>';
  }

  function paras(text) {
    return String(text || "").split(/\n{2,}|\r\n\r\n/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function chips(list) {
    return '<ul class="chips">' + list.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
  }

  (async function load() {
    var id = P.idFromPath("artists");
    if (!id || !P.sb) { notFound(); return; }
    try {
      var ra = await P.sb.from("public_artists").select("*").eq("id", id).maybeSingle();
      if (ra.error) throw ra.error;
      if (!ra.data) { notFound(); return; }
      var a = ra.data;
      var rw = await P.sb.from("public_artworks").select("id, title, year, materials, images, approved_at").eq("artist_id", id).order("approved_at", { ascending: false });
      if (rw.error) throw rw.error;
      var works = rw.data || [];
      var urls = await P.signUrls([a.avatar_path, a.cover_path].concat(works.map(function (w) { return (w.images || [])[0]; })));

      document.title = a.display_name + " | M.E.E.T.";
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", [a.display_name, a.main_discipline, P.place(a)].filter(Boolean).join(" · ") + ". An artist on M.E.E.T.");

      var disciplines = P.terms([a.main_discipline, a.other_disciplines].join(","));
      var techniques = P.terms(a.techniques);
      var facts = [];
      if (disciplines.length) facts.push('<div class="fact"><h2>Disciplines</h2>' + chips(disciplines) + "</div>");
      if (techniques.length) facts.push('<div class="fact"><h2>Materials &amp; techniques</h2>' + chips(techniques) + "</div>");
      if ((a.traditions || "").trim()) facts.push('<div class="fact"><h2>Cultural traditions</h2><p>' + esc(a.traditions) + "</p></div>");

      view.removeAttribute("aria-busy");
      view.innerHTML =
        '<a class="nav-back crumb" href="/artists"><svg aria-hidden="true"><use href="#arrow"/></svg>All artists</a>' +
        (urls[a.cover_path] ? '<figure class="p-cover"><img src="' + esc(urls[a.cover_path]) + '" alt=""></figure>' : "") +
        '<header class="p-head' + (urls[a.cover_path] ? " over" : "") + '">' +
          (urls[a.avatar_path]
            ? '<img class="p-portrait" src="' + esc(urls[a.avatar_path]) + '" alt="Portrait of ' + esc(a.display_name) + '">'
            : '<span class="p-portrait p-initial" aria-hidden="true">' + esc((a.display_name || "?").charAt(0)) + "</span>") +
          '<div><p class="kicker">' + esc(a.main_discipline || "Artist") + "</p>" +
          '<h1 class="p-name">' + esc(a.display_name) + "</h1>" +
          (P.place(a) ? '<p class="p-place">' + esc(P.place(a)) + "</p>" : "") + "</div>" +
        "</header>" +
        '<div class="p-body">' +
          (a.bio ? '<section class="p-bio" aria-labelledby="t-bio"><h2 id="t-bio" class="p-h">Biography and approach</h2>' + paras(a.bio) + "</section>" : "") +
          (facts.length ? '<aside class="p-facts" aria-label="About this artist\'s practice">' + facts.join("") + "</aside>" : "") +
        "</div>" +
        '<section class="p-works" aria-labelledby="t-works"><h2 id="t-works" class="p-h">Works</h2>' +
          (works.length
            ? '<div class="w-grid">' + works.map(function (w) {
                var src = urls[(w.images || [])[0]];
                return '<a class="w-card" href="' + P.artworkUrl(w.id) + '">' +
                  '<span class="w-media">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : "") + "</span>" +
                  '<span class="w-title">' + esc(w.title || "Untitled") + "</span>" +
                  '<span class="w-meta">' + esc([w.materials, w.year].filter(Boolean).join(", ")) + "</span></a>";
              }).join("") + "</div>"
            : '<p class="muted-note">' + esc(a.display_name) + " has no artworks on M.E.E.T. yet.</p>") +
        "</section>";
    } catch (err) {
      console.error(err);
      view.removeAttribute("aria-busy");
      view.innerHTML = '<div class="dir-empty"><h1 class="h2">This profile could not be loaded</h1><p>Please check your connection and refresh the page.</p></div>';
    }
  })();
})();
