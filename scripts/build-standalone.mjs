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
html = html.replace(/<link id="theme-stylesheet"[^>]*>\s*/i, '');
html = html.replace(/<link rel="stylesheet" href="style\.css">\s*/i, `<style>\n${css}\n</style>\n`);
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
