// Meta-progression: 誉 Honra, earned in every run (win or lose) and spent between runs on
// small permanent upgrades. Deliberately capped (see MAX_BONUS): the upgrades smooth the
// early game, they never replace skill. Saved in localStorage as a versioned blob; when
// storage is blocked the game keeps working with progress held in memory for the session.

export const META_KEY = 'kage_meta_v1';

export interface MetaSave {
  v: 1;
  honor: number;
  up: Record<string, number>;
  runs: number;
  bestWave: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  glyph: string;
  desc: string; // what one level gives
  max: number;
  base: number; // cost of the first level
  growth: number; // cost multiplier per level owned
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'vigor', name: 'Vigor', glyph: '体', desc: '+4 de vida máxima', max: 5, base: 40, growth: 1.5 },
  { id: 'folego', name: 'Fôlego', glyph: '息', desc: '+5 de stamina máxima', max: 4, base: 40, growth: 1.5 },
  { id: 'lamina', name: 'Lâmina Afiada', glyph: '刃', desc: '+2% de dano', max: 5, base: 60, growth: 1.5 },
  { id: 'guarda', name: 'Guarda Firme', glyph: '守', desc: 'A postura se recupera 15% mais rápido', max: 3, base: 80, growth: 1.5 },
  { id: 'heranca', name: 'Herança', glyph: '巻', desc: 'Começa com o especial da arma principal (+6 s por nível)', max: 3, base: 100, growth: 1.7 },
  { id: 'cabaca', name: 'Cabaça Grande', glyph: '瓢', desc: '+1 gole de cura por onda', max: 2, base: 120, growth: 2 }
];

export const upgradeById = (id: string) => UPGRADES.find((u) => u.id === id);

/** Honra to buy the next level of `def` given the current level, or null when maxed. */
export function upgradeCost(def: UpgradeDef, lvl: number): number | null {
  if (lvl >= def.max) return null;
  return Math.round((def.base * Math.pow(def.growth, lvl)) / 5) * 5;
}

// What the owned upgrades add to a run (all small on purpose)
export interface MetaBonus {
  hp: number;
  st: number;
  dmg: number; // fraction, 0.1 = +10%
  heals: number;
  startSpecial: number; // seconds of the primary weapon's special at the start of the run
  postureRecov: number; // fraction
}

export const NO_BONUS: MetaBonus = { hp: 0, st: 0, dmg: 0, heals: 0, startSpecial: 0, postureRecov: 0 };

export function bonusesFor(m: MetaSave): MetaBonus {
  const L = (id: string) => m.up[id] ?? 0;
  return {
    hp: 4 * L('vigor'),
    st: 5 * L('folego'),
    dmg: 0.02 * L('lamina'),
    heals: L('cabaca'),
    startSpecial: 6 * L('heranca'),
    postureRecov: 0.15 * L('guarda')
  };
}

// How Honra is earned in a run (engine.ts applies the Espólio card's multiplier on top)
export const HONOR = {
  kill: { samurai: 1, archer: 2, boss: 0 } as Record<string, number>,
  finisher: 4,
  boss: 40,
  waveBase: 8,
  wavePer: 2,
  rank: { S: 30, A: 20, B: 12, C: 6, D: 0 } as Record<string, number>
};

export interface HonorBreakdown {
  kill: number;
  finish: number;
  wave: number;
  boss: number;
  rank: number;
}

export interface RunSummary {
  score: number;
  wave: number;
  level: number;
  kills: number;
  bestCombo: number;
  finishers: number;
  honor: HonorBreakdown & { total: number };
  cards: Record<string, number>;
  ranks: string[];
}

export function freshMeta(): MetaSave {
  return { v: 1, honor: 0, up: {}, runs: 0, bestWave: 0 };
}

// Anything read from storage is untrusted: rebuild the blob field by field
function sanitize(raw: unknown): MetaSave {
  const m = freshMeta();
  if (!raw || typeof raw !== 'object') return m;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, Math.floor(v))) : 0);
  m.honor = num(r.honor);
  m.runs = num(r.runs);
  m.bestWave = num(r.bestWave, 9999);
  if (r.up && typeof r.up === 'object') {
    for (const def of UPGRADES) {
      m.up[def.id] = num((r.up as Record<string, unknown>)[def.id], def.max);
    }
  }
  return m;
}

let memory: MetaSave | null = null;
let persistent = true;

/** True while the last save reached localStorage (false: progress lives in memory only). */
export const metaPersistent = () => persistent;

export function loadMeta(): MetaSave {
  try {
    const s = localStorage.getItem(META_KEY);
    persistent = true;
    if (s) return sanitize(JSON.parse(s));
  } catch {
    persistent = false;
    if (memory) return memory;
  }
  return freshMeta();
}

export function saveMeta(m: MetaSave): boolean {
  memory = m;
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
    persistent = true;
  } catch {
    persistent = false;
  }
  return persistent;
}

/** Buys one level, or returns null (maxed / not enough Honra). */
export function buyUpgrade(m: MetaSave, id: string): MetaSave | null {
  const def = upgradeById(id);
  if (!def) return null;
  const lvl = m.up[id] ?? 0;
  const cost = upgradeCost(def, lvl);
  if (cost === null || m.honor < cost) return null;
  return { ...m, honor: m.honor - cost, up: { ...m.up, [id]: lvl + 1 } };
}

export function bankRun(m: MetaSave, s: RunSummary): MetaSave {
  return { ...m, honor: m.honor + Math.round(s.honor.total), runs: m.runs + 1, bestWave: Math.max(m.bestWave, s.wave) };
}

/** The cheapest upgrade still to buy: the "one more run" goal shown after a run. */
export function nextGoal(m: MetaSave): { def: UpgradeDef; lvl: number; cost: number } | null {
  let best: { def: UpgradeDef; lvl: number; cost: number } | null = null;
  for (const def of UPGRADES) {
    const lvl = m.up[def.id] ?? 0;
    const cost = upgradeCost(def, lvl);
    if (cost !== null && (!best || cost < best.cost)) best = { def, lvl, cost };
  }
  return best;
}
