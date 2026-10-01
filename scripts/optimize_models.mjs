// Compresses the *.raw.glb files written by convert_characters.py / convert_weapons.py
// (assets_src/build/) into the GLBs the game loads (public/models/).
//
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
//   node scripts/optimize_models.mjs
//
// Geometry and animation get EXT_meshopt_compression (decoded in the browser by
// three.js's MeshoptDecoder, a small WASM module shipped inside three itself). Mixamo
// clips key every bone's translation and scale on every frame even though only the hips
// ever move and nothing ever scales - those channels are dropped before compressing.
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BUILD = path.join(ROOT, 'assets_src', 'build');
const MODELS = path.join(ROOT, 'public', 'models');

function stripStaticChannels(doc) {
  let dropped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const p = ch.getTargetPath();
      const out = ch.getSampler()?.getOutput();
      if (!node || !out) continue;
      let drop = false;
      if (p === 'scale') {
        const a = out.getArray();
        drop = a.every((v) => Math.abs(v - 1) < 1e-3);
      } else if (p === 'translation' && !/Hips$/.test(node.getName())) {
        const rest = node.getTranslation();
        const a = out.getArray();
        drop = true;
        for (let i = 0; i < a.length && drop; i += 3) {
          if (Math.abs(a[i] - rest[0]) + Math.abs(a[i + 1] - rest[1]) + Math.abs(a[i + 2] - rest[2]) > 1e-3 * (1 + Math.abs(rest[1]))) drop = false;
        }
      }
      if (drop) {
        ch.getSampler().dispose();
        ch.dispose();
        dropped++;
      }
    }
  }
  return dropped;
}

async function optimize(io, src) {
  const dst = path.join(MODELS, path.relative(BUILD, src)).replace(/\.raw\.glb$/, '.glb');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const doc = await io.read(src);
  const dropped = stripStaticChannels(doc);
  await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(dst, doc);
  const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + 'KB';
  console.log(path.relative(ROOT, dst), kb(src), '->', kb(dst), dropped ? `(dropped ${dropped} static channels)` : '');
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder
});
const files = [
  ...fs.readdirSync(BUILD).map((f) => path.join(BUILD, f)),
  ...fs.readdirSync(path.join(BUILD, 'weapons')).map((f) => path.join(BUILD, 'weapons', f))
].filter((f) => f.endsWith('.raw.glb'));
// node scripts/optimize_models.mjs [name ...]: only those models (all of them by default)
const only = process.argv.slice(2);
for (const f of files) if (!only.length || only.some((n) => path.basename(f).startsWith(n + '.'))) await optimize(io, f);
