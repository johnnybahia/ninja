import type { RigInstance } from './types';

// ===========================================================================
// Procedural pose animation. Every frame we build a target pose from layers
// (locomotion, weapon guard, attack keyframes, hit reaction, dash/air) and ease
// each joint toward it. Easing gives smooth transitions between any two states
// for free; attacks use a faster rate so strikes stay crisp.
//
// Axis conventions (bones rest with limbs hanging down, character faces +Z):
//   arm/leg X < 0 swings the limb forward; forearm X < 0 bends the elbow;
//   shin X > 0 bends the knee; spine/chest X > 0 leans forward;
//   armR Z > 0 / armL Z < 0 lifts the arm sideways; Y twists toward +X.
// ===========================================================================

const JOINTS = [
  'body', 'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR',
  'legL', 'legR', 'shinL', 'shinR', 'footL', 'footR',
  'plateF', 'plateB', 'plateL', 'plateR'
] as const;
type Joint = (typeof JOINTS)[number];
const NJ = JOINTS.length;
const JI = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<Joint, number>;

const P = new Float32Array(NJ * 3);
let hipsY = 0;

function set(j: Joint, x: number, y = 0, z = 0) {
  const i = JI[j] * 3;
  P[i] = x;
  P[i + 1] = y;
  P[i + 2] = z;
}
function add(j: Joint, x: number, y = 0, z = 0) {
  const i = JI[j] * 3;
  P[i] += x;
  P[i + 1] += y;
  P[i + 2] += z;
}
// blend the joint toward (x,y,z) by w
function mix(j: Joint, w: number, x: number, y = 0, z = 0) {
  const i = JI[j] * 3;
  P[i] += (x - P[i]) * w;
  P[i + 1] += (y - P[i + 1]) * w;
  P[i + 2] += (z - P[i + 2]) * w;
}
const get = (j: Joint, a: 0 | 1 | 2) => P[JI[j] * 3 + a];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface AnimInput {
  moveAmt: number;
  phase: number;
  air: boolean;
  t: number;
  dt: number;
  anim?: { kind: string; t: number; dur: number; side: number } | null;
  weapon?: string;
  windup?: number; // enemy telegraph progress 0..1
  hit?: number; // 0..1 hit reaction
  dash?: boolean;
  turn?: number; // yaw rate (rad/s) for leaning into turns
}

