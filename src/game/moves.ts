// Souls-style move sets for the mocap Rōnin (clipRig.ts). Every timing below is in clip
// seconds, read off the clips themselves: `hit` is where the blade/fist/foot reaches its
// peak speed (measured from the mocap, see scripts/), which is when damage lands.
//
//   chain:  from here a buffered attack press starts the next move of the combo
//   cancel: from here a dodge or guard may interrupt the recovery
//   end:    the move releases the character (the clip's own tail is only a blend-out)
//
// Moves commit: no steering after the hit, no walking during the swing - the clip's own
// footwork (and root motion, where a move lunges) is all the movement there is. Damage is
// scaled up from the old arcade values to match the slower cadence (~1 hit/s instead of
// ~3), and each swing costs stamina.

export interface ClipMove {
  clip: string;
  hit: number[];
  chain: number;
  cancel: number;
  end: number;
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
  katana: [
    { clip: 'attack', hit: [0.5], chain: 0.62, cancel: 0.62, end: 1.05, dmg: 30, range: 2.9, arc: 2.1, kb: 4, stamina: 12 },
    { clip: 'slash1', hit: [0.62], chain: 0.78, cancel: 0.75, end: 1.15, dmg: 34, range: 2.9, arc: 2.1, kb: 5, stamina: 14 },
    { clip: 'slash3', hit: [1.0], chain: 99, cancel: 1.25, end: 1.62, root: 0.8, dmg: 62, range: 3.2, arc: 2.3, kb: 11, heavy: true, stamina: 20 }
  ],
  bo: [{ clip: 'spin', hit: [0.47, 1.1], chain: 99, cancel: 1.3, end: 1.7, root: 0.45, dmg: 26, range: 3.5, arc: Math.PI * 2, kb: 10, heavy: true, stamina: 22 }],
  kama: [{ clip: 'attack', hit: [0.5], chain: 99, cancel: 0.62, end: 1.0, dmg: 38, range: 6.5, arc: 1.15, kb: -7, heavy: true, stamina: 14 }],
  karate: [
    { clip: 'jab', hit: [0.22], chain: 0.34, cancel: 0.34, end: 0.7, dmg: 18, range: 2.0, arc: 1.25, kb: 3, stamina: 8 },
    { clip: 'cross', hit: [0.28], chain: 0.42, cancel: 0.42, end: 0.8, dmg: 22, range: 2.0, arc: 1.25, kb: 4, stamina: 9 },
    { clip: 'kick1', hit: [0.68], chain: 0.9, cancel: 0.9, end: 1.25, dmg: 30, range: 2.6, arc: 1.05, kb: 9, stamina: 12 },
    { clip: 'kick2', hit: [0.9], chain: 99, cancel: 1.2, end: 1.6, dmg: 44, range: 2.8, arc: 3.0, kb: 11, heavy: true, stamina: 16 }
  ],
  // throwables leave the off hand at `release` (spell-cast clip: the arm snaps forward)
  shuriken: [{ clip: 'cast', hit: [], release: 0.35, chain: 0.62, cancel: 0.55, end: 0.9, speed: 1.25, dmg: 16, range: 0, arc: 0, kb: 3, stamina: 8 }],
  kunai: [{ clip: 'cast', hit: [], release: 0.35, chain: 0.62, cancel: 0.55, end: 0.9, speed: 1.25, dmg: 46, range: 0, arc: 0, kb: 3, stamina: 9 }],
  bomb: [{ clip: 'cast', hit: [], release: 0.35, chain: 99, cancel: 0.55, end: 0.95, speed: 1.1, dmg: 70, range: 0, arc: 0, kb: 8, stamina: 0 }]
};

// Special attacks (scroll pick-ups), one move each
export const SPECIAL_MOVES: Record<string, ClipMove> = {
  katana: { clip: 'slash2', hit: [0.87], chain: 99, cancel: 1.2, end: 1.55, dmg: 52, range: 2.9, arc: 2.1, kb: 6, heavy: true, stamina: 0 },
  bo: { clip: 'spin', hit: [], chain: 99, cancel: 1.6, end: 1.85, root: 0.45, dmg: 16, range: 3.4, arc: Math.PI * 2, kb: 5, stamina: 0 },
  kama: { clip: 'spin', hit: [0.47], chain: 99, cancel: 1.2, end: 1.6, dmg: 52, range: 7, arc: Math.PI * 2, kb: 6, heavy: true, stamina: 0 },
  shuriken: { clip: 'cast', hit: [], release: 0.35, chain: 99, cancel: 0.6, end: 0.95, speed: 1.1, dmg: 13, range: 0, arc: 0, kb: 3, stamina: 0 },
  kunai: { clip: 'attack', hit: [0.5], chain: 99, cancel: 0.7, end: 1.05, speed: 1.15, dmg: 140, range: 3, arc: 3, kb: 8, heavy: true, stamina: 0 },
  karate: { clip: 'jabL', hit: [0.33], chain: 99, cancel: 99, end: 0.9, dmg: 24, range: 3, arc: 3, kb: 2, stamina: 0 },
  bomb: { clip: 'cast', hit: [], release: 0.35, chain: 99, cancel: 0.6, end: 0.95, speed: 1.1, dmg: 40, range: 0, arc: 0, kb: 8, stamina: 0 }
};

// Karatê special flurry (Punho do Dragão): each step starts at the previous one's `chain`
export const RUSH: ClipMove[] = [
  { clip: 'jabL', hit: [0.33], chain: 0.42, cancel: 99, end: 0.9, speed: 1.35, dmg: 24, range: 3, arc: 3, kb: 2, stamina: 0 },
  { clip: 'jabR', hit: [0.25], chain: 0.36, cancel: 99, end: 0.9, speed: 1.35, dmg: 24, range: 3, arc: 3, kb: 2, stamina: 0 },
  { clip: 'cross', hit: [0.28], chain: 0.4, cancel: 99, end: 1.2, speed: 1.3, dmg: 28, range: 3, arc: 3, kb: 3, stamina: 0 },
  { clip: 'kick2', hit: [0.9], chain: 99, cancel: 1.2, end: 1.6, dmg: 64, range: 3.2, arc: 3, kb: 10, heavy: true, stamina: 0 }
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
