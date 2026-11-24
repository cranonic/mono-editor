import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@common': path.resolve(import.meta.dirname, 'src/common'),
      '@platform': path.resolve(import.meta.dirname, 'src/platform'),
      '@browser': path.resolve(import.meta.dirname, 'src/browser'),
      '@contrib': path.resolve(import.meta.dirname, 'src/contrib'),
      '@api': path.resolve(import.meta.dirname, 'src/api'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: false,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
});
