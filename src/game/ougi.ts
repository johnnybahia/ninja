// Ougi (奥義): the special of the game, in the manner of a fighting game's super. A scroll grants one for
// a while; used in front of a foe it becomes an automatic sequence - the attacker flashes around the
// foe, swapping weapons from blow to blow while the camera cuts from angle to angle - and ends in the
// kill (the Oni loses at most a quarter of its life). This file is the data: the moves of each weapon,
// the sequences built from them (some from the player's own two weapons, some fixed, one drawn at
// random) and where the camera stands for each shot. The director that plays them is in engine.ts.

export type OugiFx = 'slash' | 'thrust' | 'spin' | 'whirl' | 'punch' | 'kick' | 'chain' | 'stars' | 'blast' | 'slide' | 'slam';
export type OugiShot = 'side' | 'low' | 'close' | 'top' | 'shoulder' | 'behind' | 'wide' | 'orbit' | 'hero';
export type OugiSpot = 'front' | 'left' | 'right' | 'back';

// One blow of a weapon: a mocap clip played from `from` so the hit lands at `hit` (clip seconds, as in
// moves.ts), `follow` more seconds of follow-through before the next blow
export interface OugiMove {
  clip: string;
  from: number;
  hit: number;
  speed: number;
  follow: number;
  fx: OugiFx;
  kb: number;
  dmg: number;
  heavy?: boolean;
  eff?: 'LH' | 'RH' | 'LF' | 'RF'; // the limb that cuts (punches and kicks)
}

// The moves of each weapon, light ones first and the heavy ones last (an index of -1 in a sequence is
// the last: the weapon's biggest blow)
export const OUGI_MOVES: Record<string, OugiMove[]> = {
  katana: [
    { clip: 'eSwordSlash', from: 0.42, hit: 0.72, speed: 1.5, follow: 0.28, fx: 'slash', kb: 3, dmg: 22 },
    { clip: 'slash1', from: 0.4, hit: 0.68, speed: 1.5, follow: 0.3, fx: 'slash', kb: 3, dmg: 24 },
    { clip: 'slash2', from: 0.5, hit: 0.95, speed: 1.5, follow: 0.4, fx: 'slash', kb: 8, dmg: 38, heavy: true },
    { clip: 'slideAttack', from: 0.95, hit: 1.43, speed: 1.4, follow: 0.45, fx: 'slide', kb: 7, dmg: 36, heavy: true },
    { clip: 'jumpAttack', from: 0.55, hit: 1.07, speed: 1.4, follow: 0.55, fx: 'slam', kb: 10, dmg: 46, heavy: true }
  ],
  bo: [
    { clip: 'eSwordSlash', from: 0.42, hit: 0.72, speed: 1.4, follow: 0.3, fx: 'slash', kb: 4, dmg: 18 },
    { clip: 'eSwordAttack', from: 0.3, hit: 0.62, speed: 1.4, follow: 0.3, fx: 'thrust', kb: 12, dmg: 16, heavy: true },
    { clip: 'spin', from: 0.1, hit: 0.43, speed: 1.3, follow: 0.55, fx: 'spin', kb: 9, dmg: 30, heavy: true }
  ],
  kama: [
    { clip: 'eSwordAttack', from: 0.3, hit: 0.62, speed: 1.4, follow: 0.3, fx: 'chain', kb: 2, dmg: 20 },
    { clip: 'spin', from: 0.1, hit: 0.47, speed: 1.3, follow: 0.55, fx: 'whirl', kb: 8, dmg: 34, heavy: true }
  ],
  karate: [
    { clip: 'jab', from: 0, hit: 0.3, speed: 1.3, follow: 0.2, fx: 'punch', kb: 2, dmg: 14, eff: 'LH' },
    { clip: 'cross', from: 0, hit: 0.37, speed: 1.3, follow: 0.22, fx: 'punch', kb: 3, dmg: 17, eff: 'RH' },
    { clip: 'kick1', from: 0.15, hit: 0.68, speed: 1.4, follow: 0.3, fx: 'kick', kb: 8, dmg: 26, heavy: true, eff: 'RF' },
    { clip: 'kick2', from: 0.3, hit: 0.75, speed: 1.4, follow: 0.5, fx: 'kick', kb: 11, dmg: 36, heavy: true, eff: 'LF' }
  ],
  shuriken: [{ clip: 'cast', from: 0.05, hit: 0.37, speed: 1.4, follow: 0.35, fx: 'stars', kb: 2, dmg: 18 }],
  kunai: [
    { clip: 'cast', from: 0.05, hit: 0.37, speed: 1.4, follow: 0.35, fx: 'stars', kb: 2, dmg: 22 },
    { clip: 'eSwordAttack', from: 0.3, hit: 0.62, speed: 1.5, follow: 0.4, fx: 'thrust', kb: 8, dmg: 48, heavy: true }
  ],
  bomb: [{ clip: 'cast', from: 0.05, hit: 0.37, speed: 1.3, follow: 0.6, fx: 'blast', kb: 12, dmg: 44, heavy: true }]
};

