/* The homepage's built-in content: the sections, their order, words and
   images used until the team publishes its own version from the console
   (Public website > Homepage). Shared by the homepage and the console editor.
   *words* in a title are set in italics. */
(function () {
  "use strict";
  function img(src, w) { return { src: "/assets/img/" + src + "-" + (w || 1200) + ".jpg" }; }
  window.MEET_HOME_DEFAULT = { sections: [
    { id: "hero", enabled: true, kicker: "Mind Exploring Every Tradition",
      title: "Bring any creative vision *closer to reality.*",
      text: "M.E.E.T. brings together artists of different practices, materials and traditions, and the people who want to work with them. Discover an artist, commission a piece, or start a project with the help of our team.",
      button: "Discover the artists", second: "Start a project",
      image: { src: img("clay-hands").src, alt: "Two hands covered in wet clay pinch and lift the rim of a pot as it turns on the wheel." } },
    { id: "artists", enabled: true, kicker: "For artists",
      title: "A place for your practice, *and what it could become.*",
      text: "Present your work in a reviewed profile where collectors, designers and organizations can find it. People can write to you about a piece or a commission, and the M.E.E.T. team can invite you into projects alongside artists from other disciplines.",
      button: "Join as an Artist",
      image: { src: img("loom").src, alt: "A carpet in progress on a loom: pale warp threads above a band of knotted blue, red and white pattern." } },
    { id: "images", enabled: true, images: [
      { src: img("baskets").src, alt: "Lidded baskets of coiled grass in bands of blue, orange, red and cream.", caption: "Coiled grass" },
      { src: img("clay-head").src, alt: "A clay portrait head in profile, its surface left rough with tool marks.", caption: "Modelled clay" },
      { src: img("street-mural").src, alt: "A large, colourful painted figure on a city wall.", caption: "Painted wall" } ] },
    { id: "ways", enabled: true, kicker: "Where to begin", title: "Three ways into *M.E.E.T.*", items: [
      { title: "Join as an Artist", text: "Present your practice to the people looking for it, and open the door to commissions and collaborations.", button: "For artists" },
      { title: "Discover & Commission", text: "Explore artists by discipline, material and place. Write to an artist directly, or send us an idea for a commission.", button: "Discover and commission" },
      { title: "Start a Project", text: "For interior designers, curators, businesses and organizations planning larger or more complex work.", button: "Start a project" } ] },
    { id: "collaboration", enabled: true, kicker: "Collaboration",
      title: "What becomes possible when *artistic worlds meet.*",
      text: "A weaver and a ceramicist. A calligrapher and a glassmaker. Choose the artists whose practices you would like to bring together and describe your idea. The M.E.E.T. team contacts them, checks what is possible, and comes back to you with a proposal.",
      button: "Propose a collaboration",
      image: { src: img("batik").src, alt: "A hand guides a small copper batik tool, drawing a line of wax onto white cotton." } },
    { id: "featured_artists", enabled: true, kicker: "From the community", title: "Artists to *discover*", title_one: "An artist to *discover*", count: 3, rotate: true },
    { id: "featured_artworks", enabled: true, kicker: "Selected works", title: "Works from the *community*", title_one: "A work from the *community*", count: 6, rotate: true },
    { id: "closing", enabled: true, kicker: "Have an idea?", title: "Start with what you are *imagining.*",
      text: "An early idea is a good place to begin. Tell us what you have in mind, and we will help you find the artists who could make it.",
      button: "Send a commission idea", second: "Start a project" }
  ] };

})();
