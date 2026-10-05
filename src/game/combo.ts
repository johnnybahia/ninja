// The hit counter in the manner of a fighting game: the words a streak earns as it grows, and the
// shout-outs (APARO PERFEITO!, MATANÇA!...) the engine sends to the HUD.

export interface ComboInfo {
  hits: number;
  damage: number; // total dealt by the streak so far
  win: number; // seconds the streak stays alive without another hit (the HUD draws it as a thin bar)
  rank: number; // 0 until the first word, then 1..COMBO_RANKS.length
  word: string;
  glyph: string;
  tick: number; // grows with every hit: the HUD pops the number again when it changes
  state: 'live' | 'done' | 'broken'; // running, ended by the clock, ended by a hit taken
}

export type CalloutTone = 'gold' | 'jade' | 'ember' | 'blood' | 'steel';

export interface Callout {
  id: number;
  word: string;
  glyph?: string;
  sub?: string;
  tone: CalloutTone;
}

export const COMBO_WINDOW = 1.6; // seconds a streak survives between hits

// the word shown from this many hits on, and the kanji that goes with it
export const COMBO_RANKS = [
  { at: 3, word: 'BOM!', glyph: '良' },
  { at: 5, word: 'ÓTIMO!', glyph: '優' },
  { at: 8, word: 'EXCELENTE!', glyph: '秀' },
  { at: 12, word: 'INCRÍVEL!', glyph: '極' },
  { at: 16, word: 'BRUTAL!', glyph: '激' },
  { at: 24, word: 'LENDÁRIO!', glyph: '神' }
] as const;

export const comboRank = (hits: number) => COMBO_RANKS.filter((r) => hits >= r.at).length;

// kills in a row (each within 2.2 s of the last) that earn a shout-out
export const KILL_CHAINS: Record<number, { word: string; glyph: string; tone: CalloutTone }> = {
  2: { word: 'DUPLA!', glyph: '二', tone: 'ember' },
  3: { word: 'TRIPLA!', glyph: '三', tone: 'ember' },
  4: { word: 'QUÁDRUPLA!', glyph: '四', tone: 'ember' },
  5: { word: 'MATANÇA!', glyph: '殺', tone: 'blood' },
  8: { word: 'CARNIFICINA!', glyph: '修羅', tone: 'blood' },
  12: { word: 'EXTERMÍNIO!', glyph: '滅', tone: 'blood' }
};
