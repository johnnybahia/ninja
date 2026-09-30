// Souls-style move sets for the mocap Rōnin (clipRig.ts). Every timing below is in clip
// seconds, read off the clips themselves: `hit` is where the blade/fist/foot reaches its
// peak speed (measured from the mocap, see scripts/), which is when damage lands.
//
//   win:    clip-time spans in which the weapon/limb can connect, measured from the clip
//           itself (where the blade is fast AND crossing the space in front of the body) -
//           defaults to the hit frame +-0.08s. eff: what does the hitting ('sword' = the
//           held weapon, else a limb: LH/RH/LF/RF). reach: how far in front of the body
//           the swing gets to, which attack magnetism closes distance to.
//   from:   clip time the move starts at (skips the idle lead-in some clips open with)
//   speed:  playback rate - the raw mocap is heavy and slow, so moves run 1.4-1.7x to land
//           their hit in ~0.15-0.5s (TUNE.attackSpeed multiplies on top of this)
//   chain:  from here a buffered attack press starts the next move of the combo
//   cancel: from here a dodge, guard or the stick may interrupt the recovery
//   end:    the move releases the character (the clip's own tail is only a blend-out)
//
// Moves commit: no steering after the hit, no walking during the swing - the clip's own
// footwork (and root motion, where a move lunges) is all the movement there is. Each
// swing costs stamina.

export interface ClipMove {
  clip: string;
  hit: number[];
  win?: [number, number][];
  eff?: 'sword' | 'LH' | 'RH' | 'LF' | 'RF';
  reach?: number;
  chain: number;
  cancel: number;
  end: number;
  from?: number;
  speed?: number;
  root?: number; // scale of the clip's root travel applied to the character (0 = in place)
  dmg: number;
  range: number;
  arc: number;
  kb: number;
  heavy?: boolean;
  stamina: number;
  release?: number; // throwables: when the projectile leaves the hand
}

export const COMBOS: Record<string, ClipMove[]> = {
  // quick horizontal cut -> the big diagonal from behind-right -> a wide head-high sweep
  katana: [
    { clip: 'eSwordSlash', hit: [0.72], win: [[0.66, 0.84]], reach: 1.3, chain: 0.95, cancel: 0.9, end: 1.25, from: 0.42, speed: 2.4, dmg: 23, range: 2.9, arc: 2.1, kb: 4, stamina: 12 },
    { clip: 'slash1', hit: [0.68], win: [[0.58, 0.84]], reach: 1.3, chain: 0.92, cancel: 0.86, end: 1.2, from: 0.4, speed: 2.5, dmg: 26, range: 2.9, arc: 2.1, kb: 5, stamina: 14 },
    { clip: 'slash2', hit: [0.95], win: [[0.84, 1.06]], reach: 1.35, chain: 99, cancel: 1.25, end: 1.6, from: 0.5, speed: 2.5, dmg: 47, range: 3.2, arc: 2.3, kb: 11, heavy: true, stamina: 20 }
  ],
  bo: [{ clip: 'spin', hit: [0.43, 1.2], win: [[0.3, 0.52], [1.08, 1.36]], reach: 1.5, chain: 99, cancel: 1.3, end: 1.7, speed: 1.5, root: 0.45, dmg: 20, range: 3.5, arc: Math.PI * 2, kb: 10, heavy: true, stamina: 22 }],
  kama: [{ clip: 'eSwordAttack', hit: [0.62], chain: 99, cancel: 0.85, end: 1.1, from: 0.35, speed: 1.6, dmg: 29, range: 6.5, arc: 1.15, kb: -7, heavy: true, stamina: 14 }],
  karate: [
    { clip: 'jab', hit: [0.3], eff: 'LH', win: [[0.22, 0.42]], reach: 0.5, chain: 0.45, cancel: 0.45, end: 0.8, speed: 1.4, dmg: 14, range: 2.0, arc: 1.25, kb: 3, stamina: 8 },
    { clip: 'cross', hit: [0.37], eff: 'RH', win: [[0.28, 0.5]], reach: 0.5, chain: 0.52, cancel: 0.52, end: 0.9, speed: 1.4, dmg: 17, range: 2.0, arc: 1.25, kb: 4, stamina: 9 },
    { clip: 'kick1', hit: [0.68], eff: 'RF', win: [[0.55, 0.82]], reach: 1.05, chain: 0.9, cancel: 0.9, end: 1.25, from: 0.15, speed: 1.6, dmg: 23, range: 2.6, arc: 1.05, kb: 9, stamina: 12 },
    { clip: 'kick2', hit: [0.75], eff: 'LF', win: [[0.62, 0.86]], reach: 1.0, chain: 99, cancel: 1.1, end: 1.5, from: 0.3, speed: 1.6, dmg: 33, range: 2.8, arc: 3.0, kb: 11, heavy: true, stamina: 16 }
  ],
  // throwables leave the off hand at `release` (spell-cast clip: the arm snaps forward)
  shuriken: [{ clip: 'cast', hit: [], release: 0.35, chain: 0.62, cancel: 0.55, end: 0.9, speed: 1.6, dmg: 12, range: 0, arc: 0, kb: 3, stamina: 8 }],
  kunai: [{ clip: 'cast', hit: [], release: 0.35, chain: 0.62, cancel: 0.55, end: 0.9, speed: 1.6, dmg: 35, range: 0, arc: 0, kb: 3, stamina: 9 }],
  bomb: [{ clip: 'cast', hit: [], release: 0.35, chain: 99, cancel: 0.55, end: 0.95, speed: 1.6, dmg: 53, range: 0, arc: 0, kb: 8, stamina: 0 }]
};

