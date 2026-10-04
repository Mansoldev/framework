import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemes } from '../scripts/build-themes.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(projectRoot, 'bin/cli.js');

async function createTempProject() {
  return mkdtemp(path.join(os.tmpdir(), 'mansoldev-css-'));
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('list reads theme names and metadata from the generated manifest', () => {
  const result = runCli(projectRoot, ['list']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /neon.*High-chroma/);
  assert.match(result.stdout, /pastel.*Soft rose/);
});

test('theme manifests expose full family color scales and semantic aliases', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'src/themes/manifest.json'), 'utf8'));
  const firstTheme = manifest.themes[0];

  assert.ok(firstTheme.colors.blue);
  assert.ok(firstTheme.colors.indigo);
  assert.ok(firstTheme.colors.green);
  assert.ok(firstTheme.colors.amber);
  assert.ok(firstTheme.colors.red);
  assert.ok(firstTheme.colors.slate);
  assert.ok(firstTheme.roles.primary);
  assert.equal(firstTheme.roles.primary, 'blue');
  assert.equal(firstTheme.roles.success, 'green');
});

test('package exports resolve the manifest and generated theme stylesheets', async () => {
  const manifestPath = fileURLToPath(import.meta.resolve('@mansoldev/framework/manifest.json'));
  const neonPath = fileURLToPath(import.meta.resolve('@mansoldev/framework/themes/neon.css'));
  const corePath = fileURLToPath(import.meta.resolve('@mansoldev/framework/core.css'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const neonCss = await readFile(neonPath, 'utf8');
  const coreCss = await readFile(corePath, 'utf8');

  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.themes.some(({ name }) => name === 'neon'));
  assert.match(neonCss, /--brand:/);
  assert.match(coreCss, /--mu-space-0:/);
  assert.doesNotMatch(coreCss, /--brand:/);
});

test('adding a theme to the manifest generates Sass data and CSS without a theme-specific Sass file', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'src');
  await mkdir(path.join(sourceRoot, 'tokens'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'themes'), { recursive: true });

  for (const source of [
    ['src/tokens/_map-colors.scss', 'tokens/_map-colors.scss'],
    ['src/tokens/_map-spacing.scss', 'tokens/_map-spacing.scss'],
    ['src/themes/_root.scss', 'themes/_root.scss'],
  ]) {
    await copyFile(path.join(projectRoot, source[0]), path.join(sourceRoot, source[1]));
  }

  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'src/themes/manifest.json'), 'utf8'));
  const thirdTheme = structuredClone(manifest.themes[1]);
  thirdTheme.name = 'coral';
  thirdTheme.label = 'Coral';
  thirdTheme.description = 'Coral palette generated from manifest data.';
  manifest.themes.push(thirdTheme);
  await writeFile(path.join(sourceRoot, 'themes/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  await buildThemes(root);

  const generatedSass = await readFile(path.join(sourceRoot, 'tokens/_generated-colors.scss'), 'utf8');
  const generatedCss = await readFile(path.join(root, 'dist/themes/coral.css'), 'utf8');
  const distributedManifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
  assert.match(generatedSass, /"coral"/);
  assert.match(generatedCss, /--brand:/);
  assert.ok(distributedManifest.themes.some(({ name }) => name === 'coral'));
  await assert.rejects(readFile(path.join(sourceRoot, 'themes/coral.scss')));
});

test('invalid manifest colors fail with the theme and tone location', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'src');
  await mkdir(path.join(sourceRoot, 'tokens'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'themes'), { recursive: true });

  for (const source of [
    ['src/tokens/_map-colors.scss', 'tokens/_map-colors.scss'],
    ['src/tokens/_map-spacing.scss', 'tokens/_map-spacing.scss'],
    ['src/themes/_root.scss', 'themes/_root.scss'],
  ]) {
    await copyFile(path.join(projectRoot, source[0]), path.join(sourceRoot, source[1]));
  }

  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'src/themes/manifest.json'), 'utf8'));
  manifest.themes[0].colors.blue['100'] = 'not-a-color';
  await writeFile(path.join(sourceRoot, 'themes/manifest.json'), JSON.stringify(manifest));

  await assert.rejects(buildThemes(root), /Invalid color at neon\/blue\/100/);
});

test('init integrates with an existing Vite stylesheet and is idempotent', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '*' } }));
  await writeFile(path.join(root, 'src/index.css'), '/* App styles */\nbody { margin: 0; }\n');

  const first = runCli(root, ['init', '--theme=neon']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(await readFile(path.join(root, 'src/index.css'), 'utf8'), /^@import "\.\/mansoldev-framework\.css";/);
  const generatedCss = await readFile(path.join(root, 'src/mansoldev-framework.css'), 'utf8');
  assert.match(generatedCss, /framework\/core\.css/);
  assert.match(generatedCss, /themes\/neon\.css/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.mansoldevrc.json'), 'utf8')).projectType, 'vite');

  const before = await readFile(path.join(root, 'src/index.css'), 'utf8');
  const second = runCli(root, ['init', '--theme', 'neon']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(path.join(root, 'src/index.css'), 'utf8'), before);
});

