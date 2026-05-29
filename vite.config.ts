import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { fileURLToPath, URL } from 'node:url';

// Vite config wires together the React renderer and the Electron main/preload
// build pipeline. The renderer is a standard SPA; the Electron entrypoints are
// compiled separately into `dist-electron`.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    electron([
      {
        // Main process entry.
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        // Preload script. Exposes a typed, minimal bridge to the renderer.
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              // Electron 28+ requires ESM preload scripts to use the .mjs
              // extension; main.ts loads `preload.mjs` accordingly.
              output: { entryFileNames: 'preload.mjs' },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: 'dist',
  },
});
