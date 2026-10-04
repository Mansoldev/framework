import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from 'sass-embedded';

const themes = ['neon', 'pastel'];
const outputDirectory = path.resolve('dist/themes');

await mkdir(outputDirectory, { recursive: true });

for (const theme of themes) {
  const input = path.resolve(`src/themes/${theme}.scss`);
  const { css } = compile(input, { style: 'compressed' });
  await writeFile(path.join(outputDirectory, `${theme}.css`), css);
}