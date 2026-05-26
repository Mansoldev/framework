import { defineConfig } from 'vite';

export default defineConfig({
  // base: '/nombre-de-tu-repo/', // DESCOMENTA ESTO PARA GITHUB PAGES
  build: {
    outDir: 'docs', // GitHub Pages suele usar la carpeta docs o la raíz de branch
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler', // Asegura el uso de sass-embedded
      },
    },
  },
});