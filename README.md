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

The embedded C3 app and its static assets are based on
[UnblockableMan/canc3r](https://github.com/UnblockableMan/canc3r). The original
SVG loader is based on [cherriunblocked/svg](https://github.com/cherriunblocked/svg).
This repository retains the upstream AGPL-3.0 license and attribution, including
credit to x8r and contributors for code originating from that project. See
[LICENSE](./LICENSE) for the license terms.