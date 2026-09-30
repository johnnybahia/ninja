import * as THREE from 'three';

// ===========================================================================
// Geometry for blade-accurate hits (see engine.ts stepHitWindows / stepEnemyBlade).
//
// A swing is not a cone around the attacker: it is a blade segment moving through space
// over the move's few active frames. Each frame the segment (and, between frames, its
// interpolated positions) is tested against the target's body - a vertical capsule - and
// the first touch gives the true contact point for sparks and blood.
// ===========================================================================

const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const rr = new THREE.Vector3();
const segA = new THREE.Vector3();
const segB = new THREE.Vector3();
const c1 = new THREE.Vector3();
const c2 = new THREE.Vector3();
const cbA = new THREE.Vector3();
const cbB = new THREE.Vector3();
const dP = new THREE.Vector3();
const dC = new THREE.Vector3();

const EPS = 1e-8;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision
 *  Detection 5.1.9): fills a on the first, b on the second, returns the squared distance. */
export function closestSegSeg(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3
): number {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  rr.subVectors(p1, p2);
  const A = d1.dot(d1);
  const E = d2.dot(d2);
  const F = d2.dot(rr);
  let s: number;
  let t: number;
  if (A <= EPS && E <= EPS) {
    s = t = 0;
  } else if (A <= EPS) {
    s = 0;
    t = clamp01(F / E);
  } else {
    const C = d1.dot(rr);
    if (E <= EPS) {
      t = 0;
      s = clamp01(-C / A);
    } else {
      const B = d1.dot(d2);
      const denom = A * E - B * B;
      s = denom > EPS ? clamp01((B * F - C * E) / denom) : 0;
      t = (B * s + F) / E;
      if (t < 0) {
        t = 0;
        s = clamp01(-C / A);
      } else if (t > 1) {
        t = 1;
        s = clamp01((B - C) / A);
      }
    }
  }
  a.copy(d1).multiplyScalar(s).add(p1);
  b.copy(d2).multiplyScalar(t).add(p2);
  return a.distanceToSquared(b);
}

export interface BladeSeg {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

export const makeSeg = (): BladeSeg => ({ a: new THREE.Vector3(), b: new THREE.Vector3() });

/**
 * First contact of a segment moving from `prev` to `cur` with the vertical capsule
 * (x, z, y0..y1, radius). `out` receives the contact point: on the capsule's surface,
 * on the side the blade came from. `flat` ignores height (a sweep that must be jumped
 * is decided by the caller, not by where the blade happens to be).
 */
export function sweepVsCapsule(
  prev: BladeSeg | null,
  cur: BladeSeg,
  x: number,
  z: number,
  y0: number,
  y1: number,
  radius: number,
  out: THREE.Vector3,
  flat = false,
  surface = radius
): boolean {
  cbA.set(x, flat ? 0 : y0, z);
  cbB.set(x, flat ? 0 : y1, z);
  const p = prev ?? cur;
  // Between two frames a blade swings along an ARC around the hand; lerping the tip in a
  // straight line would cut that arc short (and miss a target standing at the blade's
  // full reach when frames are long - 30fps phones, a slow frame). So the base moves
  // linearly and the blade's direction is slerped: the tip follows the true arc.
  dP.subVectors(p.b, p.a);
  dC.subVectors(cur.b, cur.a);
  const lenP = dP.length();
  const lenC = dC.length();
  const angle = lenP > 1e-4 && lenC > 1e-4 ? dP.angleTo(dC) : 0;
  const arc = Math.max(p.a.distanceTo(cur.a), angle * Math.max(lenP, lenC));
  const n = Math.min(12, Math.max(1, Math.ceil(arc / 0.25)));
  const r2 = radius * radius;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    segA.lerpVectors(p.a, cur.a, k);
    if (angle > 1e-3) {
      // spherical interpolation of the blade direction
      const sinA = Math.sin(angle);
      const w0 = Math.sin((1 - k) * angle) / sinA;
      const w1 = Math.sin(k * angle) / sinA;
      const len = lenP + (lenC - lenP) * k;
      segB.set(
        (dP.x / lenP) * w0 + (dC.x / lenC) * w1,
        (dP.y / lenP) * w0 + (dC.y / lenC) * w1,
        (dP.z / lenP) * w0 + (dC.z / lenC) * w1
      ).multiplyScalar(len).add(segA);
    } else {
      segB.lerpVectors(p.b, cur.b, k);
    }
    if (flat) {
      segA.y = 0;
      segB.y = 0;
    }
    const d = closestSegSeg(segA, segB, cbA, cbB, c1, c2);
    if (d <= r2) {
      // surface point toward the blade (or the blade point itself if it ran straight
      // through the axis)
      const dist = Math.sqrt(d);
      // (`surface` is the body's visible radius - the hit box itself is padded past it)
      if (dist > 1e-4) out.copy(c1).sub(c2).multiplyScalar(Math.min(dist, surface * 0.8) / dist).add(c2);
      else out.copy(c1);
      if (flat) out.y = (y0 + y1) * 0.55;
      return true;
    }
  }
  return false;
}

// Blade extent along a weapon model's local +Z (models are normalized: grip at the
// origin, blade toward +Z - see scripts/convert_weapons.py). The guard-to-tip stretch is
// what cuts; the handle isn't tested.
export const BLADE_SEG: Record<string, { base: number; tip: number }> = {
  katana: { base: 0.25, tip: 1.33 },
  ekatana: { base: 0.3, tip: 1.35 },
  greatsword: { base: 0.45, tip: 2.05 },
  bo: { base: -1.1, tip: 1.6 }
};

// How far in front of its own centre a character's swing reaches, per weapon, and thus
// the centre-to-centre distance attack magnetism closes to (target radius + this)
export const MAGNET_REACH: Record<string, number> = {
  katana: 1.3,
  bo: 1.5
};

// Vertical extent of a standard-height (2.32) body's hurtbox: from just above the
// ground (a low sweep still connects) to a little under the top of the head
export const HURT_BOTTOM = 0.15;
export const HURT_TOP = 2.15;
