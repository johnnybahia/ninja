import * as THREE from 'three';
import type { GradeLook } from './postfx';

// ===========================================================================
// Atmospheres: complete lighting/sky/fog/grade presets for the temple. The world
// eases from one to the next over a few seconds when a wave changes.
// ===========================================================================

export interface Atmos {
  name: string;
  zenith: THREE.Color; // sky colors are linear HDR
  horizon: THREE.Color;
  sunGlow: THREE.Color; // sun (or moon) disc + halo
  sunDir: THREE.Vector3;
  stars: number;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunLight: THREE.Color;
  sunI: number;
  skyFill: THREE.Color;
  groundFill: THREE.Color;
  hemiI: number;
  front: THREE.Color;
  frontI: number;
  ridgeFar: THREE.Color;
  ridgeNear: THREE.Color;
  glow: number; // lantern emissive multiplier
  lantern: number; // lantern point light intensity
  shoji: number; // paper panel brightness
  fireflies: number;
  petals: number;
  exposure: number;
  mist: number; // low ground mist density 0..1
  look: GradeLook;
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const H = (hex: number) => new THREE.Color(hex);

export const ATMOSPHERES: Atmos[] = [
  {
    name: 'Entardecer',
    zenith: C(0.035, 0.03, 0.09),
    horizon: C(0.42, 0.22, 0.27),
    sunGlow: C(1.5, 0.62, 0.28),
    sunDir: new THREE.Vector3(-0.55, 0.16, -0.82).normalize(),
    stars: 0,
    fog: H(0x5a3a4c),
    fogNear: 26,
    fogFar: 118,
    sunLight: H(0xffa468),
    sunI: 2.6,
    skyFill: H(0x8c94c8),
    groundFill: H(0x3a2830),
    hemiI: 1.25,
    front: H(0x9aa6e0),
    frontI: 0.7,
    ridgeFar: C(0.1, 0.07, 0.14),
    ridgeNear: C(0.055, 0.04, 0.08),
    glow: 3,
    lantern: 5,
    shoji: 1,
    fireflies: 1,
    petals: 1,
    exposure: 1.05,
    mist: 0.35,
    look: { shadowTint: [0.88, 0.93, 1.12], highTint: [1.07, 1.0, 0.88], sat: 1.1, contrast: 1.07, vignette: 0.5, bloom: 0.55 }
  },
  {
    name: 'Noite de lua',
    zenith: C(0.006, 0.01, 0.035),
    horizon: C(0.05, 0.075, 0.15),
    sunGlow: C(0.75, 0.88, 1.25),
    sunDir: new THREE.Vector3(0.35, 0.42, -0.84).normalize(),
    stars: 1,
    fog: H(0x1a2034),
    fogNear: 18,
    fogFar: 100,
    sunLight: H(0x9fb4ff),
    sunI: 1.25,
    skyFill: H(0x3a4a80),
    groundFill: H(0x141422),
    hemiI: 1.0,
    front: H(0x6a78c0),
    frontI: 0.55,
    ridgeFar: C(0.03, 0.04, 0.08),
    ridgeNear: C(0.015, 0.02, 0.04),
    glow: 3.8,
    lantern: 9,
    shoji: 1.35,
    fireflies: 1.8,
    petals: 0.6,
    exposure: 1.1,
    mist: 0.45,
    look: { shadowTint: [0.82, 0.92, 1.22], highTint: [1.12, 1.0, 0.84], sat: 0.95, contrast: 1.1, vignette: 0.62, bloom: 0.8 }
  },
  {
    name: 'Amanhecer com névoa',
    zenith: C(0.16, 0.22, 0.36),
    horizon: C(0.82, 0.68, 0.6),
    sunGlow: C(1.7, 1.15, 0.72),
    sunDir: new THREE.Vector3(0.72, 0.12, -0.68).normalize(),
    stars: 0,
    fog: H(0xb4a6a6),
    fogNear: 6,
    fogFar: 72,
    sunLight: H(0xffd2a8),
    sunI: 2.3,
    skyFill: H(0xc8d0e8),
    groundFill: H(0x5a5048),
    hemiI: 1.45,
    front: H(0xc0c8e0),
    frontI: 0.6,
    ridgeFar: C(0.42, 0.4, 0.46),
    ridgeNear: C(0.3, 0.29, 0.34),
    glow: 1.6,
    lantern: 1.5,
    shoji: 0.7,
    fireflies: 0,
    petals: 1.3,
    exposure: 1.0,
    mist: 1,
    look: { shadowTint: [0.95, 0.97, 1.06], highTint: [1.05, 1.0, 0.93], sat: 0.92, contrast: 0.98, vignette: 0.4, bloom: 0.5 }
  }
];

export type AtmosMode = 'every' | 'two' | 'random';

// Which atmosphere a wave should use
export function atmosphereForWave(wave: number, mode: AtmosMode, current: number): number {
  const n = ATMOSPHERES.length;
  if (mode === 'every') return (wave - 1) % n;
  if (mode === 'two') return Math.floor((wave - 1) / 2) % n;
  if (wave <= 1) return current;
  let next = Math.floor(Math.random() * (n - 1));
  if (next >= current) next++;
  return next;
}

export function cloneAtmos(a: Atmos): Atmos {
  return {
    ...a,
    zenith: a.zenith.clone(),
    horizon: a.horizon.clone(),
    sunGlow: a.sunGlow.clone(),
    sunDir: a.sunDir.clone(),
    fog: a.fog.clone(),
    sunLight: a.sunLight.clone(),
    skyFill: a.skyFill.clone(),
    groundFill: a.groundFill.clone(),
    front: a.front.clone(),
    ridgeFar: a.ridgeFar.clone(),
    ridgeNear: a.ridgeNear.clone(),
    look: { ...a.look, shadowTint: [...a.look.shadowTint], highTint: [...a.look.highTint] }
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// Ease `cur` toward `to` by k (0..1). Returns true once everything is close enough.
export function blendAtmos(cur: Atmos, to: Atmos, k: number): boolean {
  cur.zenith.lerp(to.zenith, k);
  cur.horizon.lerp(to.horizon, k);
  cur.sunGlow.lerp(to.sunGlow, k);
  cur.sunDir.lerp(to.sunDir, k).normalize();
  cur.fog.lerp(to.fog, k);
  cur.sunLight.lerp(to.sunLight, k);
  cur.skyFill.lerp(to.skyFill, k);
  cur.groundFill.lerp(to.groundFill, k);
  cur.front.lerp(to.front, k);
  cur.ridgeFar.lerp(to.ridgeFar, k);
  cur.ridgeNear.lerp(to.ridgeNear, k);
  const nums: (keyof Atmos)[] = ['stars', 'fogNear', 'fogFar', 'sunI', 'hemiI', 'frontI', 'glow', 'lantern', 'shoji', 'fireflies', 'petals', 'exposure', 'mist'];
  let diff = 0;
  for (const key of nums) {
    const a = cur[key] as number;
    const b = to[key] as number;
    (cur[key] as number) = lerp(a, b, k);
    diff = Math.max(diff, Math.abs(b - a) / (Math.abs(b) + 1));
  }
  const L = cur.look;
  const T = to.look;
  for (let i = 0; i < 3; i++) {
    L.shadowTint[i] = lerp(L.shadowTint[i], T.shadowTint[i], k);
    L.highTint[i] = lerp(L.highTint[i], T.highTint[i], k);
  }
  L.sat = lerp(L.sat, T.sat, k);
  L.contrast = lerp(L.contrast, T.contrast, k);
  L.vignette = lerp(L.vignette, T.vignette, k);
  L.bloom = lerp(L.bloom, T.bloom, k);
  diff = Math.max(diff, Math.abs(cur.fog.r - to.fog.r) + Math.abs(cur.zenith.b - to.zenith.b));
  return diff < 0.002;
}
