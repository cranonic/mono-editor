import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const vscodeShim = path.resolve(__dirname, './src/shims/vscode.ts');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@mono/editor/preview', replacement: path.resolve(__dirname, '../mono-editor/src/preview/index.ts') },
      { find: '@mono/editor/react', replacement: path.resolve(__dirname, '../mono-editor/src/react/MonoEditor.tsx') },
      { find: '@mono/editor', replacement: path.resolve(__dirname, '../mono-editor/src/index.ts') },
      { find: 'vscode', replacement: vscodeShim },
    ],
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
