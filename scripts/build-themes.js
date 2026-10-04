import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass-embedded';

const paletteShades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

function resolveThemeColorMap(theme) {
  const colors = theme.colors ?? {};
  return {
    type: 'families',
    groups: colors,
  };
}

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

    const { groups } = resolveThemeColorMap(theme);
    if (!groups || Object.keys(groups).length === 0) {
      throw new Error(`Theme "${theme.name}" must define color groups.`);
    }

    for (const [group, shades] of Object.entries(groups)) {
      if (!shades || typeof shades !== 'object' || Object.keys(shades).length === 0) {
        throw new Error(`Theme "${theme.name}" group "${group}" must define a color scale.`);
      }

      const actualShades = Object.keys(shades).sort((a, b) => Number(a) - Number(b));
      const missingShades = paletteShades.filter((shade) => !actualShades.includes(shade));

      if (missingShades.length > 0) {
        throw new Error(`Theme "${theme.name}" group "${group}" must define tones ${paletteShades.join(', ')}.`);
      }

      if (Object.values(shades).some((value) => typeof value !== 'string' || !value.trim())) {
        throw new Error(`Theme "${theme.name}" group "${group}" has an empty or invalid color value.`);
      }
    }

    if (theme.roles && typeof theme.roles === 'object') {
      const roleValues = Object.values(theme.roles);
      for (const roleValue of roleValues) {
        if (typeof roleValue !== 'string' || !(roleValue in groups)) {
          throw new Error(`Theme "${theme.name}" role "${roleValue}" does not resolve to a defined color family.`);
        }
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

function resolveThemePrimary(theme, roleName) {
  const map = theme.roles ?? {};
  const familyName = map[roleName] ?? (
    roleName === 'primary' ? 'blue' :
    roleName === 'secondary' ? 'indigo' :
    roleName === 'accent' ? 'cyan' :
    roleName === 'success' ? 'green' :
    roleName === 'warning' ? 'amber' :
    roleName === 'danger' ? 'red' :
    'slate'
  );
  const family = theme.colors?.[familyName];
  if (!family) {
    return '#000';
  }

  return family['500'] ?? family['600'] ?? family['400'] ?? '#000';
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
    `$roles: ${toSassMap(Object.fromEntries(manifest.themes.map(({ name, roles }) => [name, roles ?? {}])))};`,
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
      primary: resolveThemePrimary(theme, 'primary'),
      accent: resolveThemePrimary(theme, 'accent'),
    })),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(distributedManifest, null, 2)}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await buildThemes();
}