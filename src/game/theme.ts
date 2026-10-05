import * as THREE from 'three';

// ===========================================================================
// Scenery themes: the same arena dressed for another season. The layout (and so every
// collision, prop and AI path) never changes; a theme only tints the foliage, grass, ground
// and distant hills, thins the leaves, hides the lilies and swaps what falls from the sky.
// It eases in over a few seconds when a new one starts (see World.setTheme).
// ===========================================================================

export type ThemeMode = 'three' | 'off';

interface Tint {
  color: THREE.Color;
  k: number; // 0 = untouched .. 1 = fully this colour (kept lit by the original's brightness)
}

/** HSL ranges of the leaves/needles that fly off a cut or shaken tree */
export interface LeafLook {
  h: number;
  hv: number;
  s0: number;
  s1: number;
  l0: number;
  l1: number;
}

export interface ThemeLeaf {
  sakura: LeafLook;
  green: LeafLook;
  shed: number; // share of the usual leaf count that lets go (bare trees have little to lose)
}

export interface Theme {
  name: string;
  glyph: string;
  sakura: Tint & { bare: number; glow: number }; // bare: share of leaf cards that are gone
  pine: Tint & { bare: number; glow: number };
  grass: Tint;
  carpet: Tint; // fallen petals on the ground
  ground: Tint;
  forest: Tint; // distant conifers
  ridge: Tint; // mountains
  flowers: number; // 0 none .. 1 all of the lilies
  cover: { snow: number; leaf: number; ember: number }; // what settles on the plaza stones (plaza.ts), 0..1 each
  fall: {
    color: THREE.Color;
    emissive: THREE.Color;
    size: number;
    speed: number; // fall speed
    drift: number; // sideways wind push
    mul: number; // amount, times the atmosphere's own petal factor
    min: number; // ...but never below this
  };
  leaf: ThemeLeaf;
}

const C = (hex: number) => new THREE.Color(hex);
const tint = (hex: number, k: number): Tint => ({ color: C(hex), k });

const SAKURA_LEAF: ThemeLeaf = {
  sakura: { h: 0.95, hv: 0.02, s0: 0.2, s1: 0.45, l0: 0.8, l1: 0.94 },
  green: { h: 0.3, hv: 0.03, s0: 0.35, s1: 0.55, l0: 0.28, l1: 0.42 },
  shed: 1
};

