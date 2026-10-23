# C3 single-file site

`index.svg` is the primary C3 site and `index.html` is its standalone HTML
backup. Both files contain the page markup, application code, styles, supported
themes, fonts, app icons, and HLS playback library. They do not embed the site
in an iframe or load front-end assets from another URL.

## Rebuild the standalone files

With a local checkout of [UnblockableMan/canc3r](https://github.com/UnblockableMan/canc3r)
next to this repository:

```sh
node scripts/build-standalone.mjs ../canc3r
```

The build downloads the pinned HLS.js 1.5.18 browser library and includes its
Apache-2.0 license text in both generated files.

The C3 frontend is self-contained, but features that use live game listings,
game files, or configured manga, movie, and music services still need network
access and their respective remote services.

## jsDelivr

After this repository is pushed to GitHub, the SVG is available at:

`https://cdn.jsdelivr.net/gh/UnblockableMan/svg@main/index.svg`

jsDelivr serves public GitHub files directly; no separate registration is
needed.
