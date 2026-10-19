import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist');
const excluded = new Set([
  '.github',
  '.git',
  'c3.html',
  'dist',
  'index.html',
  'index.svg',
  'logo.svg',
  'node_modules',
  'package-lock.json',
  'package.json',
  'public',
  'README.md',
  'scripts',
  'src',
  'vite.config.js',
]);

mkdirSync(output, { recursive: true });

for (const name of readdirSync(root)) {
  if (excluded.has(name)) continue;

  const source = resolve(root, name);
  if (!existsSync(source)) continue;

  cpSync(source, resolve(output, name), { recursive: true, force: true });
}