export const THEMES: Theme[] = [
  {
    name: 'Sakura',
    glyph: '桜',
    sakura: { ...tint(0xffffff, 0), bare: 0, glow: 0.06 },
    pine: { ...tint(0xffffff, 0), bare: 0, glow: 0.06 },
    grass: tint(0xffffff, 0),
    carpet: tint(0xffffff, 0),
    ground: tint(0xffffff, 0),
    forest: tint(0xffffff, 0),
    ridge: tint(0xffffff, 0),
    flowers: 1,
    cover: { snow: 0, leaf: 0, ember: 0 },
    fall: { color: C(0xf7bccb), emissive: C(0x4a1e2a), size: 1, speed: 1, drift: 1, mul: 1, min: 0 },
    leaf: SAKURA_LEAF
  },
  {
    name: 'Outono',
    glyph: '紅葉',
    sakura: { ...tint(0xd2551a, 0.88), bare: 0, glow: 0.05 },
    pine: { ...tint(0x9a8a2a, 0.3), bare: 0, glow: 0.04 },
    grass: tint(0xb4983c, 0.6),
    carpet: tint(0xd2691e, 0.92),
    ground: tint(0x4a2a14, 0.5),
    forest: tint(0x4a3418, 0.55),
    ridge: tint(0x8a4a24, 0.28),
    flowers: 1,
    cover: { snow: 0, leaf: 0.7, ember: 0 },
    fall: { color: C(0xe0762a), emissive: C(0x3a1204), size: 1.55, speed: 1.15, drift: 1.35, mul: 1.4, min: 0.55 },
    leaf: {
      sakura: { h: 0.06, hv: 0.035, s0: 0.7, s1: 0.9, l0: 0.38, l1: 0.55 },
      green: { h: 0.16, hv: 0.05, s0: 0.45, s1: 0.65, l0: 0.28, l1: 0.42 },
      shed: 1
    }
  },
  {
    name: 'Inverno',
    glyph: '雪',
    sakura: { ...tint(0xe8eef6, 0.92), bare: 0.9, glow: 0.04 },
    pine: { ...tint(0xdde8f0, 0.6), bare: 0, glow: 0.03 },
    grass: tint(0xdbe5ee, 0.82),
    carpet: tint(0xffffff, 0.95),
    ground: tint(0xe4ebf3, 0.88),
    forest: tint(0xa4b2c0, 0.65),
    ridge: tint(0xd2dce8, 0.6),
    flowers: 0,
    cover: { snow: 0.9, leaf: 0, ember: 0 },
    fall: { color: C(0xffffff), emissive: C(0x303a4c), size: 0.8, speed: 0.55, drift: 0.35, mul: 1.7, min: 0.95 },
    leaf: {
      sakura: { h: 0.6, hv: 0.03, s0: 0.05, s1: 0.14, l0: 0.88, l1: 0.97 },
      green: { h: 0.58, hv: 0.03, s0: 0.05, s1: 0.12, l0: 0.84, l1: 0.95 },
      shed: 0.3
    }
  },
  {
    name: 'Brasas',
    glyph: '炎',
    sakura: { ...tint(0x7a1c0c, 0.85), bare: 0.4, glow: 0.4 },
    pine: { ...tint(0x1c1210, 0.82), bare: 0.2, glow: 0.05 },
    grass: tint(0x4a2012, 0.75),
    carpet: tint(0x2c1812, 0.92),
    ground: tint(0x2a1812, 0.8),
    forest: tint(0x301412, 0.72),
    ridge: tint(0x6a2410, 0.5),
    flowers: 1,
    cover: { snow: 0, leaf: 0, ember: 1 },
    fall: { color: C(0xff7a22), emissive: new THREE.Color(2.6, 0.8, 0.2), size: 0.65, speed: 0.55, drift: 0.8, mul: 1.3, min: 0.8 },
    leaf: {
      sakura: { h: 0.02, hv: 0.02, s0: 0.5, s1: 0.8, l0: 0.08, l1: 0.18 },
      green: { h: 0.02, hv: 0.02, s0: 0.3, s1: 0.5, l0: 0.06, l1: 0.14 },
      shed: 0.8
    }
  }
];

/** Which theme a wave belongs to: a new one every 3 waves (always the first when off). */
export function themeForWave(wave: number, mode: ThemeMode): number {
  return mode === 'off' ? 0 : Math.floor(Math.max(0, wave - 1) / 3) % THEMES.length;
}

const cloneTint = (t: Tint): Tint => ({ color: t.color.clone(), k: t.k });
const cloneLeaf = (l: LeafLook): LeafLook => ({ ...l });

