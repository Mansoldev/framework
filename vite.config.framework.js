import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/main.scss'),
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'framework.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    cssCodeSplit: false,
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
});