// Special attacks (scroll pick-ups), one move each
export const SPECIAL_MOVES: Record<string, ClipMove> = {
  katana: { clip: 'slash2', hit: [0.95], chain: 99, cancel: 1.25, end: 1.6, from: 0.5, speed: 1.9, dmg: 39, range: 2.9, arc: 2.1, kb: 6, heavy: true, stamina: 0 },
  bo: { clip: 'spin', hit: [], chain: 99, cancel: 1.6, end: 1.85, speed: 1.5, root: 0.45, dmg: 12, range: 3.4, arc: Math.PI * 2, kb: 5, stamina: 0 },
  kama: { clip: 'spin', hit: [0.47], chain: 99, cancel: 1.2, end: 1.6, speed: 1.5, dmg: 39, range: 7, arc: Math.PI * 2, kb: 6, heavy: true, stamina: 0 },
  shuriken: { clip: 'cast', hit: [], release: 0.35, chain: 99, cancel: 0.6, end: 0.95, speed: 1.6, dmg: 10, range: 0, arc: 0, kb: 3, stamina: 0 },
  kunai: { clip: 'eSwordAttack', hit: [0.62], chain: 99, cancel: 0.85, end: 1.1, from: 0.35, speed: 1.6, dmg: 105, range: 3, arc: 3, kb: 8, heavy: true, stamina: 0 },
  karate: { clip: 'jabL', eff: 'LH', hit: [0.33], chain: 99, cancel: 99, end: 0.9, speed: 1.75, dmg: 18, range: 3, arc: 3, kb: 2, stamina: 0 },
  bomb: { clip: 'cast', hit: [], release: 0.35, chain: 99, cancel: 0.6, end: 0.95, speed: 1.6, dmg: 30, range: 0, arc: 0, kb: 8, stamina: 0 }
};

// Karatê special flurry (Punho do Dragão): each step starts at the previous one's `chain`
export const RUSH: ClipMove[] = [
  { clip: 'jabL', eff: 'LH', hit: [0.33], chain: 0.42, cancel: 99, end: 0.9, speed: 1.75, dmg: 18, range: 3, arc: 3, kb: 2, stamina: 0 },
  { clip: 'jabR', eff: 'RH', hit: [0.25], chain: 0.36, cancel: 99, end: 0.9, speed: 1.75, dmg: 18, range: 3, arc: 3, kb: 2, stamina: 0 },
  { clip: 'cross', eff: 'RH', hit: [0.28], chain: 0.4, cancel: 99, end: 1.2, speed: 1.7, dmg: 21, range: 3, arc: 3, kb: 3, stamina: 0 },
  { clip: 'kick2', eff: 'LF', hit: [0.9], chain: 99, cancel: 1.2, end: 1.6, from: 0.2, speed: 1.6, dmg: 48, range: 3.2, arc: 3, kb: 10, heavy: true, stamina: 0 }
];

// Enemy samurai strikes: clip + its own hit frame. The AI's wind-up then simply IS the
// clip up to that frame, played a touch faster on combo follow-ups.
export const ENEMY_STRIKES: Record<string, { clip: string; hit: number; from?: number }[]> = {
  slash: [
    { clip: 'eSwordSlash', hit: 0.7, from: 0.12 },
    { clip: 'attack', hit: 0.5 }
  ],
  thrust: [{ clip: 'eSwordAttack', hit: 0.52 }],
  sweep: [{ clip: 'slash2', hit: 0.87, from: 0.1 }]
};

// The giant (boss): the Rōnin's heavy two-handed moves at its size - an overhead smash or
// a leaping slam for its normal strike, the wide sweep (jump it) for its perilous one
export const BOSS_STRIKES: Record<string, { clip: string; hit: number; from?: number }[]> = {
  smash: [
    { clip: 'slash1', hit: 0.62 },
    { clip: 'jumpAttack', hit: 1.07, from: 0.45 }
  ],
  sweep: [{ clip: 'slash2', hit: 0.87, from: 0.1 }]
};
