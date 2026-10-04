import { access, copyFile, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = path.join(projectRoot, 'website/public');
const publicStylesheet = path.join(publicDirectory, 'framework.css');
const websiteOutput = path.join(projectRoot, 'website/dist');
const docsOutput = path.join(projectRoot, 'docs');
let copiedStylesheet = false;

try {
  await access(path.join(projectRoot, 'dist/framework.css'));
  try {
    await access(publicStylesheet);
    throw new Error('Refusing to overwrite website/public/framework.css.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(publicDirectory, { recursive: true });
  await copyFile(path.join(projectRoot, 'dist/framework.css'), publicStylesheet);
  copiedStylesheet = true;

  await build({ root: path.join(projectRoot, 'website') });

  await rm(docsOutput, { recursive: true, force: true });
  await mkdir(docsOutput, { recursive: true });
  await cp(websiteOutput, docsOutput, { recursive: true });
} finally {
  if (copiedStylesheet) await rm(publicStylesheet, { force: true });
  await rm(websiteOutput, { recursive: true, force: true });
}
