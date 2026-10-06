#!/usr/bin/env node
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cancel, confirm, intro, isCancel, outro, select } from '@clack/prompts';

const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(cliDirectory, '..');
const colorsEnabled = Boolean(stdout.isTTY && process.env.NO_COLOR === undefined);

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function paint(code, text) {
  return colorsEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

// Parse once with Node's built-in parser; the first positional token selects the command.
function parseCliArgs(argv) {
  const first = argv[0];
  const command = first && !first.startsWith('-') ? first : 'init';
  const commandArgs = first && !first.startsWith('-') ? argv.slice(1) : argv;
  const parsed = parseArgs({
    args: commandArgs,
    allowPositionals: true,
    options: {
      theme: { type: 'string', short: 't' },
      out: { type: 'string', short: 'o' },
      force: { type: 'boolean', short: 'f', default: false },
      list: { type: 'boolean', short: 'l', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  return { command: parsed.values.list ? 'list' : command, ...parsed };
}

async function readJson(filePath, { optional = false } = {}) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`, 2);
    }
    throw error;
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function loadPackageMetadata() {
  const [manifest, packageJson] = await Promise.all([
    readJson(path.join(packageRoot, 'dist/manifest.json')),
    readJson(path.join(packageRoot, 'package.json')),
  ]);

  if (!Array.isArray(manifest.themes) || manifest.themes.length === 0) {
    throw new CliError('The installed package has no available themes.', 2);
  }

  return { manifest, version: packageJson.version };
}

function printHelp() {
  console.log(`Usage:
  mansoldev-css [init] [options]
  mansoldev-css add <theme> [options]
  mansoldev-css list

Commands:
  init               Configure the framework and detected project entry point
  add <theme>        Generate an additional stylesheet for a theme
  list               List themes from the package manifest

Options:
  -t, --theme <name> Select a theme
  -o, --out <path>   Choose the generated stylesheet path
  -f, --force        Overwrite generated files without prompting
  -l, --list         Alias for the list command
      --dry-run      Show planned changes without writing files
  -h, --help         Show this help`);
}

function printThemes(themes) {
  for (const theme of themes) {
    const marker = paint('32', '*');
    console.log(`${marker} ${paint('1', theme.name)}  ${theme.description}`);
    console.log(`  Primary: ${theme.primary}  Accent: ${theme.accent}`);
  }
}

async function chooseTheme(themes, requestedTheme) {
  if (requestedTheme) {
    const theme = themes.find(({ name }) => name === requestedTheme);
    if (!theme) {
      throw new CliError(`Unknown theme "${requestedTheme}". Run "mansoldev-css list" to see available themes.`);
    }
    return theme;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new CliError('Choose a theme with --theme <name> when running without an interactive terminal.');
  }

  const answer = await select({
    message: 'Choose a color palette',
    options: themes.map((theme) => ({
      value: theme.name,
      label: theme.name,
      hint: theme.description,
    })),
  });

  if (isCancel(answer)) {
    cancel('Configuration cancelled.');
    throw new CliError('Configuration cancelled.', 0);
  }

  return themes.find(({ name }) => name === answer);
}

// Find conventional global stylesheet or module entry points without assuming a specific backend.
async function detectProject(root) {
  const packageJson = await readJson(path.join(root, 'package.json'), { optional: true }) ?? {};
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const fileExists = async (...paths) => {
    for (const relativePath of paths) {
      if (await exists(path.join(root, relativePath))) return relativePath;
    }
    return null;
  };

  let type = 'unknown';
  if (dependencies.next || await fileExists('next.config.js', 'next.config.cjs', 'next.config.mjs', 'next.config.ts')) {
    type = 'next';
  } else if (dependencies['@angular/core'] || await fileExists('angular.json')) {
    type = 'angular';
  } else if (dependencies.astro || await fileExists('astro.config.mjs', 'astro.config.js', 'astro.config.cjs', 'astro.config.ts')) {
    type = 'astro';
  } else if (dependencies.vite || await fileExists('vite.config.js', 'vite.config.ts', 'vite.config.mjs')) {
    type = 'vite';
  }

  const cssCandidates = {
    next: ['src/app/globals.css', 'app/globals.css', 'src/app/globals.scss', 'app/globals.scss', 'src/styles/globals.css', 'styles/globals.css'],
    angular: ['src/styles.scss', 'src/styles.css'],
    astro: ['src/styles/global.css', 'src/styles/global.scss', 'src/styles/website.scss', 'src/styles.css', 'src/styles.scss'],
    vite: ['src/index.css', 'src/main.css', 'src/style.css', 'src/styles.css', 'src/global.css', 'src/index.scss', 'src/main.scss', 'src/styles.scss'],
    unknown: ['src/styles.css', 'src/index.css', 'src/main.css', 'src/style.css', 'src/global.css'],
  };
  let cssEntry = await fileExists(...cssCandidates[type]);
  if (!cssEntry && type === 'angular') {
    const angularConfig = await readJson(path.join(root, 'angular.json'), { optional: true });
    const projects = angularConfig?.projects ?? {};
    const selectedProject = projects[angularConfig?.defaultProject] ?? Object.values(projects)[0];
    const buildOptions = selectedProject?.architect?.build?.options ?? selectedProject?.targets?.build?.options;
    const styles = Array.isArray(buildOptions?.styles) ? buildOptions.styles : [];

    for (const style of styles) {
      const stylePath = typeof style === 'string' ? style : style?.input;
      if (typeof stylePath !== 'string' || stylePath.startsWith('node_modules/')) continue;
      const absolutePath = path.resolve(root, stylePath);
      const relativePath = path.relative(root, absolutePath);
      if (relativePath.startsWith('..') || !(await exists(absolutePath))) continue;
      cssEntry = relativePath;
      break;
    }
  }

  let moduleEntry = null;
  if (!cssEntry) {
    const moduleCandidates = {
      next: ['src/app/layout.tsx', 'app/layout.tsx', 'src/app/layout.ts', 'app/layout.ts', 'src/app/layout.jsx', 'app/layout.jsx', 'src/app/layout.js', 'app/layout.js'],
      angular: ['src/main.ts'],
      astro: ['src/layouts/MainLayout.astro', 'src/layouts/Layout.astro'],
      vite: ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js', 'src/main.mjs'],
      unknown: ['src/main.ts', 'src/main.js', 'src/index.ts', 'src/index.js'],
    };
    moduleEntry = await fileExists(...moduleCandidates[type]);
  }

  return { type, cssEntry, moduleEntry };
}

function toImportPath(fromFile, toFile) {
  let relativePath = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/');
  if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
  return relativePath;
}

function stylesheetFor(themeName) {
  return [
    '@import "@mansoldev/framework/core.css";',
    `@import "@mansoldev/framework/themes/${themeName}.css";`,
    '',
  ].join('\n');
}

function findSassDirectivesEnd(content, start) {
  let cursor = start;

  while (cursor < content.length) {
    while (/\s/.test(content[cursor] ?? '')) cursor += 1;

    if (content.startsWith('//', cursor)) {
      const newline = content.indexOf('\n', cursor);
      cursor = newline === -1 ? content.length : newline + 1;
      continue;
    }

    if (content.startsWith('/*', cursor)) {
      const commentEnd = content.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? content.length : commentEnd + 2;
      continue;
    }

    if (!/^@(use|forward)\b/.test(content.slice(cursor))) break;
    const directiveEnd = content.indexOf(';', cursor);
    if (directiveEnd === -1) break;
    cursor = directiveEnd + 1;
  }

  return cursor;
}

function insertCssImport(content, importLine, extension) {
  if (content.includes(importLine)) return { content, changed: false };

  let insertionPoint = content.startsWith('\uFEFF') ? 1 : 0;
  if (/^\s*@charset\s+[^;]+;/i.test(content.slice(insertionPoint))) {
    const charsetEnd = content.indexOf(';', insertionPoint) + 1;
    insertionPoint = charsetEnd;
    while (/\s/.test(content[insertionPoint] ?? '')) insertionPoint += 1;
  }

  if (extension === '.scss' || extension === '.sass') {
    insertionPoint = findSassDirectivesEnd(content, insertionPoint);
  }

  const before = content.slice(0, insertionPoint);
  const after = content.slice(insertionPoint);
  const separator = before && !before.endsWith('\n') ? '\n' : '';
  return {
    content: `${before}${separator}${importLine}\n${after}`,
    changed: true,
  };
}

function insertModuleImport(content, importLine, extension) {
  if (content.includes(importLine)) return { content, changed: false };

  if (extension === '.astro') {
    const frontmatter = content.match(/^---\r?\n/);
    if (frontmatter) {
      const insertionPoint = frontmatter[0].length;
      return {
        content: `${content.slice(0, insertionPoint)}${importLine}\n${content.slice(insertionPoint)}`,
        changed: true,
      };
    }
    return { content: `---\n${importLine}\n---\n${content}`, changed: true };
  }

  const separator = content && !content.endsWith('\n') ? '\n' : '';
  return { content: `${content}${separator}${importLine}\n`, changed: true };
}

async function confirmOverwrite(filePath, force, dryRun) {
  if (!(await exists(filePath))) return true;
  if (dryRun || force) return true;
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new CliError(`File already exists: ${filePath}. Use --force to overwrite it.`);
  }

  const answer = await confirm({ message: `${filePath} exists. Overwrite it?` });
  if (isCancel(answer)) {
    cancel('No files were changed.');
    return false;
  }
  return answer;
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function planIntegration(root, project, outputPath) {
  if (!project.cssEntry && !project.moduleEntry) return null;

  const targetRelativePath = project.cssEntry ?? project.moduleEntry;
  const targetPath = path.join(root, targetRelativePath);
  const relativeImport = toImportPath(targetPath, outputPath);
  const extension = path.extname(targetPath).toLowerCase();
  const isCss = Boolean(project.cssEntry);
  const importLine = isCss
    ? `@import ${JSON.stringify(relativeImport)};`
    : `import ${JSON.stringify(relativeImport)};`;
  const original = await readFile(targetPath, 'utf8');
  const update = isCss
    ? insertCssImport(original, importLine, extension)
    : insertModuleImport(original, importLine, extension);

  if (!update.changed) return { path: targetRelativePath, changed: false };
  return { path: targetRelativePath, targetPath, content: update.content, changed: true };
}

async function readExistingConfig(root, version) {
  const configPath = path.join(root, '.mansoldevrc.json');
  const config = await readJson(configPath, { optional: true });
  if (config?.version && config.version !== version) {
    const comparison = compareVersions(config.version, version);
    const notice = comparison === -1
      ? `Configuration was generated by older CLI ${config.version}; current version is ${version}. Review migration notes before updating.`
      : comparison === 1
        ? `Configuration was generated by newer CLI ${config.version}; current version is ${version}. Avoid downgrading without reviewing compatibility.`
        : `Configuration version ${config.version} differs from current CLI ${version}. Review compatibility before updating.`;
    console.warn(paint('33', notice));
  }
  return { configPath, config };
}

function compareVersions(left, right) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    return match ? match.slice(1).map(Number) : null;
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

async function runInit(options, themes, version) {
  const root = process.cwd();
  const theme = await chooseTheme(themes, options.values.theme);
  const project = await detectProject(root);
  const previous = await readExistingConfig(root, version);
  const defaultOutput = previous.config?.stylesheet ?? (project.cssEntry
    ? path.join(path.dirname(project.cssEntry), 'mansoldev-framework.css')
    : 'src/styles/mansoldev-framework.css');
  const outputPath = path.resolve(root, options.values.out ?? defaultOutput);
  const integrationEntry = project.cssEntry ?? project.moduleEntry;
  const protectedPaths = [previous.configPath];
  if (integrationEntry) protectedPaths.push(path.resolve(root, integrationEntry));
  if (protectedPaths.some((filePath) => path.resolve(filePath) === outputPath)) {
    throw new CliError('--out cannot overwrite the project entrypoint or .mansoldevrc.json.');
  }

  const outputRelative = path.relative(root, outputPath).split(path.sep).join('/');
  const cssContent = stylesheetFor(theme.name);
  const configContent = `${JSON.stringify({
    version,
    projectType: project.type,
    stylesheet: outputRelative,
    themes: [...new Set([theme.name, ...(Array.isArray(previous.config?.themes) ? previous.config.themes : [])])],
  }, null, 2)}\n`;
  const configDiffers = !previous.config || JSON.stringify(previous.config) !== JSON.stringify(JSON.parse(configContent));
  const outputExists = await exists(outputPath);
  const cssDiffers = outputExists && await readFile(outputPath, 'utf8') !== cssContent;

  if (cssDiffers && !(await confirmOverwrite(outputPath, options.values.force, options.values['dry-run']))) return;
  if (configDiffers && previous.config && !(await confirmOverwrite(previous.configPath, options.values.force, options.values['dry-run']))) return;

  const integration = await planIntegration(root, project, outputPath);
  const changes = [];
  if (!outputExists || cssDiffers) changes.push(`Write ${path.relative(root, outputPath)}`);
  if (configDiffers) changes.push(`Write ${path.relative(root, previous.configPath)}`);
  if (integration?.changed) changes.push(`Update ${integration.path}`);

  if (options.values['dry-run']) {
    console.log(changes.length ? changes.map((change) => `Would ${change.toLowerCase()}`).join('\n') : 'No changes needed.');
    console.log(`Theme: ${theme.name} (${theme.description})`);
    return;
  }

  if (!outputExists || cssDiffers) await atomicWrite(outputPath, cssContent);
  if (configDiffers) await atomicWrite(previous.configPath, configContent);
  if (integration?.changed) await atomicWrite(integration.targetPath, integration.content);
  intro('Mansoldev CSS');
  console.log(`${paint('32', '✓')} Configured ${paint('1', theme.name)} palette for ${project.type} project.`);
  console.log(`Stylesheet: ${path.relative(root, outputPath)}`);
  if (integration) {
    console.log(integration.changed ? `Integrated from ${integration.path}.` : `Already integrated in ${integration.path}.`);
  } else {
    console.log(`Import ${paint('1', `./${path.relative(root, outputPath).split(path.sep).join('/')}`)} from your application's CSS or JavaScript entry point.`);
  }
  outro('Configuration complete.');
}

async function runAdd(options, themes, version) {
  const root = process.cwd();
  const previous = await readExistingConfig(root, version);
  if (!previous.config) throw new CliError('No .mansoldevrc.json found. Run "mansoldev-css init" first.');

  const positionalTheme = options.positionals[0];
  if (options.positionals.length > 1) throw new CliError('Usage: mansoldev-css add <theme> [options].');
  const theme = await chooseTheme(themes, options.values.theme ?? positionalTheme);
  const configuredThemes = Array.isArray(previous.config.themes) ? previous.config.themes : [];
  const baseDirectory = path.dirname(path.resolve(root, previous.config.stylesheet));
  const defaultOutput = path.join(baseDirectory, `mansoldev-${theme.name}.css`);
  const outputPath = path.resolve(root, options.values.out ?? defaultOutput);
  const mainStylesheetPath = path.resolve(root, previous.config.stylesheet);
  if (outputPath === path.resolve(previous.configPath) || outputPath === mainStylesheetPath) {
    throw new CliError('--out cannot overwrite .mansoldevrc.json or the initialized framework stylesheet.');
  }

  const outputRelative = path.relative(root, outputPath).split(path.sep).join('/');
  const cssContent = `@import "@mansoldev/framework/themes/${theme.name}.css";\n`;
  const outputExists = await exists(outputPath);
  const outputDiffers = outputExists && await readFile(outputPath, 'utf8') !== cssContent;
  const configContent = `${JSON.stringify({
    ...previous.config,
    version,
    themes: configuredThemes.includes(theme.name) ? configuredThemes : [...configuredThemes, theme.name],
  }, null, 2)}\n`;

  if (configuredThemes.includes(theme.name) && outputExists && !outputDiffers) {
    console.log(`The ${theme.name} theme is already configured.`);
    return;
  }

  if (outputDiffers && !(await confirmOverwrite(outputPath, options.values.force, options.values['dry-run']))) return;
  if (options.values['dry-run']) {
    if (!outputExists || outputDiffers) console.log(`Would write ${outputRelative}`);
    if (JSON.stringify(previous.config) !== JSON.stringify(JSON.parse(configContent))) {
      console.log(`Would update .mansoldevrc.json with theme ${theme.name}`);
    }
    console.log(`Import ${outputRelative} when you want to activate this additional theme.`);
    return;
  }

  if (!outputExists || outputDiffers) await atomicWrite(outputPath, cssContent);
  if (JSON.stringify(previous.config) !== JSON.stringify(JSON.parse(configContent))) {
    await atomicWrite(previous.configPath, configContent);
  }
  console.log(`${paint('32', '✓')} Added ${paint('1', theme.name)} stylesheet at ${outputRelative}.`);
  console.log(`Import ${outputRelative} when you want to activate this additional theme.`);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.values.help) {
    printHelp();
    return;
  }

  if (!['init', 'add', 'list'].includes(options.command)) {
    throw new CliError(`Unknown command "${options.command}". Available commands: init, add, list.`);
  }

  const { manifest, version } = await loadPackageMetadata();
  if (options.command === 'list') {
    if (options.positionals.length) throw new CliError('Usage: mansoldev-css list.');
    printThemes(manifest.themes);
    return;
  }

  if (options.command === 'init' && options.positionals.length) {
    throw new CliError('Usage: mansoldev-css init [options].');
  }

  if (options.command === 'init') await runInit(options, manifest.themes, version);
  if (options.command === 'add') await runAdd(options, manifest.themes, version);
}

main().catch((error) => {
  const isUsageError = error.code?.startsWith('ERR_PARSE_ARGS_');
  const exitCode = error instanceof CliError ? error.exitCode : isUsageError ? 1 : 2;
  if (exitCode !== 0) console.error(`${paint('31', '✖')} ${error.message}`);
  process.exitCode = exitCode;
});