function bone(r: RigInstance, j: Joint) {
  switch (j) {
    case 'handL':
      return r.handBoneL;
    case 'handR':
      return r.handBoneR;
    case 'plateF':
      return r.plates?.[0];
    case 'plateB':
      return r.plates?.[1];
    case 'plateL':
      return r.plates?.[2];
    case 'plateR':
      return r.plates?.[3];
    default:
      return (r as unknown as Record<string, { rotation: { x: number; y: number; z: number } } | undefined>)[j];
  }
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------
function neutral() {
  P.fill(0);
  hipsY = 0;
  set('armL', 0.05, 0, -0.14);
  set('armR', 0.05, 0, 0.14);
  set('foreL', -0.18);
  set('foreR', -0.18);
}

function locomotion(m: number, ph: number, t: number) {
  const run = smooth((m - 0.45) / 0.5);
  const s = Math.sin(ph);
  const co = Math.cos(ph);
  const legA = (0.55 + 0.38 * run) * m;
  const kneeA = (0.55 + 0.75 * run) * m;
  add('legL', -s * legA);
  add('legR', s * legA);
  add('shinL', Math.max(0, co) * kneeA + 0.1 * m);
  add('shinR', Math.max(0, -co) * kneeA + 0.1 * m);
  hipsY += m * 0.055 * (Math.abs(co) - 0.6) - 0.05 * run;
  add('hips', 0, 0.12 * s * m, 0.035 * co * m);
  add('spine', 0.04 * m, -0.16 * s * m);
  add('chest', 0.06 * m + 0.2 * run, -0.06 * s * m);
  const armA = (0.45 + 0.4 * run) * m;
  add('armL', s * armA);
  add('armR', -s * armA);
  add('foreL', -(0.3 + 0.75 * run) * m);
  add('foreR', -(0.3 + 0.75 * run) * m);
  add('head', -(0.06 * m + 0.14 * run));
  // idle breathing and ready crouch fade out as speed grows
  const idle = 1 - m;
  const br = Math.sin(t * 1.8);
  add('chest', br * 0.02 * idle);
  add('head', -br * 0.012 * idle);
  hipsY += br * 0.006 * idle - 0.035 * idle;
  add('legL', -0.14 * idle, 0, -0.06 * idle);
  add('legR', -0.08 * idle, 0, 0.06 * idle);
  add('shinL', 0.26 * idle);
  add('shinR', 0.2 * idle);
}

// Upper-body hold for each weapon / enemy type (w = blend weight)
function guard(kind: string, w: number, t: number) {
  if (w <= 0) return;
  const sway = Math.sin(t * 1.3) * 0.03;
  switch (kind) {
    case 'katana':
      mix('armR', w, -0.55 + sway, -0.25, 0.1);
      mix('foreR', w, -0.8);
      mix('handR', w, -0.55);
      mix('armL', w, -0.5, 0.1, -0.08);
      mix('foreL', w, -1.25);
      add('chest', 0, 0.16 * w);
      break;
    case 'bo':
      mix('armR', w, -0.75, -0.2, 0.28);
      mix('foreR', w, -0.95);
      mix('handR', w, 0.1, 0, -0.1);
      mix('armL', w, -0.85, 0.3, -0.22);
      mix('foreL', w, -0.95);
      add('chest', 0, 0.2 * w);
      break;
    case 'kama':
      mix('armR', w, -0.45 + sway, 0, 0.18);
      mix('foreR', w, -0.95);
      mix('handR', w, -0.3);
      mix('armL', w, -0.3, 0, -0.2);
      mix('foreL', w, -0.9);
      break;
    case 'shuriken':
    case 'kunai':
    case 'bomb':
      mix('armR', w, -0.15, 0, 0.22);
      mix('foreR', w, -0.7);
      mix('armL', w, -0.4 + sway, 0.1, -0.15);
      mix('foreL', w, -1.1);
      break;
    case 'karate':
      mix('armR', w, -0.8 + sway, 0.2, 0.32);
      mix('foreR', w, -1.95);
      mix('armL', w, -1.0 - sway, -0.2, -0.28);
      mix('foreL', w, -1.9);
      add('chest', 0.06 * w, 0.28 * w);
      hipsY -= 0.03 * w;
      break;
    case 'samurai':
      // two-handed chudan: both hands meet in front, blade forward and up
      mix('armR', w, -0.75 + sway, -0.15, -0.12);
      mix('foreR', w, -0.65);
      mix('handR', w, -0.7);
      mix('armL', w, -0.8 + sway, 0.35, 0.3);
      mix('foreL', w, -0.75);
      break;
    case 'archer':
      mix('armL', w, -0.3, 0, -0.22);
      mix('foreL', w, -0.4);
      mix('armR', w, 0.1, 0, 0.2);
      mix('foreR', w, -0.4);
      break;
    case 'oni':
      // club resting on the shoulder, free hand clawing
      mix('armR', w, -1.25, 0.1, 0.55);
      mix('foreR', w, -1.75);
      mix('handR', w, 0.3);
      mix('armL', w, -0.25 + sway, 0, -0.35);
      mix('foreL', w, -0.6);
      add('chest', 0.12 * w);
      break;
  }
}

// Player/enemy attack keyframes. p in 0..1 over the attack's duration.
function attack(kind: string, side: number, p: number): { snapBodyY?: number } | void {
  const wind = smooth(p / 0.26);
  const strike = easeOut((p - 0.22) / 0.3);
  switch (kind) {
    case 'slash': {
      if (side === 0) {
        set('armR', -2.3 + 2.0 * strike, 0.3 - 0.9 * strike, 0.5 - 1.0 * strike);
        set('foreR', -0.6 + 0.4 * strike);
        set('handR', -0.3 + 0.5 * strike);
        set('armL', -0.6, 0, -0.3);
        set('foreL', -1.2);
        add('chest', 0.12 * strike, 0.5 * wind - 1.05 * strike);
        add('spine', 0, 0.2 * wind - 0.35 * strike);
      } else if (side === 1) {
        set('armR', -1.3 + 0.1 * strike, -1.0 + 2.0 * strike, -0.9 + 1.8 * strike);
        set('foreR', -0.5 + 0.3 * strike);
        set('handR', -0.2);
        set('armL', -0.5, 0, -0.4);
        set('foreL', -1.3);
        add('chest', 0.08, -0.6 * wind + 1.2 * strike);
        add('spine', 0, -0.2 * wind + 0.4 * strike);
      } else {
        set('armR', -2.8 * wind + 2.45 * strike, 0.05, -0.1);
        set('armL', -2.7 * wind + 2.35 * strike, -0.05, 0.25);
        set('foreR', -0.3);
        set('foreL', -0.35);
        set('handR', -0.4 + 0.5 * strike);
        add('chest', -0.25 * wind + 0.7 * strike);
        hipsY += 0.05 * wind - 0.17 * strike;
      }
      // lunge stance: lead leg forward, rear leg back
      const st = Math.max(wind * 0.4, strike);
      add('legL', -0.55 * st);
      add('shinL', 0.55 * st);
      add('legR', 0.4 * st);
      add('shinR', 0.35 * st);
      break;
    }
    case 'spin': {
      set('armR', -1.45, 0, 1.05);
      set('armL', -1.45, 0, -1.05);
      set('foreR', -0.25);
      set('foreL', -0.25);
      hipsY += Math.sin(p * Math.PI) * 0.1;
      add('legL', -0.3, 0, -0.2);
      add('legR', 0.2, 0, 0.2);
      return { snapBodyY: p * Math.PI * 2 };
    }
    case 'chain': {
      set('armR', -2.5 + 1.7 * strike, 0.3 - 0.6 * strike, 0.4 - 0.5 * strike);
      set('foreR', -0.9 + 0.8 * strike);
      set('armL', -0.4, 0, -0.3);
      set('foreL', -1.0);
      add('chest', 0.15 * strike, 0.35 * wind - 0.7 * strike);
      add('legL', -0.35 * strike);
      add('shinL', 0.35 * strike);
      break;
    }
    case 'throw': {
      set('armR', -2.1 + 1.4 * strike, 0.3 - 0.5 * strike, 0.7 - 0.9 * strike);
      set('foreR', -1.0 + 0.9 * strike);
      set('armL', -0.9 * strike - 0.3, 0, -0.25);
      set('foreL', -0.6);
      add('chest', -0.12 * wind + 0.32 * strike, 0.45 * wind - 0.85 * strike);
      add('legL', -0.4 * strike);
      add('shinL', 0.35 * strike);
      add('legR', 0.25 * strike);
      break;
    }
    case 'punchR': {
      const k = Math.sin(p * Math.PI);
      set('armR', -0.8 - 0.78 * k, -0.25 * k, 0.32 - 0.3 * k);
      set('foreR', -1.95 + 1.9 * k);
      set('armL', -0.5, -0.2, -0.3);
      set('foreL', -2.1);
      add('chest', 0.1 * k, -0.5 * k);
      add('legL', -0.35 * k);
      add('shinL', 0.4 * k);
      break;
    }
    case 'punchL': {
      const k = Math.sin(p * Math.PI);
      set('armL', -1.0 - 0.58 * k, 0.25 * k, -0.28 + 0.26 * k);
      set('foreL', -1.9 + 1.85 * k);
      set('armR', -0.5, 0.2, 0.3);
      set('foreR', -2.1);
      add('chest', 0.1 * k, 0.5 * k);
      add('legR', -0.3 * k);
      add('shinR', 0.35 * k);
      break;
    }
    case 'frontKick': {
      const chamber = smooth(p / 0.35);
      const ext = easeOut((p - 0.3) / 0.3) * (1 - smooth((p - 0.75) / 0.25));
      set('legR', -1.3 * chamber - 0.35 * ext);
      set('shinR', 1.7 * chamber * (1 - ext) + 0.1);
      set('footR', -0.4 * ext);
      set('legL', 0.1);
      set('shinL', 0.3);
      add('chest', -0.3 * chamber);
      set('armR', -0.6, 0, 0.45);
      set('armL', -0.8, 0, -0.45);
      set('foreR', -1.6);
      set('foreL', -1.6);
      break;
    }
    case 'roundKick': {
      const k = Math.sin(p * Math.PI);
      set('legR', -0.9 * k, 0, 1.3 * k);
      set('shinR', 0.25 + 0.6 * (1 - k));
      set('legL', 0.05);
      set('shinL', 0.25);
      add('chest', 0, 0, -0.35 * k);
      set('armR', -0.3, 0, 0.9);
      set('armL', -0.3, 0, -0.9);
      return { snapBodyY: p * Math.PI * 2 };
    }
    // ---- enemies ----
    case 'eslash': {
      const k = easeOut(p / 0.4);
      set('armR', -2.6 + 2.2 * k, -0.1, -0.05);
      set('armL', -2.5 + 2.1 * k, 0.2, 0.2);
      set('foreR', -0.4);
      set('foreL', -0.45);
      set('handR', -0.5 + 0.6 * k);
      add('chest', -0.15 + 0.6 * k);
      add('legL', -0.55 * k);
      add('shinL', 0.5 * k);
      add('legR', 0.35 * k);
      hipsY -= 0.08 * k;
      break;
    }
    case 'esmash': {
      const k = easeOut(p / 0.35);
      set('armR', -3.0 + 2.8 * k, 0, 0.2 - 0.3 * k);
      set('armL', -2.8 + 2.6 * k, 0, -0.2);
      set('foreR', -0.3);
      set('foreL', -0.3);
      add('chest', -0.3 + 0.95 * k);
      hipsY -= 0.14 * k;
      add('legL', -0.5 * k);
      add('shinL', 0.8 * k);
      add('legR', 0.3 * k);
      add('shinR', 0.5 * k);
      break;
    }
    case 'eshoot': {
      const draw = smooth(p / 0.55);
      const rel = smooth((p - 0.6) / 0.15);
      set('armL', -1.55, 0.1, -0.05);
      set('foreL', -0.05);
      set('armR', -1.5 * draw, 0.2, -0.3 * draw);
      set('foreR', -2.0 * draw * (1 - rel) - 0.3 * rel);
      add('chest', 0, 0.4 * draw);
      add('head', 0, -0.3 * draw);
      break;
    }
  }
}

function windupPose(kind: string, w: number) {
  if (w <= 0) return;
  if (kind === 'oni') {
    mix('armR', w, -3.0, 0, 0.2);
    mix('armL', w, -2.8, 0, -0.2);
    mix('foreR', w, -0.3);
    mix('foreL', w, -0.3);
    add('chest', -0.3 * w);
    hipsY += 0.04 * w;
  } else {
    mix('armR', w, -2.6, -0.1, -0.05);
    mix('armL', w, -2.5, 0.2, 0.2);
    mix('foreR', w, -0.4);
    mix('foreL', w, -0.45);
    mix('handR', w, -0.5);
    add('chest', -0.15 * w);
    add('legR', 0.25 * w);
    add('legL', -0.2 * w);
    add('shinL', 0.3 * w);
  }
}

// keep the feet roughly level with the ground whatever the leg angles
function footLevel() {
  add('footL', -(get('legL', 0) + get('shinL', 0)) * 0.7);
  add('footR', -(get('legR', 0) + get('shinR', 0)) * 0.7);
}

function platesFollow() {
  const lx = get('legL', 0);
  const rx = get('legR', 0);
  set('plateF', Math.min(lx, rx, 0) * 0.75);
  set('plateB', Math.max(lx, rx, 0) * 0.75 * -1);
  set('plateL', 0, 0, Math.min(0, get('legL', 2)) * 0.8 + Math.min(0, lx) * 0.1);
  set('plateR', 0, 0, Math.max(0, get('legR', 2)) * 0.8 - Math.min(0, rx) * 0.1);
}

// ---------------------------------------------------------------------------
export function animateCharacter(r: RigInstance, a: AnimInput) {
  const kind = r.kind || 'ninja';
  neutral();
  const m = a.air ? 0 : a.moveAmt;
  locomotion(m, a.phase, a.t);
  const guardKind = kind === 'ninja' ? a.weapon || 'katana' : kind;
  guard(guardKind, 1 - 0.5 * m, a.t);

  let snapBodyY: number | undefined;
  const attacking = !!(a.anim && a.anim.dur > 0);
  if (attacking && a.anim) {
    const res = attack(a.anim.kind, a.anim.side || 0, clamp01(a.anim.t / a.anim.dur));
    if (res && res.snapBodyY !== undefined) snapBodyY = res.snapBodyY;
  } else if (a.windup && a.windup > 0) {
    windupPose(kind, smooth(a.windup));
  }

  if (a.dash) {
    mix('chest', 0.8, 0.55);
    mix('spine', 0.8, 0.2);
    mix('armL', 0.9, 0.9, 0, -0.25);
    mix('armR', 0.9, 0.9, 0, 0.25);
    mix('foreL', 0.9, -0.3);
    mix('foreR', 0.9, -0.3);
    mix('legL', 0.9, -1.0);
    mix('shinL', 0.9, 1.3);
    mix('legR', 0.9, 0.5);
    mix('shinR', 0.9, 0.5);
    hipsY -= 0.16;
  } else if (a.air) {
    mix('legL', 0.9, -1.0);
    mix('shinL', 0.9, 1.5);
    mix('legR', 0.9, -0.35);
    mix('shinR', 0.9, 1.05);
    add('chest', 0.1);
  }

  // lean into turns while running
  if (a.turn) {
    const lean = Math.max(-0.28, Math.min(0.28, -a.turn * 0.045 * m));
    add('hips', 0, 0, lean);
    add('chest', 0, 0, lean * 0.6);
  }

  if (a.hit && a.hit > 0) {
    const h = a.hit;
    add('chest', -0.4 * h, 0, 0.1 * h);
    add('spine', -0.15 * h);
    add('head', -0.35 * h);
    add('armL', 0.25 * h, 0, -0.2 * h);
    add('armR', 0.25 * h, 0, 0.2 * h);
    hipsY -= 0.03 * h;
  }

  footLevel();
  platesFollow();

  // ease every joint toward its target
  const rate = attacking ? 34 : a.dash ? 28 : 16;
  const k = 1 - Math.exp(-rate * Math.max(0, a.dt));
  for (let j = 0; j < NJ; j++) {
    const b = bone(r, JOINTS[j]);
    if (!b) continue;
    const i = j * 3;
    const rot = b.rotation;
    if (JOINTS[j] === 'body') {
      rot.y = wrapPi(rot.y);
      if (snapBodyY !== undefined) {
        rot.y = snapBodyY;
        rot.x += (P[i] - rot.x) * k;
        rot.z += (P[i + 2] - rot.z) * k;
        continue;
      }
    }
    rot.x += (P[i] - rot.x) * k;
    rot.y += (P[i + 1] - rot.y) * k;
    rot.z += (P[i + 2] - rot.z) * k;
  }
  if (r.hips && r.hipsRestY !== undefined) {
    r.hips.position.y += (r.hipsRestY + hipsY - r.hips.position.y) * k;
  }

  if (r.cloth) for (const rb of r.cloth) rb.update(a.dt, a.t);
}

// Fall backward with buckling knees and flung arms; the engine sinks the root.
export function animateDeath(r: RigInstance, t: number, dt: number) {
  const k = 1 - Math.exp(-14 * dt);
  const f = smooth(t / 0.45);
  const target: [Joint, number, number, number][] = [
    ['body', -Math.min(Math.PI / 2, t * 4.2), 0, 0],
    ['legL', -0.7 * f, 0, -0.2 * f],
    ['legR', -0.35 * f, 0, 0.25 * f],
    ['shinL', 1.1 * f, 0, 0],
    ['shinR', 0.7 * f, 0, 0],
    ['armL', -0.6 * f, 0, -1.2 * f],
    ['armR', -0.8 * f, 0, 1.3 * f],
    ['foreL', -0.3, 0, 0],
    ['foreR', -0.3, 0, 0],
    ['chest', -0.3 * f, 0, 0],
    ['head', -0.4 * f, 0, 0]
  ];
  for (const [j, x, y, z] of target) {
    const b = bone(r, j);
    if (!b) continue;
    if (j === 'body') {
      b.rotation.x = x;
      continue;
    }
    b.rotation.x += (x - b.rotation.x) * k;
    b.rotation.y += (y - b.rotation.y) * k;
    b.rotation.z += (z - b.rotation.z) * k;
  }
  if (r.cloth) for (const rb of r.cloth) rb.update(dt, t);
}
