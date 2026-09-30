// Daily missions and the day streak. Three missions a day (one per tier), picked from the
// local date so everyone's day matches and a reload can't reroll them. Progress is
// cumulative across the day's runs ('sum') or the best single run ('max'); a finished
// mission pays its Honra straight away when the run is banked.

import type { MetaSave, RunSummary } from './meta';

export type Stat = 'kills' | 'finishers' | 'deflects' | 'wave' | 'flawless' | 'bestCombo' | 'bossKills' | 'honor' | 'rank' | 'modWaves';

export interface MissionDef {
  id: string;
  tier: 1 | 2 | 3;
  stat: Stat;
  kind: 'sum' | 'max';
  target: number;
  reward: number;
  text: string;
}

const M = (id: string, tier: 1 | 2 | 3, stat: Stat, kind: 'sum' | 'max', target: number, text: string): MissionDef => ({
  id,
  tier,
  stat,
  kind,
  target,
  reward: tier === 1 ? 25 : tier === 2 ? 45 : 80,
  text
});

export const MISSION_POOL: MissionDef[] = [
  M('k20', 1, 'kills', 'sum', 20, 'Derrote 20 inimigos'),
  M('f3', 1, 'finishers', 'sum', 3, 'Execute 3 golpes finais'),
  M('d5', 1, 'deflects', 'sum', 5, 'Apare 5 golpes'),
  M('w3', 1, 'wave', 'max', 3, 'Chegue à onda 3'),
  M('k45', 2, 'kills', 'sum', 45, 'Derrote 45 inimigos'),
  M('f8', 2, 'finishers', 'sum', 8, 'Execute 8 golpes finais'),
  M('d15', 2, 'deflects', 'sum', 15, 'Apare 15 golpes'),
  M('w5', 2, 'wave', 'max', 5, 'Chegue à onda 5'),
  M('fl2', 2, 'flawless', 'sum', 2, 'Limpe 2 ondas sem levar dano'),
  M('m2', 2, 'modWaves', 'sum', 2, 'Limpe 2 ondas com desafio'),
  M('c8', 2, 'bestCombo', 'max', 8, 'Faça um combo de 8 golpes'),
  M('b1', 3, 'bossKills', 'sum', 1, 'Derrote o Oni'),
  M('w8', 3, 'wave', 'max', 8, 'Chegue à onda 8'),
  M('fl4', 3, 'flawless', 'sum', 4, 'Limpe 4 ondas sem levar dano'),
  M('rS', 3, 'rank', 'max', 4, 'Tire nota S em uma onda'),
  M('h150', 3, 'honor', 'max', 150, 'Ganhe 150 de Honra numa partida')
];

export interface DailyState {
  date: string; // YYYY-MM-DD (local)
  prog: Record<string, number>;
  done: string[];
}

export interface StreakState {
  last: string; // last day a run was banked
  count: number;
}

export const RANK_VAL: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

function seedOf(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's three missions: one per tier, the same for a given date. */
export function missionsFor(date: string): MissionDef[] {
  const rnd = mulberry(seedOf(date));
  return ([1, 2, 3] as const).map((tier) => {
    const pool = MISSION_POOL.filter((m) => m.tier === tier);
    return pool[Math.floor(rnd() * pool.length)];
  });
}

export const freshDaily = (date = ''): DailyState => ({ date, prog: {}, done: [] });
export const freshStreak = (): StreakState => ({ last: '', count: 0 });

/** Rolls the daily state over when a new day has started (a clock set back keeps today's). */
export function ensureDaily(m: MetaSave, today: string): MetaSave {
  if (m.daily.date && today <= m.daily.date) return m;
  return { ...m, daily: freshDaily(today) };
}

/** Streak still alive today (played today or yesterday). */
export function streakAlive(s: StreakState, today: string): boolean {
  return !!s.last && (s.last >= today || s.last === shiftDate(today, -1));
}

export function streakBonus(count: number): number {
  return count > 0 && count % 7 === 0 ? 60 : Math.min(40, 10 + 5 * (count - 1));
}

const statOf = (s: RunSummary, stat: Stat): number => {
  switch (stat) {
    case 'kills':
      return s.kills;
    case 'finishers':
      return s.finishers;
    case 'deflects':
      return s.deflects;
    case 'wave':
      return s.wave;
    case 'flawless':
      return s.flawless;
    case 'bestCombo':
      return s.bestCombo;
    case 'bossKills':
      return s.bossKills;
    case 'honor':
      return s.honor.total;
    case 'rank':
      return RANK_VAL[s.bestRank] ?? 0;
    case 'modWaves':
      return s.modWaves;
  }
};

export interface MissionDone {
  id: string;
  text: string;
  reward: number;
}

export interface MissionOutcome {
  meta: MetaSave;
  done: MissionDone[];
  streak: { count: number; bonus: number } | null; // set on the first run of a new day
}

/** Folds a finished run into the day's missions and the streak; pays what completed. */
export function applyRun(m0: MetaSave, s: RunSummary, today: string): MissionOutcome {
  let m = ensureDaily(m0, today);
  const day = m.daily;
  const prog = { ...day.prog };
  const done = [...day.done];
  const finished: MissionDone[] = [];
  let reward = 0;
  for (const def of missionsFor(day.date)) {
    if (done.includes(def.id)) continue;
    const v = statOf(s, def.stat);
    prog[def.id] = Math.min(def.target, def.kind === 'sum' ? (prog[def.id] ?? 0) + v : Math.max(prog[def.id] ?? 0, v));
    if (prog[def.id] >= def.target) {
      done.push(def.id);
      finished.push({ id: def.id, text: def.text, reward: def.reward });
      reward += def.reward;
    }
  }
  let streak: MissionOutcome['streak'] = null;
  let st = m.streak;
  if (st.last !== today && !(st.last > today)) {
    const count = st.last === shiftDate(today, -1) ? st.count + 1 : 1;
    const bonus = streakBonus(count);
    st = { last: today, count };
    streak = { count, bonus };
    reward += bonus;
  }
  m = { ...m, honor: m.honor + reward, daily: { date: day.date, prog, done }, streak: st };
  return { meta: m, done: finished, streak };
}