export function cloneTheme(t: Theme): Theme {
  return {
    ...t,
    sakura: { ...cloneTint(t.sakura), bare: t.sakura.bare, glow: t.sakura.glow },
    pine: { ...cloneTint(t.pine), bare: t.pine.bare, glow: t.pine.glow },
    grass: cloneTint(t.grass),
    carpet: cloneTint(t.carpet),
    ground: cloneTint(t.ground),
    forest: cloneTint(t.forest),
    ridge: cloneTint(t.ridge),
    cover: { ...t.cover },
    fall: { ...t.fall, color: t.fall.color.clone(), emissive: t.fall.emissive.clone() },
    leaf: { sakura: cloneLeaf(t.leaf.sakura), green: cloneLeaf(t.leaf.green), shed: t.leaf.shed }
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function blendTint(c: Tint, t: Tint, k: number) {
  c.color.lerp(t.color, k);
  c.k = lerp(c.k, t.k, k);
}

function blendLeaf(c: LeafLook, t: LeafLook, k: number) {
  c.h = lerp(c.h, t.h, k);
  c.hv = lerp(c.hv, t.hv, k);
  c.s0 = lerp(c.s0, t.s0, k);
  c.s1 = lerp(c.s1, t.s1, k);
  c.l0 = lerp(c.l0, t.l0, k);
  c.l1 = lerp(c.l1, t.l1, k);
}

// Ease `cur` toward `to` by k (0..1) in place (shaders and props hold references to it).
// Returns true once it is close enough to stop.
export function blendTheme(cur: Theme, to: Theme, k: number): boolean {
  blendTint(cur.sakura, to.sakura, k);
  blendTint(cur.pine, to.pine, k);
  blendTint(cur.grass, to.grass, k);
  blendTint(cur.carpet, to.carpet, k);
  blendTint(cur.ground, to.ground, k);
  blendTint(cur.forest, to.forest, k);
  blendTint(cur.ridge, to.ridge, k);
  cur.sakura.bare = lerp(cur.sakura.bare, to.sakura.bare, k);
  cur.sakura.glow = lerp(cur.sakura.glow, to.sakura.glow, k);
  cur.pine.bare = lerp(cur.pine.bare, to.pine.bare, k);
  cur.pine.glow = lerp(cur.pine.glow, to.pine.glow, k);
  cur.flowers = lerp(cur.flowers, to.flowers, k);
  cur.cover.snow = lerp(cur.cover.snow, to.cover.snow, k);
  cur.cover.leaf = lerp(cur.cover.leaf, to.cover.leaf, k);
  cur.cover.ember = lerp(cur.cover.ember, to.cover.ember, k);
  const f = cur.fall;
  const g = to.fall;
  f.color.lerp(g.color, k);
  f.emissive.lerp(g.emissive, k);
  f.size = lerp(f.size, g.size, k);
  f.speed = lerp(f.speed, g.speed, k);
  f.drift = lerp(f.drift, g.drift, k);
  f.mul = lerp(f.mul, g.mul, k);
  f.min = lerp(f.min, g.min, k);
  blendLeaf(cur.leaf.sakura, to.leaf.sakura, k);
  blendLeaf(cur.leaf.green, to.leaf.green, k);
  cur.leaf.shed = lerp(cur.leaf.shed, to.leaf.shed, k);
  const diff =
    Math.abs(cur.sakura.k - to.sakura.k) +
    Math.abs(cur.sakura.bare - to.sakura.bare) +
    Math.abs(cur.ground.k - to.ground.k) +
    Math.abs(cur.grass.k - to.grass.k) +
    Math.abs(cur.flowers - to.flowers) +
    Math.abs(cur.cover.snow - to.cover.snow) +
    Math.abs(cur.cover.leaf - to.cover.leaf) +
    Math.abs(cur.cover.ember - to.cover.ember) +
    Math.abs(cur.ground.color.r - to.ground.color.r) +
    Math.abs(cur.fall.size - to.fall.size);
  return diff < 0.004;
}

// ---------------------------------------------------------------------------
// Shader hook
// ---------------------------------------------------------------------------
export interface ThemeUniforms {
  uThTint: { value: THREE.Color };
  uThK: { value: number };
  uThBare: { value: number };
  uThEmis: { value: number };
}

export const themeUniforms = (): ThemeUniforms => ({
  uThTint: { value: new THREE.Color(1, 1, 1) },
  uThK: { value: 0 },
  uThBare: { value: 0 },
  uThEmis: { value: 0.06 }
});

/**
 * Lets a material take a theme: its colour is mixed toward `uThTint` (keeping the original's
 * light and dark), and a share `uThBare` of its pieces - leaf cards, or instances - is
 * dropped. Call it after the material's other shader hooks and cache key are set.
 */
export function addThemeTint(mat: THREE.Material, u: ThemeUniforms, pieces: 'card' | 'instance' | null) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  const id = pieces === 'card' ? 'float(gl_VertexID / 4)' : pieces === 'instance' ? 'float(gl_InstanceID)' : '0.5';
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uThTint = u.uThTint;
    shader.uniforms.uThK = u.uThK;
    shader.uniforms.uThBare = u.uThBare;
    shader.uniforms.uThEmis = u.uThEmis;
    shader.vertexShader =
      'varying float vThH;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vThH = fract(sin(${id} * 12.9898 + 4.1) * 43758.5453);`
      );
    shader.fragmentShader =
      'varying float vThH;\nuniform vec3 uThTint;\nuniform float uThK;\nuniform float uThBare;\nuniform float uThEmis;\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vThH < uThBare) discard;
          float thL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, uThTint * (0.25 + thL * 1.6), uThK);`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance = mix(totalEmissiveRadiance, uThTint * uThEmis, uThK);`
        );
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '-th' + pieces;
}
