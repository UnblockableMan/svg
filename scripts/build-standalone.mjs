import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.resolve(process.argv[2] ?? path.join(repositoryDirectory, '..', 'canc3r'));
const hlsVersion = '1.5.18';
const hlsBaseUrl = `https://cdn.jsdelivr.net/npm/hls.js@${hlsVersion}`;

function toDataUri(contents, mimeType) {
  return `data:${mimeType};base64,${contents.toString('base64')}`;
}

async function readAsset(filePath) {
  return readFile(path.join(sourceDirectory, filePath));
}

async function assetDataUri(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
  };
  const contents = await readAsset(filePath);
  const isValidImage = extension === '.png'
    ? contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === '.jpg' || extension === '.jpeg'
      ? contents.subarray(0, 2).equals(Buffer.from([255, 216]))
      : extension === '.webp'
        ? contents.subarray(0, 4).toString() === 'RIFF' && contents.subarray(8, 12).toString() === 'WEBP'
        : true;

  if (!isValidImage) {
    return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%23191420%22/%3E%3Cpath d=%22M16 19h32v8H16zm0 18h32v8H16z%22 fill=%22%23ff4fa3%22/%3E%3C/svg%3E';
  }

  return toDataUri(contents, mimeTypes[extension] ?? 'application/octet-stream');
}

