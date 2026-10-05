import * as THREE from 'three';
import { makeRng } from './shapes';

// ===========================================================================
// The plaza floor: stone inlays (a rim ring and an eight-spoke wheel at the centre, drawn
// analytically so they stay crisp at any distance) plus a layer that follows the season - snow
// settling in the joints of the cobbles, drifts of fallen leaves, embers glowing in the cracks.
// It extends the cobble material built by applySurface (surfaces.ts) and reads what that code
// leaves in scope: `vSurfPos` (world position) and `sAlb`/`uSurfGain` (the albedo sample, whose
// dark values are the joints). Nothing here is a draw call or a light: it is a few more
// instructions in a shader that already runs.
// ===========================================================================

export interface PlazaUniforms {
  time: { value: number }; // seconds, shared with the wind clock
  snow: { value: number }; // 0..1 cover, driven by the theme
  leaf: { value: number };
  ember: { value: number };
  fx: { value: number }; // 0 low (inlay and a flat snow tint only), ~0.5 medium, 1 high
}

export function plazaUniforms(time: { value: number }): PlazaUniforms {
  return { time, snow: { value: 0 }, leaf: { value: 0 }, ember: { value: 0 }, fx: { value: 1 } };
}

// 128x128 tileable value noise, one lattice size per channel (4, 8, 16 and 32 cells per tile)
let noiseTex: THREE.DataTexture | null = null;
function plazaNoise() {
  if (noiseTex) return noiseTex;
  const N = 128;
  const rng = makeRng(90210);
  const data = new Uint8Array(N * N * 4);
  [4, 8, 16, 32].forEach((cells, ch) => {
    const g = new Float32Array(cells * cells).map(() => rng());
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const fy = (y / N) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const xa = x0 % cells;
        const xb = (x0 + 1) % cells;
        const ya = y0 % cells;
        const yb = (y0 + 1) % cells;
        const top = g[ya * cells + xa] + (g[ya * cells + xb] - g[ya * cells + xa]) * sx;
        const bot = g[yb * cells + xa] + (g[yb * cells + xb] - g[yb * cells + xa]) * sx;
        data[(y * N + x) * 4 + ch] = Math.round((top + (bot - top) * sy) * 255);
      }
    }
  });
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

const PARS = /* glsl */ `
uniform sampler2D tPzNoise;
uniform float uPzTime;
uniform float uPzSnow;
uniform float uPzLeaf;
uniform float uPzEmber;
uniform float uPzFx;
float pzHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pzRing(float r, float c, float w) { return 1.0 - smoothstep(w * 0.55, w, abs(r - c)); }
// One fallen leaf per cell (or none): an ellipse with a random heading, colour and spot in its cell
float pzLeaf(vec2 p, float cell, vec2 off, out vec3 col) {
  vec2 q = (p + off) / cell;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  float h1 = pzHash(id);
  float h2 = pzHash(id + 17.3);
  float h3 = pzHash(id + 41.7);
  float h4 = pzHash(id + 7.7);
  float h5 = pzHash(id + 3.1);
  vec2 d = f - (vec2(h2, h3) - 0.5) * 0.3;
  float a = h1 * 6.2831;
  vec2 r = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
  // a lens, pointed at both ends, in one of a few sizes
  float len = 0.15 + 0.14 * h2;
  float u = r.x / len;
  float e = max(abs(u), abs(r.y) / ((0.045 + 0.06 * h3) * sqrt(max(1.0 - u * u, 0.0)) + 0.0001));
  col = h5 < 0.28 ? vec3(0.60, 0.19, 0.05) : h5 < 0.52 ? vec3(0.46, 0.07, 0.03) : h5 < 0.78 ? vec3(0.58, 0.34, 0.06) : vec3(0.19, 0.095, 0.04);
  col *= 0.8 + 0.4 * h2;
  return (1.0 - smoothstep(0.8, 1.0, e)) * step(h4 * 0.5 + 0.0001, uPzLeaf * 0.5);
}
`;

