# Solum

Solum is a React host for the C3 games, apps, movies, and browser hub. The app
assets are served locally from this repository and use the supplied `image.png`
for the site icon and wordmark.

## Run locally

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## CDN

The SVG wrapper displays the live C3 site published from
[UnblockableMan/canc3r](https://github.com/UnblockableMan/canc3r). Once this
repository is pushed to GitHub, it will be available through jsDelivr at:

`https://cdn.jsdelivr.net/gh/UnblockableMan/svg@main/index.svg`

jsDelivr serves public GitHub files directly, so no separate registration is
needed.

This repository retains the upstream AGPL-3.0 license and attribution, including
credit to x8r and contributors for code originating from that project. See
[LICENSE](./LICENSE) for the license terms.