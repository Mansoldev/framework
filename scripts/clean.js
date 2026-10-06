import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameworkOnly = process.argv.includes('--framework');
const targets = frameworkOnly
  ? ['dist']
  : ['dist', 'docs', 'temp', 'website/dist'];

await Promise.all(targets.map((target) => rm(path.join(projectRoot, target), {
  recursive: true,
  force: true,
})));