// a sequence is a list of beats: [weapon, index of its move (-1 = the last), camera shot, where the
// attacker stands around the foe]. 'A' and 'B' are the player's two weapons.
export type OugiBeat = [weapon: string, move: number, shot: OugiShot, at: OugiSpot];

export interface OugiDef {
  id: string;
  name: string;
  glyph: string; // the kanji of the title card
  sub: string;
  weapons: string[]; // what it uses, for choosing one that fits the player's weapons
  beats: OugiBeat[];
}

export const OUGI_DEFS: OugiDef[] = [
  {
    id: 'dueto',
    name: 'Dueto',
    glyph: '双',
    sub: 'As suas duas armas, golpe a golpe',
    weapons: ['A', 'B'],
    beats: [
      ['A', 0, 'side', 'front'],
      ['B', 0, 'shoulder', 'left'],
      ['A', 1, 'low', 'right'],
      ['B', 1, 'close', 'back'],
      ['A', 2, 'top', 'left'],
      ['B', -1, 'wide', 'front']
    ]
  },
  {
    id: 'tempestade',
    name: 'Tempestade de Aço',
    glyph: '嵐',
    sub: 'Katana e bastão em uma tormenta de cortes',
    weapons: ['katana', 'bo'],
    beats: [
      ['katana', 0, 'side', 'front'],
      ['katana', 1, 'shoulder', 'right'],
      ['bo', 0, 'low', 'left'],
      ['bo', 1, 'close', 'front'],
      ['bo', 2, 'orbit', 'back'],
      ['katana', -1, 'wide', 'front']
    ]
  },
  {
    id: 'corrente',
    name: 'Dança da Corrente',
    glyph: '鎖',
    sub: 'Kusarigama, karatê e katana',
    weapons: ['kama', 'karate', 'katana'],
    beats: [
      ['kama', 0, 'side', 'front'],
      ['karate', 0, 'close', 'left'],
      ['karate', 2, 'low', 'right'],
      ['kama', 1, 'orbit', 'back'],
      ['katana', 2, 'shoulder', 'left'],
      ['karate', -1, 'wide', 'front']
    ]
  },
  {
    id: 'dragao',
    name: 'Dragão de Fogo',
    glyph: '龍',
    sub: 'Punhos, chutes, uma bomba e a katana',
    weapons: ['karate', 'bomb', 'katana'],
    beats: [
      ['karate', 0, 'close', 'front'],
      ['karate', 1, 'side', 'left'],
      ['karate', 2, 'low', 'right'],
      ['katana', 3, 'top', 'front'],
      ['bomb', 0, 'behind', 'back'],
      ['bomb', -1, 'wide', 'front']
    ]
  },
  {
    id: 'estrelas',
    name: 'Chuva de Estrelas',
    glyph: '星',
    sub: 'Shuriken, kunai e katana',
    weapons: ['shuriken', 'kunai', 'katana'],
    beats: [
      ['shuriken', 0, 'side', 'front'],
      ['kunai', 0, 'close', 'left'],
      ['shuriken', 0, 'shoulder', 'right'],
      ['katana', 3, 'low', 'back'],
      ['kunai', 1, 'top', 'front'],
      ['katana', -1, 'wide', 'left']
    ]
  },
  {
    id: 'milhao',
    name: 'Mil Lâminas',
    glyph: '千',
    sub: 'Katana, kusarigama, karatê e bastão: quatro armas em um só golpe',
    weapons: ['katana', 'kama', 'karate', 'bo'],
    beats: [
      ['katana', 0, 'side', 'front'],
      ['kama', 0, 'shoulder', 'left'],
      ['karate', 2, 'low', 'right'],
      ['bo', 2, 'orbit', 'back'],
      ['katana', 3, 'top', 'left'],
      ['katana', -1, 'wide', 'front']
    ]
  }
];

