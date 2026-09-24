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

// Arsenal screen: role tag + one-line description per weapon id
export const WEAPON_INFO: Record<string, { tag: string; desc: string }> = {
  katana: { tag: 'Corpo a corpo', desc: 'Cortes rápidos em arco; o 3º golpe da sequência causa quase o dobro de dano.' },
  bo: { tag: 'Corpo a corpo · 360°', desc: 'Giro que atinge e empurra todos ao redor. Lento, ótimo quando cercado.' },
  kama: { tag: 'Médio alcance', desc: 'Corrente longa que puxa o inimigo até você.' },
  shuriken: { tag: 'Distância', desc: 'Três estrelas em leque. Cobre uma área larga, dano baixo por estrela.' },
  kunai: { tag: 'Distância', desc: 'Lâmina rápida e forte que atravessa vários inimigos em linha.' },
  bomb: { tag: 'Explosivo · Área', desc: 'Explosão com dano alto em área. Consome vigor.' },
  karate: { tag: 'Corpo a corpo', desc: 'Sequência de socos e chutes com avanço; fecha com um chute pesado.' }
};

// Special damage is tuned to roughly 2x the weapon's own normal DPS (about 1.5x when a
// single-target weapon's special becomes an area attack), so every pick is worth a scroll.
export const SPECIALS: Record<string, SpecialDef> = {
  katana: { name: 'Corte do Vento', cd: 0.5 },
  bo: { name: 'Tornado', cd: 1.8 },
  kama: { name: 'Ceifa', cd: 0.7 },
  shuriken: { name: 'Chuva de Estrelas', cd: 0.7 },
  kunai: { name: 'Relâmpago', cd: 0.8 },
  bomb: { name: 'Chuva de Fogo', cd: 1.4 },
  karate: { name: 'Punho do Dragão', cd: 1.0 }
};

export const KARATE: KarateMove[] = [
  { name: 'Oi-zuki', range: 2.0, arc: 1.25, dmg: 14, kb: 3, cd: 0.18, dur: 0.16, anim: 'punchR', lunge: 0.35 },
  { name: 'Gyaku-zuki', range: 2.0, arc: 1.25, dmg: 18, kb: 4, cd: 0.2, dur: 0.18, anim: 'punchL', lunge: 0.35 },
  { name: 'Mae-geri', range: 2.6, arc: 1.05, dmg: 22, kb: 9, cd: 0.3, dur: 0.28, anim: 'frontKick', lunge: 0.5 },
  { name: 'Mawashi-geri', range: 2.8, arc: 3.0, dmg: 32, kb: 11, cd: 0.45, dur: 0.38, anim: 'roundKick', lunge: 0.3, heavy: true }
];
