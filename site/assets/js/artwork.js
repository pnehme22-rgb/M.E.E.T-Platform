/* M.E.E.T. public artwork page: photographs, title, artist, description and
   the details the artist supplied. Only fields that exist are shown. There
   is no buying here. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC, esc = P.esc;
  var view = document.getElementById("view");

  function notFound() {
    document.title = "Artwork not found | M.E.E.T.";
    view.removeAttribute("aria-busy");
    view.innerHTML = '<div class="dir-empty"><h1 class="h2">This artwork is not available</h1>' +
      "<p>The link may be incomplete, or the artwork is not public at the moment.</p>" +
      '<p><a class="btn btn-small" href="/artists">See all artists</a></p></div>';
  }

  (async function load() {
    var id = P.idFromPath("artworks");
    if (!id || !P.sb) { notFound(); return; }
    try {
      var rw = await P.sb.from("public_artworks").select("*").eq("id", id).maybeSingle();
      if (rw.error) throw rw.error;
      if (!rw.data) { notFound(); return; }
      var w = rw.data;
      var ra = await P.sb.from("public_artists").select("id, display_name, main_discipline, city, country").eq("id", w.artist_id).maybeSingle();
      if (ra.error) throw ra.error;
      if (!ra.data) { notFound(); return; }
      var a = ra.data;
      var images = w.images || [];
      var urls = await P.signUrls(images);
      var shown = images.filter(function (p) { return urls[p]; });
      var title = w.title || "Untitled";

      document.title = title + " by " + a.display_name + " | M.E.E.T.";
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", title + " by " + a.display_name + (w.materials ? ". " + w.materials : "") + ". On M.E.E.T.");

      var details = [];
      function row(label, value) { if (value) details.push("<dt>" + esc(label) + "</dt><dd>" + esc(value) + "</dd>"); }
      row("Year", w.year);
      row("Materials", w.materials);
      row("Dimensions", P.dims(w));
      if (w.edition_type) row("Edition", w.edition_type === "Limited edition" && w.edition_size ? "Limited edition of " + w.edition_size : w.edition_type);

      view.removeAttribute("aria-busy");
      view.innerHTML =
        '<a class="nav-back crumb" href="' + P.artistUrl(a.id) + '"><svg aria-hidden="true"><use href="#arrow"/></svg>' + esc(a.display_name) + "</a>" +
        '<div class="wk">' +
          '<div class="wk-media">' +
            (shown.length
              ? '<figure class="wk-main"><img id="wk-img" src="' + esc(urls[shown[0]]) + '" alt="' + esc(title) + ", by " + esc(a.display_name) + '"></figure>' +
                (shown.length > 1 ? '<div class="wk-thumbs" role="group" aria-label="More photographs">' + shown.map(function (p, i) {
                  return '<button type="button" class="wk-thumb" data-src="' + esc(urls[p]) + '" aria-label="Photograph ' + (i + 1) + " of " + shown.length + '"' + (i === 0 ? ' aria-current="true"' : "") + '><img src="' + esc(urls[p]) + '" alt=""></button>';
                }).join("") + "</div>" : "")
              : '<div class="wk-main wk-none">No photograph</div>') +
          "</div>" +
          '<div class="wk-info">' +
            '<h1 class="wk-title">' + esc(title) + "</h1>" +
            '<p class="wk-by">by <a class="text-link" href="' + P.artistUrl(a.id) + '">' + esc(a.display_name) + "</a>" +
              (P.place(a) ? '<span class="wk-place">' + esc(P.place(a)) + "</span>" : "") + "</p>" +
            (details.length ? '<dl class="wk-details">' + details.join("") + "</dl>" : "") +
            (w.description ? '<div class="wk-desc">' + String(w.description).split(/\n{2,}/).map(function (p) { return "<p>" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>"; }).join("") + "</div>" : "") +
            '<p><a class="btn btn-small" href="' + P.artistUrl(a.id) + '">More from ' + esc(a.display_name) + "</a></p>" +
          "</div>" +
        "</div>";

      view.addEventListener("click", function (e) {
        var b = e.target.closest(".wk-thumb");
        if (!b) return;
        document.getElementById("wk-img").src = b.getAttribute("data-src");
        view.querySelectorAll(".wk-thumb").forEach(function (t) { t.removeAttribute("aria-current"); });
        b.setAttribute("aria-current", "true");
      });
    } catch (err) {
      console.error(err);
      view.removeAttribute("aria-busy");
      view.innerHTML = '<div class="dir-empty"><h1 class="h2">This artwork could not be loaded</h1><p>Please check your connection and refresh the page.</p></div>';
    }
  })();
})();