// The seventh: weapons drawn at random each time, in an order the player has never seen
export const OUGI_CHAOS: Pick<OugiDef, 'id' | 'name' | 'glyph' | 'sub'> = {
  id: 'caos',
  name: 'Dança do Acaso',
  glyph: '乱',
  sub: 'Armas sorteadas, uma sequência nunca vista'
};

/** A sequence by id (the chaos one has no beats of its own: resolveOugi draws them). */
export const ougiById = (id: string): OugiDef | undefined => (id === OUGI_CHAOS.id ? { ...OUGI_CHAOS, weapons: [], beats: [] } : OUGI_DEFS.find((d) => d.id === id));

const SHOTS: OugiShot[] = ['side', 'low', 'shoulder', 'close', 'top', 'behind', 'orbit'];
const SPOTS: OugiSpot[] = ['front', 'left', 'right', 'back'];

const shuffle = <T,>(a: T[], rng: () => number): T[] => {
  const o = a.slice();
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
};

/** Which sequence a scroll holds: the ones that use the player's own weapons come up more often. */
export function pickOugi(equipped: string[], last: string | undefined, rng: () => number = Math.random): OugiDef {
  const pool: { def: OugiDef; w: number }[] = OUGI_DEFS.map((def) => ({
    def,
    w: def.id === 'dueto' ? 3 : 1 + 2 * def.weapons.filter((x) => equipped.includes(x)).length
  }));
  pool.push({ def: ougiById(OUGI_CHAOS.id)!, w: 2 });
  const open = pool.filter((p) => p.def.id !== last);
  let r = rng() * open.reduce((s, p) => s + p.w, 0);
  for (const p of open) {
    r -= p.w;
    if (r <= 0) return p.def;
  }
  return open[0].def;
}

/** The blows of a sequence, resolved to real clips: 'A'/'B' become the player's weapons and the chaos
 *  sequence is drawn now (three or four weapons, a heavy blow to close). */
export interface OugiStep extends OugiMove {
  weapon: string;
  shot: OugiShot;
  at: OugiSpot;
}

export function resolveOugi(def: OugiDef, equipped: string[], rng: () => number = Math.random): OugiStep[] {
  let beats = def.beats;
  if (def.id === 'caos') {
    const ids = shuffle(Object.keys(OUGI_MOVES), rng);
    const used = ids.slice(0, rng() < 0.5 ? 3 : 4);
    const shots = shuffle(SHOTS, rng);
    const spots = shuffle(SPOTS, rng);
    beats = [];
    for (let i = 0; i < 5; i++) {
      const w = used[i % used.length];
      const moves = OUGI_MOVES[w];
      // the early blows are the light ones; the last of the five is the weapon's heavy
      beats.push([w, i < 4 ? Math.floor(rng() * Math.max(1, moves.length - 1)) : -1, shots[i], spots[i % spots.length]]);
    }
    // it closes with a weapon that has a heavy blow to close with (a fan of stars is no finale)
    const heavy = used.filter((w) => OUGI_MOVES[w][OUGI_MOVES[w].length - 1].heavy);
    const closer = heavy.length ? heavy : used;
    beats.push([closer[Math.floor(rng() * closer.length)], -1, 'wide', 'front']);
  }
  const A = equipped[0] ?? 'katana';
  const B = equipped[1] ?? equipped[0] ?? 'katana';
  return beats.map(([w, m, shot, at]) => {
    const id = w === 'A' ? A : w === 'B' ? B : w;
    const moves = OUGI_MOVES[id] ?? OUGI_MOVES.katana;
    const mv = moves[m < 0 ? moves.length - 1 : m % moves.length];
    return { ...mv, weapon: OUGI_MOVES[id] ? id : 'katana', shot, at };
  });
}

// ---- camera -------------------------------------------------------------------------------

export interface ShotPose {
  x: number;
  y: number;
  z: number;
  lx: number; // where it looks
  ly: number;
  lz: number;
  fov: number;
  roll: number;
}

export const newPose = (): ShotPose => ({ x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 45, roll: 0 });

/** Where the camera stands for a shot: the attacker at (ax, az), the foe at (tx, tz) and `sc` its size,
 *  `side` (+1/-1) which side of the pair it takes, `k` how far into the blow (0..1: a slow push-in or
 *  a turn), `portrait` for a tall screen (it backs off to keep both in the frame). */
