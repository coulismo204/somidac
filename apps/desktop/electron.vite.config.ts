import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// Le paquet partagé est compilé avec l'application (source TypeScript), pas chargé depuis node_modules.
const shared = resolve(process.cwd(), '../../packages/shared/src/index.ts');
const alias = { '@somidac/shared': shared };

export default defineConfig({
  // Tout est intégré dans out/ (aucun node_modules dans l'installateur).
  main: {
    resolve: { alias },
    build: { externalizeDeps: false },
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
  },
});
