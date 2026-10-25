"""Shared header and footer for the public pages.

The public site is plain HTML with no build step, so the header and footer
are written into each page. Run this after changing them here:
    python3 tools/site_chrome.py
It replaces the <header class="site-header"> and <footer class="site-footer">
blocks of every page listed in PAGES, and makes sure pages.css is loaded.
"""
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"

# page file -> the main navigation link it belongs to ("" for none)
PAGES = {
    "index.html": "", "artists.html": "/artists", "artist.html": "/artists", "artwork.html": "/artists",
    "about.html": "/about", "for-artists.html": "", "discover.html": "/discover",
    "start-a-project.html": "/start-a-project", "collaborate.html": "/discover",
    "privacy.html": "", "artist-terms.html": "", "404.html": "",
}

NAV = [("/artists", "Artists"), ("/discover", "Discover &amp; Commission"), ("/start-a-project", "Start a Project"), ("/about", "About")]


def header(current: str) -> str:
    cur = ' aria-current="page"'
    links = "\n".join(
        f'        <li><a href="{href}"{cur if href == current else ""}>{label}</a></li>' for href, label in NAV)
    return f"""<header class="site-header" id="top">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="M.E.E.T. home">
      <svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg>
      <span class="brand-word">M.E.E.T.</span>
    </a>
    <nav class="nav" aria-label="Main">
      <ul class="nav-links" id="nav-menu">
{links}
        <li class="nav-m"><a href="/signin">Sign in</a></li>
        <li class="nav-m"><a href="/signup">Create an account</a></li>
        <li class="nav-m"><a href="/for-artists">Join as an Artist</a></li>
      </ul>
      <a class="nav-signin nav-d" href="/signin">Sign in</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-menu">Menu</button>
      <a class="btn btn-small btn-quiet" href="/for-artists"><span>Join<span class="btn-more"> as an Artist</span></span></a>
    </nav>
  </div>
</header>"""


FOOTER = """<footer class="site-footer">
  <div class="wrap grid footer-grid">
    <div class="footer-id">
      <a class="brand" href="/" aria-label="M.E.E.T. home">
        <svg class="brand-mark" aria-hidden="true"><use href="#mark"/></svg>
        <span class="brand-word">M.E.E.T.</span>
      </a>
      <p class="expansion">Mind Exploring Every Tradition</p>
      <p>An international platform where artistic practices, materials and traditions meet.</p>
    </div>
    <div class="footer-col">
      <h2>Explore</h2>
      <ul>
        <li><a href="/artists">Artists</a></li>
        <li><a href="/discover">Discover &amp; Commission</a></li>
        <li><a href="/collaborate">Propose a collaboration</a></li>
        <li><a href="/start-a-project">Start a Project</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h2>Join and sign in</h2>
      <ul>
        <li><a href="/for-artists">Join as an Artist</a></li>
        <li><a href="/signup">Create an account</a></li>
        <li><a href="/signin">Sign in</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h2>Information</h2>
      <ul>
        <li><a href="/privacy">Privacy notice</a></li>
        <li><a href="/artist-terms">Artist terms</a></li>
        <li><a href="mailto:minds.exploring.traditions@gmail.com">minds.exploring.traditions@gmail.com</a></li>
      </ul>
    </div>
    <div class="footer-base">
      <p>&copy; 2026 M.E.E.T.</p>
    </div>
  </div>
</footer>"""


def main() -> None:
    for name, current in PAGES.items():
        path = SITE / name
        if not path.exists():
            continue
        html = path.read_text(encoding="utf-8")
        html, n1 = re.subn(r'<header class="site-header"[^>]*>.*?</header>', header(current), html, count=1, flags=re.S)
        html, n2 = re.subn(r'<footer class="site-footer[^"]*">.*?</footer>', FOOTER, html, count=1, flags=re.S)
        if "/assets/css/pages.css" not in html:
            html = html.replace('<link rel="stylesheet" href="/assets/css/site.css">',
                                '<link rel="stylesheet" href="/assets/css/site.css">\n<link rel="stylesheet" href="/assets/css/pages.css">', 1)
        path.write_text(html, encoding="utf-8")
        print(f"{name}: header {'updated' if n1 else 'MISSING'}, footer {'updated' if n2 else 'MISSING'}")


if __name__ == "__main__":
    main()