export function shotPose(out: ShotPose, shot: OugiShot, ax: number, az: number, tx: number, tz: number, sc: number, side: number, k: number, portrait: boolean): ShotPose {
  let ux = tx - ax;
  let uz = tz - az;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  const px = -uz * side;
  const pz = ux * side;
  const mx = (ax + tx) / 2;
  const mz = (az + tz) / 2;
  const S = Math.sqrt(sc);
  const pk = portrait ? 1.35 : 1;
  const fk = portrait ? 1.22 : 1;
  out.roll = 0;
  switch (shot) {
    case 'side': {
      const d = 4.3 * S * pk * (1 - 0.12 * k);
      out.x = mx + px * d * 0.92 - ux * d * 0.4;
      out.z = mz + pz * d * 0.92 - uz * d * 0.4;
      out.y = 1.2 + 0.2 * sc;
      out.lx = mx;
      out.lz = mz;
      out.ly = 1.15;
      out.fov = 40 * fk;
      out.roll = 0.045 * side;
      break;
    }
    case 'low': {
      out.x = ax - ux * 1.1 * S + px * 0.9;
      out.z = az - uz * 1.1 * S + pz * 0.9;
      out.y = 0.38 + 0.2 * k;
      out.lx = tx;
      out.lz = tz;
      out.ly = 1.5 * Math.min(sc, 1.8);
      out.fov = 50 * fk;
      out.roll = -0.07 * side;
      break;
    }
    case 'close': {
      const d = 2.1 * S * (1 - 0.2 * k);
      out.x = tx - ux * d + px * 0.8 * S;
      out.z = tz - uz * d + pz * 0.8 * S;
      out.y = 1.5 * Math.min(sc, 1.6);
      out.lx = tx;
      out.lz = tz;
      out.ly = 1.5 * Math.min(sc, 1.6);
      out.fov = 33 * fk;
      break;
    }
    case 'top': {
      out.x = mx + px * 0.3 - ux * 1.0 * S;
      out.z = mz + pz * 0.3 - uz * 1.0 * S;
      out.y = 6.8 * S * pk * (1 - 0.1 * k);
      out.lx = mx;
      out.lz = mz;
      out.ly = 0.8;
      out.fov = 46 * fk;
      out.roll = 0.12 * side;
      break;
    }
    case 'shoulder': {
      const d = (2.1 - 0.4 * k) * S;
      out.x = ax - ux * d + px * 0.8 * S;
      out.z = az - uz * d + pz * 0.8 * S;
      out.y = 1.75;
      out.lx = tx;
      out.lz = tz;
      out.ly = 1.4 * Math.min(sc, 1.6);
      out.fov = 44 * fk;
      break;
    }
    case 'behind': {
      out.x = tx + ux * 3.3 * S * pk + px * 0.7;
      out.z = tz + uz * 3.3 * S * pk + pz * 0.7;
      out.y = 1.45;
      out.lx = ax;
      out.lz = az;
      out.ly = 1.3;
      out.fov = 40 * fk;
      break;
    }
    case 'wide': {
      out.x = mx + px * 8 * S * pk - ux * 2.4;
      out.z = mz + pz * 8 * S * pk - uz * 2.4;
      out.y = 3 * S;
      out.lx = mx;
      out.lz = mz;
      out.ly = 0.9;
      out.fov = 50 * fk;
      break;
    }
    case 'orbit': {
      const a = Math.atan2(uz, ux) + side * (Math.PI / 2 + k * 1.5);
      const r = 4.6 * S * pk;
      out.x = mx + Math.cos(a) * r;
      out.z = mz + Math.sin(a) * r;
      out.y = 1.4 + 0.4 * k;
      out.lx = mx;
      out.lz = mz;
      out.ly = 1.15;
      out.fov = 44 * fk;
      break;
    }
    default: {
      // hero: the attacker gathering himself, seen from the front at three quarters (never in line with the
      // foe), closing in slowly
      const d = 3.0 - 0.4 * k;
      out.x = ax + ux * d + px * 2.8 * pk;
      out.z = az + uz * d + pz * 2.8 * pk;
      out.y = 1.0;
      out.lx = ax;
      out.lz = az;
      out.ly = 1.15;
      out.fov = 40 * fk;
      out.roll = 0.03 * side;
    }
  }
  return out;
}
