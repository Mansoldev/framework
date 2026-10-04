import { defineConfig } from 'vite';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        core: resolve(projectRoot, 'src/core.scss'),
        framework: resolve(projectRoot, 'src/main.scss'),
      },
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return basename(assetInfo.name);
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    cssCodeSplit: true,
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
});
