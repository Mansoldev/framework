#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const themes = ['neon', 'pastel'];
const args = process.argv.slice(2);

// Help option
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: mansoldev-css [--theme neon|pastel] [--out path]');
  process.exit(0);
}

// Function: Search for the value of a command line option
function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

// CLI init
let theme = optionValue('--theme');

// First choice theme: stdin indicates only user management
if (!theme && stdin.isTTY) {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    theme = await readline.question('Choose a palette (neon/pastel): ');
  } finally {
    readline.close();
  }
}

// test first choice: theme
if (!themes.includes(theme)) {
  console.error(`Choose one of the available palettes: ${themes.join(', ')}.`);
  process.exit(1);
}

// With correct first choice, create the output CSS file
const outputPath = path.resolve(optionValue('--out') ?? 'src/styles/mansoldev-framework.css');
const stylesheet = [
  '@import "@mansoldev/framework/framework.css";',
  `@import "@mansoldev/framework/themes/${theme}.css";`,
  '',
].join('\n');

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, stylesheet);
console.log(`Created ${path.relative(process.cwd(), outputPath)} with the ${theme} palette.`);
console.log('Import this CSS file from your JavaScript application entry point.');