// colour, roughness and the leaf/snow/inlay layers: after the surface albedo and before lighting
const BODY = /* glsl */ `
float pzFlat = 0.0;
float pzCrack = 0.0;
vec4 pzNa = vec4(0.5);
{
  vec2 pzP = vSurfPos.xz;
  float pzR = length(pzP);
  vec3 pzCol = diffuseColor.rgb;
  float pzL = dot(pzCol, vec3(0.3333));

  // inlay: a ring near the edge, a fine line inside it, and a wheel of eight spokes at the centre
  float pzInl = pzRing(pzR, 11.55, 0.17);
  pzInl = max(pzInl, pzRing(pzR, 11.0, 0.06) * 0.85);
  pzInl = max(pzInl, pzRing(pzR, 2.6, 0.13));
  pzInl = max(pzInl, pzRing(pzR, 0.55, 0.1));
  float pzSpoke = abs(sin(atan(pzP.y, pzP.x + 0.0001) * 4.0)) * pzR * 0.25;
  pzInl = max(pzInl, (1.0 - smoothstep(0.05, 0.09, pzSpoke)) * step(0.6, pzR) * (1.0 - step(2.55, pzR)));

  float pzGap = 1.0 - smoothstep(0.35, 0.85, dot(sAlb, vec3(0.3333)) * uSurfGain);
  float pzS = 0.0;
  if (uPzFx > 0.01) {
    pzNa = texture2D(tPzNoise, pzP * 0.045);
    vec4 pzNb = texture2D(tPzNoise, pzP * 0.5 + 0.13);
    // broad patches of cleaner and dirtier stone, moss where the joints hold water
    pzCol *= 0.84 + 0.32 * (pzNa.r * 0.6 + pzNa.g * 0.4);
    float pzMoss = pzGap * smoothstep(0.45, 0.8, pzNa.g) * (1.0 - uPzSnow) * (1.0 - uPzEmber);
    pzCol = mix(pzCol, pzCol * vec3(0.72, 1.18, 0.66), pzMoss * 0.6);
    // polished stone inlay
    pzCol = mix(pzCol, vec3(pzL * 1.9 + 0.012), pzInl * 0.8);
    // snow: the joints first, then the tops of the stones in patches
    pzS = uPzSnow * (0.3 + 0.85 * pzGap + 0.9 * (pzNa.r - 0.5) + 0.5 * (pzNb.b - 0.5));
    pzS = smoothstep(0.3, 0.62, pzS);
    pzCol = mix(pzCol, vec3(0.8, 0.86, 0.95) * (0.9 + 0.2 * pzNb.a), pzS);
    roughnessFactor = mix(roughnessFactor, 0.92, pzS);
    // ember cracks: some joints run hot
    pzCrack = pzGap * smoothstep(0.58, 0.8, texture2D(tPzNoise, pzP * 0.11 + 0.37).b) * uPzEmber;
    pzCol *= 1.0 - 0.35 * uPzEmber * (1.0 - pzCrack);
    // fallen leaves, two offset layers on high
    vec3 pzLc;
    float pzLm = pzLeaf(pzP, 0.62, vec2(0.0), pzLc);
    pzCol = mix(pzCol, pzLc, pzLm * 0.92);
    if (uPzFx > 0.75) {
      float pzLm2 = pzLeaf(pzP, 0.62, vec2(0.31, 0.47), pzLc);
      pzCol = mix(pzCol, pzLc, pzLm2 * 0.92);
      pzLm = max(pzLm, pzLm2);
    }
    pzFlat = max(pzS * 0.8, pzLm * 0.5);
  } else {
    pzCol = mix(pzCol, vec3(pzL * 1.9 + 0.012), pzInl * 0.8);
    pzCol = mix(pzCol, vec3(0.8, 0.86, 0.95), uPzSnow * 0.55);
  }
  pzCol *= 1.0 - 0.1 * smoothstep(11.55, 11.7, pzR);
  pzFlat = max(pzFlat, pzInl * 0.85);
  roughnessFactor = mix(roughnessFactor, 0.5, pzInl * 0.6);
  diffuseColor.rgb = pzCol;
}
`;

// normals flattened under snow, leaves and inlay; the cracks' glow
const TAIL = /* glsl */ `
normal = normalize(mix(normal, normalize(vNormal), pzFlat));
totalEmissiveRadiance += vec3(1.9, 0.5, 0.1) * pzCrack * (0.6 + 0.4 * sin(uPzTime * 1.7 + pzNa.g * 9.0));
`;

/** Call after applySurface(mat, 'cobble', { mode: 'top', ... }): the shader reads what it leaves in scope. */
export function addPlazaFx(mat: THREE.MeshStandardMaterial, u: PlazaUniforms) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.tPzNoise = { value: plazaNoise() };
    shader.uniforms.uPzTime = u.time;
    shader.uniforms.uPzSnow = u.snow;
    shader.uniforms.uPzLeaf = u.leaf;
    shader.uniforms.uPzEmber = u.ember;
    shader.uniforms.uPzFx = u.fx;
    shader.fragmentShader = PARS + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${BODY}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${TAIL}`);
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '|plaza';
  mat.needsUpdate = true;
  return mat;
}
