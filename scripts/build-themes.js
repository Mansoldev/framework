import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass-embedded';

const expectedGroups = ['brand', 'accent', 'neutral'];
const brandShades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const neutralShades = ['0', ...brandShades, '1000'];

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.themes) || manifest.themes.length === 0) {
    throw new Error('Theme manifest must contain at least one theme and use schemaVersion 1.');
  }

  const themeNames = new Set();

  for (const theme of manifest.themes) {
    if (!theme || !/^[a-z0-9-]+$/.test(theme.name ?? '') || themeNames.has(theme.name)) {
      throw new Error(`Invalid or duplicate theme name in manifest: ${theme?.name}`);
    }
    if (![theme.label, theme.description].every((value) => typeof value === 'string' && value.trim())) {
      throw new Error(`Theme "${theme.name}" must define a label and description.`);
    }
    if (!theme.colors || Object.keys(theme.colors).sort().join(',') !== [...expectedGroups].sort().join(',')) {
      throw new Error(`Theme "${theme.name}" must define exactly: ${expectedGroups.join(', ')}.`);
    }

    for (const group of expectedGroups) {
      const expectedShades = group === 'neutral' ? neutralShades : brandShades;
      const shades = theme.colors[group];
      if (!shades || Object.keys(shades).sort((a, b) => Number(a) - Number(b)).join(',') !== expectedShades.join(',')) {
        throw new Error(`Theme "${theme.name}" group "${group}" must define tones ${expectedShades.join(', ')}.`);
      }
      if (Object.values(shades).some((value) => typeof value !== 'string' || !value.trim())) {
        throw new Error(`Theme "${theme.name}" group "${group}" has an empty or invalid color value.`);
      }
    }

    themeNames.add(theme.name);
  }
}

function toSassMap(value) {
  const entries = Object.entries(value).map(([key, item]) => {
    const sassValue = typeof item === 'object'
      ? toSassMap(item)
      : item;
    return `${JSON.stringify(key)}: ${sassValue}`;
  });
  return `(${entries.join(', ')})`;
}

export async function buildThemes(projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const sourceDirectory = path.join(projectRoot, 'src');
  const manifestPath = path.join(sourceDirectory, 'themes/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const outputDirectory = path.join(projectRoot, 'dist');
  const themeDirectory = path.join(outputDirectory, 'themes');
  const generatedColorsPath = path.join(sourceDirectory, 'tokens/_generated-colors.scss');

  validateManifest(manifest);

  const sassSource = [
    '@use "sass:meta";',
    `$palettes: ${toSassMap(Object.fromEntries(manifest.themes.map(({ name, colors }) => [name, colors])))};`,
    '@each $theme-name, $groups in $palettes {',
    '  @each $group-name, $tones in $groups {',
    '    @each $shade, $value in $tones {',
    '      @if meta.type-of($value) != "color" {',
    '        @error "Invalid color at #{$theme-name}/#{$group-name}/#{$shade}: #{$value}";',
    '      }',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  await writeFile(generatedColorsPath, sassSource);
  await rm(themeDirectory, { recursive: true, force: true });
  await mkdir(themeDirectory, { recursive: true });

  for (const theme of manifest.themes) {
    const entrypoint = [
      '@use "themes/root" as root;',
      `@include root.selected-palette(${JSON.stringify(theme.name)});`,
      '',
    ].join('\n');
    const { css } = compileString(entrypoint, {
      loadPaths: [sourceDirectory],
      style: 'compressed',
    });
    await writeFile(path.join(themeDirectory, `${theme.name}.css`), css);
  }

  const distributedManifest = {
    ...manifest,
    themes: manifest.themes.map((theme) => ({
      ...theme,
      primary: theme.colors.brand['500'],
      accent: theme.colors.accent['500'],
    })),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(distributedManifest, null, 2)}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await buildThemes();
}