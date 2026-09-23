import * as THREE from 'three';
import { WeaponDef, SpecialDef, KarateMove } from './types';

export const TAU = Math.PI * 2;
export const R_ARENA = 40;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const wrap = (a: number) => {
  let res = a;
  while (res > Math.PI) res -= TAU;
  while (res < -Math.PI) res += TAU;
  return res;
};
export const turnTo = (a: number, b: number, k: number) => a + wrap(b - a) * Math.min(1, k);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const WEAPONS_KAGE: WeaponDef[] = [
  { id: 'katana', name: 'Katana', glyph: '刀', kind: 'melee', dmg: [22, 22, 42], range: 2.9, arc: 2.1, cd: 0.28, kb: 4, anim: 'slash', dur: 0.24 },
  { id: 'bo', name: 'Bō', glyph: '棒', kind: 'melee', dmg: [20], range: 3.5, arc: TAU, cd: 0.62, kb: 10, anim: 'spin', dur: 0.42 },
  { id: 'kama', name: 'Kusarigama', glyph: '鎌', kind: 'chain', dmg: [26], range: 6.5, arc: 1.15, cd: 0.55, kb: -7, anim: 'chain', dur: 0.32 },
  { id: 'shuriken', name: 'Shuriken', glyph: '星', kind: 'proj', dmg: [12], cd: 0.38, count: 3, spread: 0.2, speed: 30, anim: 'throw', dur: 0.22 },
  { id: 'kunai', name: 'Kunai', glyph: '苦', kind: 'proj', dmg: [32], cd: 0.34, count: 1, spread: 0, speed: 42, pierce: true, anim: 'throw', dur: 0.2 },
  { id: 'bomb', name: 'Bomba', glyph: '爆', kind: 'bomb', dmg: [55], cd: 1.2, stamina: 25, anim: 'throw', dur: 0.3 },
  { id: 'karate', name: 'Karatê', glyph: '空', kind: 'karate', dmg: [14], cd: 0.2 }
];

export const WEAPONS_BRAVO: WeaponDef[] = [
  { id: 'knife', name: 'Faca', glyph: '刃', kind: 'melee', dmg: [16], range: 2.2, arc: 2.0, cd: 0.3, kb: 4, anim: 'slash', dur: 0.18, pointMult: 1.6 },
  { id: 'pistol', name: 'Pistola', glyph: 'P', kind: 'proj', dmg: [15], cd: 0.24, dur: 0.1, count: 1, spread: 0, speed: 55, life: 0.9, gun: true, pointMult: 1.45 },
  { id: 'shotgun', name: 'Espingarda', glyph: 'E', kind: 'proj', dmg: [8], cd: 0.85, dur: 0.18, count: 7, spread: 0.32, speed: 40, life: 0.22, gun: true, pointMult: 1.1 },
  { id: 'rifle', name: 'Fuzil', glyph: 'F', kind: 'proj', dmg: [8], cd: 0.09, dur: 0.09, count: 1, spread: 0.03, speed: 58, life: 1.1, gun: true, pointMult: 0.85 },
  { id: 'flame', name: 'Lança-chamas', glyph: '焔', kind: 'flame', dmg: [7], range: 4.6, arc: 1.3, cd: 0.09, stCost: 3, pointMult: 0.7 },
  { id: 'minigun', name: 'Metralhadora', glyph: 'M', kind: 'proj', dmg: [7], cd: 0.08, dur: 0.08, count: 1, spread: 0.09, speed: 65, life: 1.0, gun: true, spin: true, cdBase: 0.4, cdMin: 0.045, pointMult: 0.5 },
  { id: 'bazooka', name: 'M45', glyph: 'B', kind: 'bomb', dmg: [90], cd: 1.3, dur: 0.22, gun: true, rocket: true, pointMult: 0.35 }
];

export const SPECIALS: Record<string, SpecialDef> = {
  katana: { name: 'Corte do Vento', cd: 0.5 },
  bo: { name: 'Tornado', cd: 1.8 },
  kama: { name: 'Ceifa', cd: 0.75 },
  shuriken: { name: 'Chuva de Estrelas', cd: 0.7 },
  kunai: { name: 'Relâmpago', cd: 0.8 },
  bomb: { name: 'Chuva de Fogo', cd: 1.4 },
  karate: { name: 'Punho do Dragão', cd: 1.0 },
  knife: { name: 'Retalho Relâmpago', cd: 0.6 },
  pistol: { name: 'Duplo Cano', cd: 0.5 },
  shotgun: { name: 'Rajada Dupla', cd: 0.9 },
  rifle: { name: 'Fogo Supressivo', cd: 1.8 },
  flame: { name: 'Parede de Fogo', cd: 1.2 },
  minigun: { name: 'Chuva de Chumbo', cd: 1.0 },
  bazooka: { name: 'Bombardeio Aéreo', cd: 1.6 }
};

export const KARATE: KarateMove[] = [
  { name: 'Oi-zuki', range: 2.0, arc: 1.25, dmg: 14, kb: 3, cd: 0.18, dur: 0.16, anim: 'punchR', lunge: 0.35 },
  { name: 'Gyaku-zuki', range: 2.0, arc: 1.25, dmg: 18, kb: 4, cd: 0.2, dur: 0.18, anim: 'punchL', lunge: 0.35 },
  { name: 'Mae-geri', range: 2.6, arc: 1.05, dmg: 22, kb: 9, cd: 0.3, dur: 0.28, anim: 'frontKick', lunge: 0.5 },
  { name: 'Mawashi-geri', range: 2.8, arc: 3.0, dmg: 32, kb: 11, cd: 0.45, dur: 0.38, anim: 'roundKick', lunge: 0.3, heavy: true }
];

export const WORLD_PAL = {
  ninja: {
    sky: 0x3b2b4f, fogFar: 85, ground: 0x55603f, stone: 0x7a7064, stoneDark: 0x564e47,
    wood: 0x6b3a2a, roof: 0x2f2a33, torii: 0xb8392f, trunk: 0x4a3326, pine: 0x2f4a36,
    sakura: 0xe3a3b8, glow: 0xffc070, sun: 0xffb27a, sunI: 0.95, sunDisc: 0xffc98a,
    hemiSky: 0xffd6b0, hemiGround: 0x2a2040
  },
  doom: {
    sky: 0x1c0d0a, fogFar: 62, ground: 0x2a231d, stone: 0x4a4038, stoneDark: 0x2e2823,
    wood: 0x4a3226, roof: 0x140f0d, torii: 0x6b2318, trunk: 0x36281e, pine: 0x2a2822,
    sakura: 0x59403a, glow: 0xff5a20, sun: 0xff5a30, sunI: 0.65, sunDisc: 0xff3a18,
    hemiSky: 0xff6a3a, hemiGround: 0x140806
  }
};
