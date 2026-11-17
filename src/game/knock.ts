import type { EnemyInstance } from './types';

// ===========================================================================
// Weight of a blow: how much a foe is moved by it, how long the two bodies hang on contact, and what
// the weapon throws off where it touches. Numbers only - engine.ts decides when to call these.
// ===========================================================================

/** How hard a foe is to move (1 = a plain samurai). Knockback is divided by it. */
export function massOf(e: EnemyInstance): number {
  if (e.type === 'boss') return 5;
  if (e.variant === 'brute') return 2.2;
  if (e.variant === 'ashigaru') return 0.7;
  if (e.type === 'archer') return 0.9;
  return e.elite ? 1.3 : 1;
}

/**
 * Knockback as a punch rather than a drift: a heavy blow starts faster and stops sooner (a sharp throw
 * that lands) where a light one is gentler and slides. Distance stays about what `kb` always gave
 * (v / k), so the balance of the fights does not move.
 */
export function knockShape(e: EnemyInstance, kb: number, heavy: boolean): { v: number; k: number } {
  const m = massOf(e);
  const scale = Math.min(1.6, 1 / m);
  return heavy ? { v: kb * 1.3 * scale, k: 7.8 + m * 0.4 } : { v: kb * scale, k: 6 + m * 0.3 };
}

/** The hang on contact by weapon (multiplies the usual 0.05-0.09 s): a staff or a heavy cut sticks, a thrown star does not. */
export const HIT_PAUSE: Record<string, number> = { katana: 1, bo: 1.3, kama: 0.8, karate: 0.9, shuriken: 0.4, kunai: 0.6, bomb: 0 };

/** Where the blade was when it touched, and how fast it travelled (m/s, from its path over the frame) */
export interface BladeContact {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  speed: number;
}

interface SparkSink {
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, grav: number, r: number, g: number, b: number, alpha: number, width: number, rest?: number): void;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Look {
  steel: number; // sparks drawn along the blade, as many as this
  debris: number; // slower chips (wood, dust) at the contact point
  col: [number, number, number]; // HDR colour of the sparks
  debrisCol: [number, number, number];
  width: number;
}

// What each weapon throws off where it touches a body
const LOOK: Record<string, Look> = {
  katana: { steel: 12, debris: 0, col: [2.7, 2.3, 1.5], debrisCol: [1, 1, 1], width: 0.028 },
  bo: { steel: 0, debris: 11, col: [1.7, 1.2, 0.7], debrisCol: [1.5, 1.05, 0.6], width: 0.05 },
  kama: { steel: 7, debris: 2, col: [2.3, 2.3, 2.6], debrisCol: [0.9, 0.9, 1], width: 0.03 },
  karate: { steel: 2, debris: 7, col: [2.2, 2.2, 2.4], debrisCol: [1.1, 1.0, 0.9], width: 0.045 }
};

/**
 * Sparks that really come off the blade: spread along the stretch of it that was inside the body,
 * flung the way it was travelling (a faster swing throws them farther), a few as slower, heavier
 * embers. Wood throws pale chips instead, fists a little dust and a flash of white.
 * `power` 1 is a plain hit; heavy blows and criticals pass more.
 */
export function bladeContactFx(sparks: SparkSink, weaponId: string, px: number, py: number, pz: number, dirX: number, dirZ: number, blade: BladeContact, power: number, share = 1) {
  const q = Math.max(0.35, Math.min(1, share));
  const look = LOOK[weaponId] ?? LOOK.katana;
  const sp = Math.min(26, Math.max(5, blade.speed));
  // the blade's own direction: base -> tip, so sparks leave along the edge, not out of one point
  let ex = blade.bx - blade.ax;
  let ey = blade.by - blade.ay;
  let ez = blade.bz - blade.az;
  const el = Math.hypot(ex, ey, ez);
  if (el > 1e-3) {
    ex /= el;
    ey /= el;
    ez /= el;
  } else {
    ex = ey = ez = 0;
  }
  const n = Math.round(look.steel * (0.7 + 0.5 * power) * q);
  for (let i = 0; i < n; i++) {
    // along the blade, around the contact point, mostly toward the tip
    const t = rnd(-0.12, 0.55) * Math.min(el, 1.6);
    const x = px + ex * t;
    const y = py + ey * t;
    const z = pz + ez * t;
    const s = sp * rnd(0.3, 0.75);
    // thrown along the travel, fanned a little and lifted
    const fan = rnd(-0.45, 0.45);
    const vx = dirX * s + -dirZ * fan * s * 0.6 + rnd(-0.8, 0.8);
    const vz = dirZ * s + dirX * fan * s * 0.6 + rnd(-0.8, 0.8);
    const k = rnd(0.75, 1.15);
    sparks.emit(x, y, z, vx, rnd(0.5, 3.2) + ey * s * 0.3, vz, rnd(0.18, 0.42), 14, look.col[0] * k, look.col[1] * k, look.col[2] * k, 1, look.width * rnd(0.8, 1.3), 0.15);
  }
  // heavier embers that fall instead of flying: the glowing bits of a good hit
  if (look.steel && power > 1.2) {
    for (let i = 0; i < 3; i++) sparks.emit(px, py, pz, dirX * rnd(0.5, 2) + rnd(-0.6, 0.6), rnd(1, 3), dirZ * rnd(0.5, 2) + rnd(-0.6, 0.6), rnd(0.6, 1.0), 9, 2.4, 1.3, 0.45, 1, 0.035);
  }
  const d = Math.round(look.debris * (0.7 + 0.5 * power) * q);
  for (let i = 0; i < d; i++) {
    const s = rnd(1.2, 5.2);
    const a = rnd(0, Math.PI * 2);
    const c = rnd(0.7, 1.15);
    sparks.emit(px, py, pz, dirX * s * 0.7 + Math.cos(a) * s * 0.45, rnd(1.2, 4), dirZ * s * 0.7 + Math.sin(a) * s * 0.45, rnd(0.35, 0.7), 16, look.debrisCol[0] * c, look.debrisCol[1] * c, look.debrisCol[2] * c, 1, look.width * rnd(0.9, 1.5), 0.35);
  }
}