async function inlineCssUrls(css, cssPath) {
  const urlPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
  const matches = [...css.matchAll(urlPattern)];
  let result = css;

  for (const match of matches) {
    const [wholeMatch, , url] = match;
    if (/^(?:data:|https?:|#)/i.test(url)) continue;

    const assetPath = path.resolve(path.dirname(cssPath), decodeURIComponent(url.split(/[?#]/, 1)[0]));
    const contents = await readFile(assetPath);
    const extension = path.extname(assetPath).toLowerCase();
    const mimeType = extension === '.otf'
      ? 'font/otf'
      : extension === '.ttf'
        ? 'font/ttf'
        : 'application/octet-stream';
    result = result.replace(wholeMatch, `url("${toDataUri(contents, mimeType)}")`);
  }

  return result;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function replaceExactlyOnce(source, before, after, label) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one ${label} marker, found ${occurrences}.`);
  }
  return source.replace(before, after);
}

function xmlSafeMarkup(html) {
  return html
    .replace(/<!doctype html>\s*/i, '')
    .replace('<html lang="en">', '<html xmlns="http://www.w3.org/1999/xhtml" lang="en">')
    .replace(/<(meta|link|img|input|source|br|hr)(\s[^>]*?)?>/gi, '<$1$2 />')
    .replace(/\b(data-close-dialog|controls|playsinline)\b(?!\s*=)/g, '$1=""')
    .replace(/<style>([\s\S]*?)<\/style>/gi, (_, content) => `<style><![CDATA[${content.replaceAll(']]>', ']]]]><![CDATA[>')}]]></style>`)
    .replace(/<script>([\s\S]*?)<\/script>/gi, (_, content) => `<script><![CDATA[${content.replaceAll(']]>', ']]]]><![CDATA[>')}]]></script>`)
    .replace(/[ \t]+$/gm, '');
}

const sourceHtml = await readFile(path.join(sourceDirectory, 'index.html'), 'utf8');
let appScript = await readFile(path.join(sourceDirectory, 'app.js'), 'utf8');
const baseCssPath = path.join(sourceDirectory, 'style.css');
const baseCss = await inlineCssUrls(await readFile(baseCssPath, 'utf8'), baseCssPath);
const effectsCss = (await readFile(path.join(sourceDirectory, 'assets/css/effects.css'), 'utf8')).replace(/[ \t]+$/gm, '');
const themeDirectory = path.join(sourceDirectory, 'assets/css/themes');
const supportedThemes = ['arctic', 'cyberpunk', 'forest', 'magenta', 'midnight', 'neon', 'ocean', 'sunset', 'void'];
const themeCss = await Promise.all(supportedThemes.map(async (theme) => {
  const css = (await readFile(path.join(themeDirectory, `${theme}.css`), 'utf8')).replace(/[ \t]+$/gm, '');
  return css.replaceAll(':root', `body[data-theme="${theme}"]`);
}));

const htmlMatch = sourceHtml.match(/<html lang="en">([\s\S]*?)<\/html>/i);
if (!htmlMatch) throw new Error('Could not find the C3 HTML document.');
let html = `<!doctype html>\n<html lang="en">${htmlMatch[1]}</html>`;
const iconUri = await assetDataUri('image.png');
const imageNames = [...new Set([...appScript.matchAll(/image: "([^"]+)"/g)].map((match) => match[1]))];
const appImages = Object.fromEntries(await Promise.all(imageNames.map(async (name) => [
  name,
  await assetDataUri(path.join('assets/img/apps', name)),
])));
const appImageLookup = `const APP_IMAGES = ${JSON.stringify(appImages)};\nfunction appImage(name) { return APP_IMAGES[name] || ""; }\n`;
appScript = replaceExactlyOnce(appScript, 'const APP_CATALOG = [', `${appImageLookup}const APP_CATALOG = [`, 'app image catalog');
const oldAppImageTemplate = 'src="assets/img/apps/${app.image}"';
const newAppImageTemplate = 'src="${appImage(app.image)}"';
if (appScript.split(oldAppImageTemplate).length - 1 !== 2) {
  throw new Error('Expected exactly two dynamic app image references.');
}
appScript = appScript.replaceAll(oldAppImageTemplate, newAppImageTemplate);

const oldThemeFunction = `function applyAppearance() {
  const themeStylesheet = document.querySelector("#theme-stylesheet");
  const selectedTheme = Object.hasOwn(THEMES, state.appearance.theme) ? state.appearance.theme : "c3";
  if (selectedTheme === "c3") {
    themeStylesheet.disabled = true;
  } else {
    themeStylesheet.href = \`assets/css/themes/\${selectedTheme}.css\`;
    themeStylesheet.disabled = false;
  }
  document.body.classList.toggle("fog-enabled", state.appearance.fog);
  document.body.classList.toggle("aurora-enabled", state.appearance.aurora);
  document.body.dataset.theme = selectedTheme;
}`;
const newThemeFunction = `function applyAppearance() {
  const selectedTheme = Object.hasOwn(THEMES, state.appearance.theme) ? state.appearance.theme : "c3";
  document.body.classList.toggle("fog-enabled", state.appearance.fog);
  document.body.classList.toggle("aurora-enabled", state.appearance.aurora);
  document.body.dataset.theme = selectedTheme;
}`;
appScript = replaceExactlyOnce(appScript, oldThemeFunction, newThemeFunction, 'theme switcher');
const oldHlsFunction = `function loadHls() {
  if (window.Hls) return Promise.resolve();
  if (state.hlsPromise) return state.hlsPromise;
  state.hlsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the HLS playback library."));
    document.head.append(script);
  });
  return state.hlsPromise;
}`;
appScript = replaceExactlyOnce(
  appScript,
  oldHlsFunction,
  `function loadHls() {
  if (window.Hls) return Promise.resolve();
  return Promise.reject(new Error("The bundled HLS playback library is unavailable."));
}`,
  'HLS loader',
);

const css = [baseCss, effectsCss, ...themeCss].join('\n');
const standaloneCss = `
:root {
  --content-width: 1320px;
  --radius: 16px;
  --app-background: #090b12;
  --panel: #10141f;
  --panel-raised: #151b29;
  --panel-hover: #1b2232;
  --line: #ffffff17;
  --white: #f4f5fb;
  --muted: #9299aa;
  --pink: #aebeff;
  --pink-light: #d4dcff;
}

html {
  background: #090b12;
  scrollbar-color: #343b4d #0b0d14;
}

body {
  background:
    radial-gradient(ellipse at 78% 0%, #7d71ff12, transparent 38%),
    radial-gradient(ellipse at 18% 90%, #ee83cf0a, transparent 42%),
    #090b12;
  color: #f4f5fb;
}

body::before {
  background-image:
    linear-gradient(#c4d0ff08 1px, transparent 1px),
    linear-gradient(90deg, #c4d0ff08 1px, transparent 1px);
  background-size: 48px 48px;
  opacity: .34;
}

.main-area {
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  column-gap: clamp(24px, 3.4vw, 48px);
  min-height: 100vh;
  padding: 24px clamp(20px, 3.2vw, 48px);
}

.topbar {
  position: sticky;
  top: 24px;
  grid-column: 1;
  grid-row: 1 / 3;
  display: flex;
  width: 244px;
  height: calc(100vh - 48px);
  flex-direction: column;
  align-items: stretch;
  gap: 20px;
  align-self: start;
  margin: 0;
  padding: 20px 14px 14px;
  border: 1px solid #bac8ff1a;
  border-radius: 20px;
  background:
    radial-gradient(ellipse at 0 0, #8698ff12, transparent 48%),
    linear-gradient(180deg, #111521f5, #0d1019f5);
  box-shadow: 0 24px 70px #0005, inset 0 1px #ffffff08;
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
}

.brand {
  min-height: 42px;
  gap: 12px;
  padding: 0 5px;
  font-size: 22px;
}

.brand-icon {
  width: 36px;
  height: 36px;
  border: 1px solid #ffffff1c;
  border-radius: 11px;
  box-shadow: 0 5px 18px #0005;
}

.brand-pink {
  color: #f19bd5;
}

.main-nav {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 7px 0;
}

.nav-item {
  min-height: 43px;
  justify-content: flex-start;
  gap: 13px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 12px;
  color: #a2a8b8;
  font-size: 12px;
  font-weight: 550;
  text-align: left;
}

.nav-item:hover {
  border-color: #ffffff0d;
  background: #ffffff08;
  color: #f4f5fb;
}

.nav-item.active {
  border-color: #c2caff26;
  background: linear-gradient(110deg, #91aaff, #eaa2d7);
  box-shadow: 0 7px 22px #9aa9ff25, inset 0 1px #ffffff60;
  color: #161625;
  font-weight: 700;
}

.nav-icon {
  width: 20px;
  font-size: 17px;
}

.top-actions {
  width: 100%;
  gap: 8px;
  margin-top: auto;
}

.global-search {
  width: auto;
  min-width: 0;
  height: 40px;
  flex: 1;
  border-color: #ffffff17;
  border-radius: 11px;
  background: #090c14;
}

.icon-button {
  width: 40px;
  height: 40px;
  border-color: #ffffff17;
  border-radius: 11px;
  background: #111521;
  color: #c8cee0;
}

.view-root {
  grid-column: 2;
  grid-row: 1;
  width: min(100%, var(--content-width));
  margin: 0 auto;
  padding: 8px 0 44px;
}

.footer {
  grid-column: 2;
  grid-row: 2;
  border-color: #ffffff12;
  color: #7c8395;
}

.hero {
  border-color: #b1baff2c;
  border-radius: 22px;
  background:
    radial-gradient(ellipse at 82% 8%, #a7b8ff22, transparent 35%),
    radial-gradient(ellipse at 72% 100%, #ed8fd41a, transparent 40%),
    linear-gradient(125deg, #171b2b, #10131d 65%);
  box-shadow: inset 0 1px #ffffff0c, 0 20px 65px #0004;
}

.hero::after {
  border-color: #d8c9ff20;
  box-shadow: 0 0 0 32px #d8c9ff09, 0 0 0 72px #d8c9ff06;
}

.eyebrow,
.text-button,
.footer b {
  color: #c0caff;
}

.hero h1 span {
  color: #f19bd5;
}

.button,
.search-form input,
.field input,
.field select,
.global-search,
.pill-tabs {
  border-color: #ffffff1a;
  border-radius: 11px;
}

.button {
  background: #171c29;
  color: #e9ebf5;
}

.button:hover {
  border-color: #aabaff66;
  background: #202638;
}

.button.primary {
  border-color: #b9bfff70;
  background: linear-gradient(110deg, #91aaff, #eaa2d7);
  box-shadow: 0 7px 22px #9aa9ff25;
  color: #171625;
}

.feature-card,
.settings-card,
.app-card,
.media-card,
.notice,
.extension-banner {
  border-color: #ffffff16;
  border-radius: 16px;
  background-color: #10141f;
  box-shadow: inset 0 1px #ffffff06;
}

.feature-card {
  background: linear-gradient(145deg, #151a28, #0f121b);
}

.feature-card:hover,
.app-card:hover {
  border-color: #aebcff55;
  background: linear-gradient(145deg, #1c2234, #111521);
  box-shadow: 0 14px 32px #0005, inset 0 1px #ffffff0a;
}

.feature-card .feature-icon,
.step-list b,
.toggle-row input:checked + .toggle-switch {
  border-color: #aebcff38;
  background: linear-gradient(135deg, #aebcff22, #ed9ed51b);
  color: #d6dcff;
}

.quick-app,
.media-art,
.empty-state,
.chapter-button {
  border-color: #ffffff16;
  background-color: #111521;
}

.quick-app:hover,
.chapter-button:hover {
  border-color: #aebcff55;
}

.pill-tab.active {
  background: #aebcff1c;
  color: #d8ddff;
}

.notice {
  border-color: #aebcff28;
  background: linear-gradient(105deg, #aebcff0b, #ed9ed508);
}

.notice .notice-mark,
.notice strong {
  color: #d6dcff;
}

.settings-card,
dialog {
  border-color: #ffffff1a;
  background: linear-gradient(150deg, #151a27, #10131c 76%);
}

.audio-dock,
.toast {
  border-color: #ffffff20;
  border-radius: 16px;
  background: #111521f5;
  box-shadow: 0 20px 60px #0007;
}

@media (max-width: 1020px) {
  .main-area {
    display: flex;
    min-height: 100vh;
    flex-direction: column;
    padding: 12px 20px 16px;
  }

  .topbar {
    position: sticky;
    z-index: 5;
    top: 10px;
    display: grid;
    width: auto;
    height: auto;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: 52px 43px;
    gap: 0 15px;
    margin: 0;
    padding: 0 12px 5px;
    border-radius: 16px;
  }

  .brand {
    grid-column: 1;
    grid-row: 1;
  }

  .main-nav {
    grid-column: 1 / -1;
    grid-row: 2;
    flex: none;
    flex-direction: row;
    justify-content: flex-start;
    gap: 5px;
    overflow-x: auto;
    overflow-y: hidden;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .nav-item {
    min-height: 35px;
    justify-content: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 10px;
  }

  .nav-icon {
    width: 16px;
    font-size: 15px;
  }

  .top-actions {
    grid-column: 3;
    grid-row: 1;
    width: auto;
    margin: 0;
  }

  .global-search {
    width: min(250px, 30vw);
  }

  .view-root {
    width: min(100%, var(--content-width));
    flex: 1;
    padding: 26px 0 40px;
  }

  .footer {
    min-height: 42px;
  }

  .audio-dock {
    right: 18px;
    left: 18px;
    width: auto;
  }
}

@media (max-width: 650px) {
  .main-area {
    padding: 8px 14px 12px;
  }

  .topbar {
    top: 6px;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 48px 41px;
    gap: 0 9px;
    padding: 0 9px 4px;
  }

  .brand {
    gap: 8px;
    font-size: 19px;
  }

  .brand-icon {
    width: 30px;
    height: 30px;
  }

  .top-actions {
    grid-column: 2;
  }

  .global-search {
    width: min(190px, 45vw);
    height: 36px;
    padding: 0 8px;
  }

  .global-search kbd {
    display: none;
  }

  .icon-button {
    width: 36px;
    height: 36px;
  }

  .main-nav {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .view-root {
    padding-top: 21px;
  }

  .hero {
    min-height: 230px;
    padding: 25px 21px;
  }

  .audio-dock {
    right: 9px;
    bottom: 9px;
    left: 9px;
    padding: 8px;
  }
}

@media (max-width: 380px) {
  .main-area {
    padding-right: 10px;
    padding-left: 10px;
  }

  .nav-item {
    padding: 0 8px;
    font-size: 9px;
  }
}
`;
const bundledCss = `${css}\n${standaloneCss}`;
html = html.replace(/<link id="theme-stylesheet"[^>]*>\s*/i, '');
html = html.replace(/<link rel="stylesheet" href="style\.css">\s*/i, `<style>\n${bundledCss}\n</style>\n`);
html = html.replace(/<link rel="stylesheet" href="assets\/css\/effects\.css">\s*/i, '');
html = html.replaceAll('image.png', iconUri);
const hlsResponse = await fetch(`${hlsBaseUrl}/dist/hls.min.js`);
if (!hlsResponse.ok) {
  throw new Error(`Unable to download HLS.js: HTTP ${hlsResponse.status}`);
}
const hlsScript = (await hlsResponse.text()).replace(/^\/\/# sourceMappingURL=.*$/m, '');
const hlsLicense = await fetchText(`${hlsBaseUrl}/LICENSE`);
const runtimeScript = `/* HLS.js ${hlsVersion}, Apache-2.0 license:\n${hlsLicense.replaceAll('*/', '* /')}\n*/\n${hlsScript}\n${appScript}`;
if (/<\/script/i.test(runtimeScript)) {
  throw new Error('Runtime source contains a closing script tag and cannot be safely inlined.');
}
html = html.replace(/<script src="app\.js" defer><\/script>/i, '');
html = html.replace('</body>', `<script>\n${runtimeScript}\n</script>\n</body>`).replace(/[ \t]+$/gm, '');

const svgHtml = xmlSafeMarkup(html);
const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">\n  <foreignObject width="100%" height="100%">\n${svgHtml}\n  </foreignObject>\n</svg>\n`;

await Promise.all([
  writeFile(path.join(repositoryDirectory, 'index.html'), html),
  writeFile(path.join(repositoryDirectory, 'index.svg'), svg),
]);

const htmlBytes = Buffer.byteLength(html);
const svgBytes = Buffer.byteLength(svg);
console.log(`Built standalone C3 HTML (${htmlBytes.toLocaleString()} bytes) and SVG (${svgBytes.toLocaleString()} bytes).`);
console.log('The interface assets are embedded; game listings and configured media backends still need network access.');
