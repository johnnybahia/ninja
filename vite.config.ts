import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    // Deploy path prefix: '/' for Netlify, '/ninja/' when the GitHub Pages workflow builds
    // it (the site lives under the repository's name there). Runtime asset URLs follow it
    // through import.meta.env.BASE_URL.
    base: process.env.VITE_BASE ?? '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          // three.js barely changes between releases of the game; splitting it into its
          // own chunk means a returning player's browser can keep it cached across
          // deploys and only re-download the (much smaller) game/UI bundle. Rolldown
          // (Vite 8's bundler) only accepts the function form, not the object-map shorthand.
          manualChunks(id: string) {
            if (id.includes('node_modules/three')) return 'three';
          },
        },
      },
    },
  };
});
