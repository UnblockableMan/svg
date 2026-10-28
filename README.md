# C3 single-file site

`index.svg` is the primary C3 site and `index.html` is its standalone HTML
backup. Both files contain the page markup, application code, styles, dark and light
themes, fonts, app icons, Lucide icons, HLS playback library, and the Velara-style
particle background. They do not embed the site in an iframe or load front-end
assets from another URL by default.

The Appearance settings let you combine or independently enable the blueprint
grid, drifting fog, aurora glow, and floating particles. The choices are saved
in the current browser.

## Rebuild the standalone files

With a local checkout of [UnblockableMan/canc3r](https://github.com/UnblockableMan/canc3r)
next to this repository:

```sh
node scripts/build-standalone.mjs ../canc3r
```

The build downloads pinned HLS.js 1.5.18, Lucide 0.468.0 icons, and particles.js
2.0.0, and includes their license notices in both generated files.

The C3 frontend is self-contained, but features that use live game listings,
game files, optional custom CSS, or configured manga, movie, and music services
still need network access and their respective remote services.

The Anime view searches the public AniList GraphQL API and links to the
streaming providers listed there. The Manga view uses the
[x8rr/manga](https://github.com/x8rr/manga) API; run that service and enter its
reachable, CORS-enabled base URL in **Settings → API connections**:

```sh
bun install
bun run start
```

The service defaults to `http://localhost:3000`. A static SVG cannot host the
manga API. Lyra is a web proxy, not a standalone anime API; C3 uses AniList for
catalog search and links out to the providers listed by AniList.

Game HTML is fetched from the configured catalog host and opened in a
sandboxed frame. The Browser view opens regular browser tabs; it does not
include a web proxy. After pushing changes to `main`, jsDelivr's `@main` SVG
will serve the updated file, and the `#home` fragment targets the landing page.

## Loading remote game and style files

Open **Settings → Remote files** to set a game catalog JSON URL, the base URL
for its game pages, and an optional CSS URL. The catalog should be a JSON array
of entries with a `name` and a `url`; `img` is optional. Relative `url` and
`img` paths resolve against the configured game files base URL. Game pages can
load their own JavaScript and other assets inside the game frame.

The catalog and custom CSS URLs must use HTTP or HTTPS. The catalog and game
HTML hosts must allow browser cross-origin requests (CORS). Game HTML is loaded
into a sandboxed frame so hosts that label `.html` files as plain text still
render them; game assets resolve against the configured base URL. The bundled
C3 app code is never replaced by remote JavaScript.

## jsDelivr

After this repository is pushed to GitHub, the SVG is available at:

`https://cdn.jsdelivr.net/gh/UnblockableMan/svg@latest/index.svg`

jsDelivr serves public GitHub files directly; no separate registration is
needed.
