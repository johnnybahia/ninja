import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Offline play: once the build is done, lists every file in the output with a content hash and
// writes sw.js from scripts/sw.template.js (the service worker stores them all on the first visit).
function offline(): Plugin {
  let outDir = 'dist';
  return {
    name: 'kage-offline',
    apply: 'build',
    enforce: 'post',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const files: Record<string, string> = {};
      const walk = (dir: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            walk(abs);
            continue;
          }
          const rel = path.relative(outDir, abs).split(path.sep).join('/');
          if (rel === 'sw.js' || rel.endsWith('.map') || ent.name.startsWith('.')) continue;
          files[encodeURI(rel)] = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 12);
        }
      };
      walk(outDir);
      const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
      const version = crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 12);
      const tpl = fs.readFileSync(path.resolve(import.meta.dirname, 'scripts/sw.template.js'), 'utf8');
      fs.writeFileSync(path.join(outDir, 'sw.js'), tpl.replace('__VERSION__', () => version).replace('__FILES__', () => JSON.stringify(sorted, null, 1)));
    },
  };
}

export default defineConfig(() => {
  return {
    // Deploy path prefix: '/' for Netlify, '/ninja/' when the GitHub Pages workflow builds
    // it (the site lives under the repository's name there). Runtime asset URLs follow it
    // through import.meta.env.BASE_URL.
    base: process.env.VITE_BASE ?? '/',
    plugins: [react(), tailwindcss(), offline()],
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
