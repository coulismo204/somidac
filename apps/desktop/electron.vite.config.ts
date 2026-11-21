import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// Le paquet partagé est compilé avec l'application (source TypeScript), pas chargé depuis node_modules.
const shared = resolve(process.cwd(), '../../packages/shared/src/index.ts');
const alias = { '@somidac/shared': shared };

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: { exclude: ['@somidac/shared'] } },
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: { exclude: ['@somidac/shared'] } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
  },
});
