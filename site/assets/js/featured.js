/* Homepage selection: the artists and artworks the M.E.E.T. team chose to
   feature, in the team's order. Only public items can appear, and the whole
   section stays hidden while nothing is featured. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC;
  var section = document.getElementById("featured");
  if (!P || !P.sb || !section) return;
  var esc = P.esc;

  (async function load() {
    try {
      var ra = await P.sb.from("public_featured_artists").select("*").order("position");
      var rw = await P.sb.from("public_featured_artworks").select("id, artist_id, artist_name, title, year, materials, images, position").order("position");
      var artists = ra.error ? [] : ra.data || [];
      var works = rw.error ? [] : rw.data || [];
      if (!artists.length && !works.length) return;

      var urls = await P.signUrls(artists.map(function (a) { return a.cover_path || a.avatar_path; })
        .concat(works.map(function (w) { return (w.images || [])[0]; })));

      var html = "";
      if (artists.length) {
        html += '<div class="featured-row"><h3>Artists</h3><div class="dir-grid">' + artists.map(function (a) {
          var src = urls[a.cover_path || a.avatar_path];
          return '<a class="a-card" href="' + P.artistUrl(a.id) + '"><span class="a-media">' +
            (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : '<span class="card-initial" aria-hidden="true">' + esc((a.display_name || "?").charAt(0)) + "</span>") +
            '</span><span class="a-name">' + esc(a.display_name) + "</span>" +
            (a.main_discipline ? '<span class="a-disc">' + esc(a.main_discipline) + "</span>" : "") +
            (P.place(a) ? '<span class="a-place">' + esc(P.place(a)) + "</span>" : "") + "</a>";
        }).join("") + "</div></div>";
      }
      if (works.length) {
        html += '<div class="featured-row"><h3>Artworks</h3><div class="w-grid">' + works.map(function (w) {
          var src = urls[(w.images || [])[0]];
          return '<a class="w-card" href="' + P.artworkUrl(w.id) + '"><span class="w-media">' +
            (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async">' : "") + "</span>" +
            '<span class="w-title">' + esc(w.title || "Untitled") + "</span>" +
            '<span class="w-meta">' + esc(w.artist_name) + "</span></a>";
        }).join("") + "</div></div>";
      }
      document.getElementById("featured-list").innerHTML = html;
      section.hidden = false;
    } catch (err) {
      console.error(err);   // The homepage works without this section.
    }
  })();
})();
