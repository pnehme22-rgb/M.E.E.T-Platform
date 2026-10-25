/* M.E.E.T. public artist profile: portrait, biography and approach,
   disciplines, materials and techniques, every approved artwork, and two
   separate actions: an inquiry to the artist about a work or a commission
   (signed-in members), and interest in a collaboration, which goes to the
   M.E.E.T. team. Never shows the artist's contact details or links. */
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

  var TYPE = { personal: "Personal", professional: "Professional", business: "Business & Organization" };

  // Visitors browse freely; sending an inquiry needs a confirmed member account.
  async function inquiryForm(a, works) {
    var box = document.getElementById("inq-body");
    var here = location.pathname + location.search;
    var who = await P.member();
    if (!who.session) {
      box.innerHTML = "<p>To send an inquiry, please sign in to your M.E.E.T. account, so the artist knows who is writing. Creating an account is free.</p>" +
        '<p class="inq-act"><a class="btn btn-small" href="/signin?next=' + encodeURIComponent(here + "#inquire") + '">Sign in to inquire</a>' +
        '<a class="text-link" href="/signup?next=' + encodeURIComponent(here + "#inquire") + '">Create an account</a></p>';
      return;
    }
    if (!who.account) {
      box.innerHTML = "<p>Inquiries are sent from member accounts (Personal, Professional, or Business &amp; Organization). Artist and team accounts cannot send them.</p>";
      return;
    }
    var m = who.account;
    var pre = new URLSearchParams(location.search).get("artwork") || "";
    box.innerHTML =
      '<form class="inq-form" id="inq-form" novalidate>' +
      '<label class="flt"><span>What is your inquiry about?</span><select id="inq-topic" required>' +
        '<option value="">Choose one</option>' +
        (works.length ? '<option value="artwork">An artwork on M.E.E.T.</option>' : "") +
        '<option value="commission">A commission</option><option value="other">Something else</option></select></label>' +
      '<label class="flt" id="inq-work-row" hidden><span>Which artwork?</span><select id="inq-work">' +
        works.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.title || "Untitled") + "</option>"; }).join("") + "</select></label>" +
      '<label class="flt"><span>Your message</span><textarea id="inq-msg" rows="6" maxlength="2000" placeholder="Introduce yourself and tell the artist what you have in mind."></textarea>' +
        '<small class="inq-count" id="inq-count">At least 20 characters.</small></label>' +
      '<p class="inq-privacy">' + esc(a.display_name) + " will see your name (" + esc(m.full_name) + "), your account type (" + esc(TYPE[m.account_type]) + ") and your country (" + esc(m.country) + "), with your message. Your email address and phone number are not shared. We email you a copy.</p>" +
      '<p class="inq-err" id="inq-err" role="alert" hidden></p>' +
      '<p class="inq-act"><button class="btn btn-small" type="submit" id="inq-send">Send inquiry</button></p></form>';
    var topic = box.querySelector("#inq-topic"), row = box.querySelector("#inq-work-row"), msg = box.querySelector("#inq-msg");
    function sync() { row.hidden = topic.value !== "artwork"; }
    topic.addEventListener("change", sync);
    if (pre && works.some(function (w) { return w.id === pre; })) { topic.value = "artwork"; box.querySelector("#inq-work").value = pre; sync(); }
    msg.addEventListener("input", function () {
      var n = msg.value.trim().length;
      box.querySelector("#inq-count").textContent = n < 20 ? "At least 20 characters (" + n + " so far)." : n + " of 2,000 characters.";
    });
    box.querySelector("#inq-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var err = box.querySelector("#inq-err");
      var problem = !topic.value ? "Please choose what your inquiry is about." : msg.value.trim().length < 20 ? "Please write a message of at least 20 characters." : "";
      err.textContent = problem; err.hidden = !problem;
      if (problem) { (topic.value ? msg : topic).focus(); return; }
      var btn = box.querySelector("#inq-send");
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        await P.api("inquiry", { action: "create", artist_id: a.id, topic: topic.value, artwork_id: topic.value === "artwork" ? box.querySelector("#inq-work").value : null, message: msg.value });
        box.innerHTML = '<div class="inq-done" role="status" tabindex="-1"><h3>Your inquiry has been sent</h3><p>' + esc(a.display_name) +
          " receives it in their M.E.E.T. studio. We have emailed you a copy. When they reply, we will email you and the reply will appear in your account.</p>" +
          '<p><a class="text-link" href="/account#/inquiries">View my inquiries</a></p></div>';
        box.querySelector(".inq-done").focus();
      } catch (ex) {
        btn.disabled = false; btn.textContent = "Send inquiry";
        err.textContent = ex.message; err.hidden = false;
      }
    });
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
      var materials = P.terms(a.materials);
      var facts = [];
      if (disciplines.length) facts.push('<div class="fact"><h2>Disciplines</h2>' + chips(disciplines) + "</div>");
      if (materials.length) facts.push('<div class="fact"><h2>Materials</h2>' + chips(materials) + "</div>");
      if (techniques.length) facts.push('<div class="fact"><h2>' + (materials.length ? "Techniques" : "Materials &amp; techniques") + "</h2>" + chips(techniques) + "</div>");
      var collabHref = "/collaborate?artist=" + encodeURIComponent(a.id) + "#request";

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
          (P.place(a) ? '<p class="p-place">' + esc(P.place(a)) + "</p>" : "") +
          '<p class="p-actions"><a class="btn btn-small" href="#inquire">Inquire about a work or commission</a>' +
          '<a class="text-link" href="' + collabHref + '">Express interest in a collaboration</a></p></div>' +
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
        "</section>" +
        '<section class="inq" id="inquire" aria-labelledby="t-inq"><div class="inq-intro"><h2 id="t-inq" class="p-h">Inquire about this artist</h2>' +
        "<p>Write to " + esc(a.display_name) + " through M.E.E.T. about an artwork or a commission.</p>" +
        '<p class="collab-note"><b>Thinking of a collaboration?</b> To bring ' + esc(a.display_name) + " together with other artists, send your idea to the M.E.E.T. team. We contact the artists, check what is possible and come back to you with a proposal. " +
        '<a class="text-link" href="' + collabHref + '">Propose a collaboration</a></p></div>' +
        '<div class="inq-body" id="inq-body"><p class="muted-note">Loading…</p></div></section>';
      await inquiryForm(a, works);
      if (location.hash === "#inquire") document.getElementById("inquire").scrollIntoView();
    } catch (err) {
      console.error(err);
      view.removeAttribute("aria-busy");
      view.innerHTML = '<div class="dir-empty"><h1 class="h2">This profile could not be loaded</h1><p>Please check your connection and refresh the page.</p></div>';
    }
  })();
})();