test('init detects Next.js, Angular, and Astro entry points', async (context) => {
  const roots = [];
  context.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

  const nextRoot = await createTempProject();
  roots.push(nextRoot);
  await mkdir(path.join(nextRoot, 'src/app'), { recursive: true });
  await writeFile(path.join(nextRoot, 'package.json'), JSON.stringify({ dependencies: { next: '*' } }));
  await writeFile(path.join(nextRoot, 'src/app/globals.css'), 'body { margin: 0; }\n');
  const nextResult = runCli(nextRoot, ['init', '--theme', 'neon']);
  assert.equal(nextResult.status, 0, nextResult.stderr);
  assert.equal(JSON.parse(await readFile(path.join(nextRoot, '.mansoldevrc.json'), 'utf8')).projectType, 'next');
  assert.match(await readFile(path.join(nextRoot, 'src/app/globals.css'), 'utf8'), /@import "\.\/mansoldev-framework\.css"/);

  const angularRoot = await createTempProject();
  roots.push(angularRoot);
  await mkdir(path.join(angularRoot, 'src'), { recursive: true });
  await writeFile(path.join(angularRoot, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '*' } }));
  await writeFile(path.join(angularRoot, 'angular.json'), JSON.stringify({
    projects: {
      demo: {
        architect: {
          build: { options: { styles: ['src/custom-theme.scss'] } },
        },
      },
    },
  }));
  await writeFile(path.join(angularRoot, 'src/custom-theme.scss'), '@use "tokens";\nbody { margin: 0; }\n');
  const angularResult = runCli(angularRoot, ['init', '--theme', 'neon']);
  assert.equal(angularResult.status, 0, angularResult.stderr);
  assert.equal(JSON.parse(await readFile(path.join(angularRoot, '.mansoldevrc.json'), 'utf8')).projectType, 'angular');
  assert.match(await readFile(path.join(angularRoot, 'src/custom-theme.scss'), 'utf8'), /^@use "tokens";\n@import/);

  const astroRoot = await createTempProject();
  roots.push(astroRoot);
  await mkdir(path.join(astroRoot, 'src/layouts'), { recursive: true });
  await writeFile(path.join(astroRoot, 'package.json'), JSON.stringify({ dependencies: { astro: '*' } }));
  await writeFile(path.join(astroRoot, 'src/layouts/MainLayout.astro'), '---\nconst title = "Demo";\n---\n<html></html>\n');
  const astroResult = runCli(astroRoot, ['init', '--theme', 'pastel']);
  assert.equal(astroResult.status, 0, astroResult.stderr);
  assert.equal(JSON.parse(await readFile(path.join(astroRoot, '.mansoldevrc.json'), 'utf8')).projectType, 'astro');
  assert.match(await readFile(path.join(astroRoot, 'src/layouts/MainLayout.astro'), 'utf8'), /^---\nimport "\.\.\/styles\/mansoldev-framework\.css";/);
});

test('dry-run reports changes without creating files', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = runCli(root, ['init', '--theme', 'pastel', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would write/);
  await assert.rejects(readFile(path.join(root, '.mansoldevrc.json')));
  await assert.rejects(readFile(path.join(root, 'src/styles/mansoldev-framework.css')));
});

test('init warns when the saved config comes from an older CLI version', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, '.mansoldevrc.json'), JSON.stringify({
    version: '0.9.0',
    projectType: 'unknown',
    stylesheet: 'src/styles/mansoldev-framework.css',
    themes: ['neon'],
  }));

  const result = runCli(root, ['init', '--theme', 'neon', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /older CLI 0\.9\.0/);
});

test('existing generated files require force in non-interactive runs', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'theme.css');
  await writeFile(output, 'user-owned content\n');

  const blocked = runCli(root, ['init', '--theme', 'neon', '--out', 'theme.css']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Use --force/);
  assert.equal(await readFile(output, 'utf8'), 'user-owned content\n');

  const forced = runCli(root, ['init', '-t', 'neon', '-o', 'theme.css', '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(await readFile(output, 'utf8'), /themes\/neon\.css/);
});

test('out cannot overwrite the detected entrypoint', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '*' } }));
  await writeFile(path.join(root, 'src/index.css'), 'body { color: red; }\n');

  const result = runCli(root, ['init', '--theme', 'neon', '--out', 'src/index.css', '--force']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot overwrite the project entrypoint/);
  assert.equal(await readFile(path.join(root, 'src/index.css'), 'utf8'), 'body { color: red; }\n');
});

test('add generates a separate theme stylesheet and updates the config', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));
  const initialized = runCli(root, ['init', '--theme', 'neon']);
  assert.equal(initialized.status, 0, initialized.stderr);

  const added = runCli(root, ['add', '-t', 'pastel']);
  assert.equal(added.status, 0, added.stderr);
  assert.match(await readFile(path.join(root, 'src/styles/mansoldev-pastel.css'), 'utf8'), /themes\/pastel\.css/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.mansoldevrc.json'), 'utf8')).themes, ['neon', 'pastel']);
});

test('init preserves a custom output path and themes previously added', async (context) => {
  const root = await createTempProject();
  context.after(() => rm(root, { recursive: true, force: true }));

  const initial = runCli(root, ['init', '--theme', 'neon', '--out', 'styles/custom-framework.css']);
  assert.equal(initial.status, 0, initial.stderr);
  const added = runCli(root, ['add', 'pastel']);
  assert.equal(added.status, 0, added.stderr);
  const repeated = runCli(root, ['init', '--theme', 'neon']);
  assert.equal(repeated.status, 0, repeated.stderr);

  const config = JSON.parse(await readFile(path.join(root, '.mansoldevrc.json'), 'utf8'));
  assert.equal(config.stylesheet, 'styles/custom-framework.css');
  assert.deepEqual(config.themes, ['neon', 'pastel']);
});

test('unknown themes and malformed options exit as usage errors', () => {
  const unknownTheme = runCli(projectRoot, ['init', '--theme', 'unknown']);
  assert.equal(unknownTheme.status, 1);
  assert.match(unknownTheme.stderr, /Unknown theme/);

  const unknownOption = runCli(projectRoot, ['init', '--unknown']);
  assert.equal(unknownOption.status, 1);
});