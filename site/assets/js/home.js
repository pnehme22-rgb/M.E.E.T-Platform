/* M.E.E.T. homepage. The page is drawn from content the team manages in the
   console (Homepage): which sections are shown, in which order, their text and
   images. Visitors always see the published version; a signed-in team member
   can open /?preview=draft to see the unpublished draft. The featured sections
   show only approved artists and artworks the team made eligible: pinned items
   first, then the others in a rotation that changes each day. A section with
   nothing suitable to show is left out. */
(function () {
  "use strict";
  var P = window.MEET_PUBLIC;
  var main = document.getElementById("main");
  if (!main) return;
  var esc = P ? P.esc : function (s) { return String(s == null ? "" : s); };

  var ARROW = '<svg class="arrow" aria-hidden="true"><use href="#arrow"/></svg>';
  var SMALL_ARROW = '<svg aria-hidden="true" viewBox="0 0 22 10"><path d="M0 5h20M16 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

  // The links of each section are fixed: the team edits words and pictures, not addresses.
  var LINKS = {
    hero: "/artists", hero_second: "/start-a-project", artists: "/for-artists",
    ways: ["/for-artists", "/discover", "/start-a-project"],
    collaboration: "/collaborate", featured_artists: "/artists", featured_artworks: "/artists",
    closing: "/discover#commission", closing_second: "/start-a-project"
  };

  var DEFAULT = window.MEET_HOME_DEFAULT;

  // *words* become the italic accent. Everything else is plain text.
  function rich(s) { return esc(s).replace(/\*([^*]+)\*/g, "<em>$1</em>"); }
  function paras(s) { return String(s || "").split(/\n{2,}/).filter(Boolean).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join(""); }
  // Only our own images and the homepage image store can be shown.
  function safeSrc(src) {
    src = String(src || "");
    if (/^\/assets\/img\/[\w\-\/.]+$/.test(src)) return src;
    var base = ((window.MEET_CONFIG || {}).supabaseUrl || "").replace(/\/$/, "");
    if (base && src.indexOf(base + "/storage/v1/object/public/site-media/") === 0 && !/["'<>\s]/.test(src)) return src;
    return "";
  }
  function srcset(src) {
    var m = /^\/assets\/img\/([\w-]+)-(720|1200|1800)\.jpg$/.exec(src);
    return m ? ' srcset="/assets/img/' + m[1] + "-720.jpg 720w, /assets/img/" + m[1] + "-1200.jpg 1200w, /assets/img/" + m[1] + '-1800.jpg 1800w"' : "";
  }
  function picture(im, sizes, eager) {
    var src = im && safeSrc(im.src);
    if (!src) return "";
    return '<div class="frame"><img src="' + esc(src) + '"' + srcset(src) + ' sizes="' + sizes + '" alt="' + esc(im.alt || "") + '"' +
      (eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"') + "></div>";
  }
  function kicker(s) { return s ? '<p class="kicker">' + esc(s) + "</p>" : ""; }

  var RENDER = {
    hero: function (s) {
      return '<section class="hero home-hero" aria-labelledby="hero-title"><div class="wrap grid hero-grid"><div class="hero-copy">' +
        kicker(s.kicker) + '<h1 class="display hero-title" id="hero-title">' + rich(s.title) + "</h1>" +
        '<div class="hero-after"><p class="lede hero-lede">' + esc(s.text) + '</p><div class="hero-actions">' +
        '<a class="btn" href="' + LINKS.hero + '">' + esc(s.button) + ARROW + "</a>" +
        (s.second ? '<a class="text-link" href="' + LINKS.hero_second + '">' + esc(s.second) + "</a>" : "") + "</div></div></div>" +
        (safeSrc(s.image && s.image.src) ? '<figure class="hero-figure">' + picture(s.image, "(max-width: 960px) 100vw, 50vw", true) + "</figure>" : "") +
        "</div></section>";
    },
    artists: function (s) { return split(s, "artists-title", LINKS.artists, false); },
    collaboration: function (s) { return split(s, "collab-title", LINKS.collaboration, true); },
    images: function (s) {
      var list = (s.images || []).filter(function (im) { return safeSrc(im.src); }).slice(0, 3);
      if (!list.length) return "";
      return '<section class="band" aria-label="Artworks and practices"><div class="wrap"><div class="band-grid n' + list.length + '">' +
        list.map(function (im) {
          return '<figure class="reveal-img">' + picture(im, "(max-width: 760px) 100vw, 40vw") + (im.caption ? "<figcaption>" + esc(im.caption) + "</figcaption>" : "") + "</figure>";
        }).join("") + "</div></div></section>";
    },
    ways: function (s) {
      return '<section class="ways" aria-labelledby="ways-title"><div class="wrap"><div class="ways-head reveal">' + kicker(s.kicker) +
        '<h2 class="h2" id="ways-title">' + rich(s.title) + '</h2></div><ul class="ways-list">' +
        (s.items || []).slice(0, 3).map(function (it, i) {
          return '<li class="reveal"><a class="way" href="' + LINKS.ways[i] + '"><span class="num">0' + (i + 1) + "</span><h3>" + esc(it.title) + "</h3><p>" + esc(it.text) + '</p><span class="go">' + esc(it.button) + SMALL_ARROW + "</span></a></li>";
        }).join("") + "</ul></div></section>";
    },
    featured_artists: function (s, data) { return featured(s, data.artists, "artist"); },
    featured_artworks: function (s, data) { return featured(s, data.works, "artwork"); },
    closing: function (s) {
      return '<section class="closing on-navy home-close" aria-labelledby="closing-title"><div class="wrap grid closing-grid"><div class="closing-copy reveal">' +
        kicker(s.kicker) + '<h2 class="closing-title" id="closing-title">' + rich(s.title) + '</h2><div class="body-copy">' + paras(s.text) + "</div>" +
        '<div class="actions"><a class="btn" href="' + LINKS.closing + '">' + esc(s.button) + ARROW + "</a>" +
        (s.second ? '<a class="text-link" href="' + LINKS.closing_second + '">' + esc(s.second) + "</a>" : "") + "</div></div></div></section>";
    }
  };

  function split(s, id, href, flip) {
    var fig = safeSrc(s.image && s.image.src) ? '<figure class="split-figure reveal-img">' + picture(s.image, "(max-width: 960px) 100vw, 50vw") + "</figure>" : "";
    return '<section class="split' + (flip ? " flip" : "") + '" aria-labelledby="' + id + '"><div class="wrap grid split-grid"><div class="split-copy reveal">' +
      kicker(s.kicker) + '<h2 class="h2" id="' + id + '">' + rich(s.title) + '</h2><div class="body-copy">' + paras(s.text) + "</div>" +
      (s.button ? '<a class="btn" href="' + href + '">' + esc(s.button) + ARROW + "</a>" : "") + "</div>" + fig + "</div></section>";
  }

  function featured(s, items, kind) {
    if (!items || !items.length) return "";
    var title = items.length === 1 && s.title_one ? s.title_one : s.title;
    var cards = items.map(function (x) {
      if (kind === "artist") {
        return '<a class="a-card" href="' + P.artistUrl(x.id) + '"><span class="a-media">' +
          (x.src ? '<img src="' + esc(x.src) + '" alt="" loading="lazy" decoding="async">' : '<span class="card-initial" aria-hidden="true">' + esc((x.display_name || "?").charAt(0)) + "</span>") +
          '</span><span class="a-name">' + esc(x.display_name) + "</span>" +
          (x.main_discipline ? '<span class="a-disc">' + esc(x.main_discipline) + "</span>" : "") +
          (P.place(x) ? '<span class="a-place">' + esc(P.place(x)) + "</span>" : "") + "</a>";
      }
      return '<a class="a-card" href="' + P.artworkUrl(x.id) + '"><span class="a-media">' +
        (x.src ? '<img src="' + esc(x.src) + '" alt="" loading="lazy" decoding="async">' : "") + "</span>" +
        '<span class="a-name">' + esc(x.title || "Untitled") + '</span><span class="a-disc">' + esc(x.artist_name) + "</span></a>";
    });
    var id = "feat-" + kind;
    return '<section class="home-feature" aria-labelledby="' + id + '"><div class="wrap"><div class="featured-head reveal"><h2 class="h2" id="' + id + '">' +
      (s.kicker ? '<span class="kicker">' + esc(s.kicker) + "</span>" : "") + rich(title) + "</h2>" +
      '<a class="btn btn-small" href="' + LINKS["featured_" + kind + "s"] + '">See all artists</a></div>' +
      '<div class="feat-grid' + (items.length === 1 ? " solo" : "") + '">' + cards.join("") + "</div></div></section>";
  }

  // Pinned items in the team's order, then the others: rotated by the day when
  // rotation is on, in the team's order when it is off.
  function choose(list, count, rotate) {
    var pinned = list.filter(function (x) { return x.pinned; });
    var rest = list.filter(function (x) { return !x.pinned; });
    if (rotate && rest.length > 1) {
      var shift = Math.floor(Date.now() / 86400000) % rest.length;
      rest = rest.slice(shift).concat(rest.slice(0, shift));
    }
    return pinned.concat(rest).slice(0, Math.max(1, Math.min(12, count || 3)));
  }

  async function featuredData(content) {
    var out = { artists: [], works: [] };
    var sa = sectionOf(content, "featured_artists"), sw = sectionOf(content, "featured_artworks");
    if (!P || !P.sb || (!(sa && sa.enabled) && !(sw && sw.enabled))) return out;
    var ra = await P.sb.from("public_featured_artists").select("*").order("position");
    var rw = await P.sb.from("public_featured_artworks").select("id, artist_id, artist_name, title, images, position, pinned").order("position");
    var artists = choose(ra.error ? [] : ra.data || [], sa && sa.count, sa && sa.rotate);
    var works = choose(rw.error ? [] : rw.data || [], sw && sw.count, sw && sw.rotate);
    var urls = await P.signUrls(artists.map(function (a) { return a.cover_path || a.avatar_path; }).concat(works.map(function (w) { return (w.images || [])[0]; })));
    artists.forEach(function (a) { a.src = urls[a.cover_path || a.avatar_path] || ""; });
    works.forEach(function (w) { w.src = urls[(w.images || [])[0]] || ""; });
    out.artists = (sa && sa.enabled) ? artists : [];
    out.works = (sw && sw.enabled) ? works : [];
    return out;
  }

  function sectionOf(content, id) { return (content.sections || []).filter(function (s) { return s.id === id; })[0]; }

  // Merge saved content over the defaults, so a section added later still has its words.
  function normalise(content) {
    if (!content || !Array.isArray(content.sections)) return DEFAULT;
    var known = {};
    DEFAULT.sections.forEach(function (d) { known[d.id] = d; });
    var seen = {};
    var list = content.sections.filter(function (s) { return s && known[s.id] && !seen[s.id] && (seen[s.id] = true); })
      .map(function (s) { return Object.assign({}, known[s.id], s); });
    DEFAULT.sections.forEach(function (d) { if (!seen[d.id]) list.push(Object.assign({}, d, { enabled: false })); });
    return { sections: list };
  }

  async function render(content, banner) {
    content = normalise(content);
    var data = await featuredData(content).catch(function (e) { console.error(e); return { artists: [], works: [] }; });
    var html = content.sections.filter(function (s) { return s.enabled !== false && RENDER[s.id]; })
      .map(function (s) { try { return RENDER[s.id](s, data); } catch (e) { console.error(e); return ""; } }).join("");
    main.innerHTML = (banner || "") + html;
    if (window.MEET_REVEAL) window.MEET_REVEAL(main);
  }

  async function load() {
    try {
      var preview = new URLSearchParams(location.search).get("preview") === "draft";
      if (preview && P && P.sb) {
        var me = await P.sb.auth.getSession();
        if (me.data.session) {
          var d = await P.sb.from("site_pages").select("draft").eq("key", "home").maybeSingle();
          if (d.data && d.data.draft && Array.isArray(d.data.draft.sections)) {
            await render(d.data.draft, '<div class="preview-bar" role="status">Preview of the unpublished draft. Visitors still see the published homepage. <a href="/team#/homepage">Back to the editor</a></div>');
            return;
          }
        }
      }
      var r = P && P.sb ? await P.sb.from("public_site_pages").select("content").eq("key", "home").maybeSingle() : { data: null };
      await render(r.data && r.data.content ? r.data.content : DEFAULT);
    } catch (err) {
      console.error(err);   // The page keeps its built-in content.
    } finally {
      document.documentElement.classList.remove("home-wait");
    }
  }

  load();
})();
