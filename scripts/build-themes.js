import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass-embedded';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'src/themes/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const outputDirectory = path.join(projectRoot, 'dist');
const themeDirectory = path.join(outputDirectory, 'themes');

if (!Array.isArray(manifest.themes) || manifest.themes.length === 0) {
  throw new Error('Theme manifest must contain at least one theme.');
}

const themeNames = new Set();
for (const theme of manifest.themes) {
  if (!theme || !/^[a-z0-9-]+$/.test(theme.name ?? '') || themeNames.has(theme.name)) {
    throw new Error(`Invalid or duplicate theme name in manifest: ${theme?.name}`);
  }
  if (![theme.description, theme.primary, theme.accent].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error(`Theme "${theme.name}" must define description, primary, and accent metadata.`);
  }
  themeNames.add(theme.name);
}

await rm(themeDirectory, { recursive: true, force: true });
await mkdir(themeDirectory, { recursive: true });

for (const { name } of manifest.themes) {
  const input = path.join(projectRoot, `src/themes/${name}.scss`);
  const { css } = compile(input, { style: 'compressed' });
  await writeFile(path.join(themeDirectory, `${name}.css`), css);
}

await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);