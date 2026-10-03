// Global ranking client. The scores live in a Google Sheet behind an Apps Script Web App
// (scripts/ranking/): every browser posts to the same place, so the ranking is shared by
// everyone who plays, wherever they play from. While RANKING_URL is empty the game shows
// no ranking UI at all.
//
// The player is a random id plus a name kept in localStorage (like the rest of the saves);
// the id is the identity, the server keeps the best score per id. A score that could not be
// sent (offline, script busy) stays pending and goes out the next time around.

/** Web App URL ending in /exec (see scripts/ranking/README.md). VITE_RANKING_URL overrides it
 *  (tests, another deployment). */
export const RANKING_URL: string = (import.meta.env.VITE_RANKING_URL as string | undefined) || 'https://script.google.com/macros/s/AKfycbxRDzMV6fB3-1n-MFWuxOMqoo7NWrDrIe6-zNTbDElbaz_AuBUtiNHwpNksWTo3jmdelQ/exec';

export const rankingEnabled = () => RANKING_URL !== '';

const PLAYER_KEY = 'kage_player_v1';
const CACHE_KEY = 'kage_rank_cache_v1';
const SESSION_KEY = 'kage_rank_ok';
const TIMEOUT_MS = 15000; // Apps Script can take a few seconds on a cold start

export const NAME_MIN = 2;
export const NAME_MAX = 16;

export interface Player {
  id: string;
  name: string;
  sent: number; // best score the server has accepted from this player
  pending?: { score: number; wave: number };
}

export interface RankEntry {
  n: string;
  s: number;
  w: number;
}

export interface RankData {
  top: RankEntry[];
  total: number;
  me?: { rank: number; n: string; s: number; w: number };
  stale?: boolean; // the last copy kept on this device (no connection)
}

export type RankError = 'name_taken' | 'bad_name' | 'busy' | 'network' | 'other';

export const ERROR_TEXT: Record<RankError, string> = {
  name_taken: 'Esse nome já está em uso. Escolha outro.',
  bad_name: `Use de ${NAME_MIN} a ${NAME_MAX} letras, números ou espaços (sem palavrões).`,
  busy: 'Muitas tentativas seguidas. Tente de novo em instantes.',
  network: 'Sem conexão com o ranking. Tente de novo.',
  other: 'Não deu certo. Tente de novo.'
};

// ---- storage (blocked storage: the player lives in memory for the session) ----------------
let memPlayer: Player | null = null;
let memSession = false;

export function loadPlayer(): Player | null {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Player>;
      if (typeof p.id === 'string' && typeof p.name === 'string') {
        return { id: p.id, name: p.name, sent: Number(p.sent) || 0, pending: p.pending && Number(p.pending.score) > 0 ? { score: Number(p.pending.score), wave: Number(p.pending.wave) || 1 } : undefined };
      }
    }
  } catch {
    /* fall through */
  }
  return memPlayer;
}

export function savePlayer(p: Player) {
  memPlayer = p;
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
  } catch {
    /* kept in memory */
  }
}

/** The player already said "it's me" in this browser session (no need to ask again). */
export function confirmedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return memSession;
  }
}

export function confirmSession() {
  memSession = true;
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* kept in memory */
  }
}

export function newPlayerId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/** The name as it would be saved, or null when it breaks the rules (the server checks again). */
export function cleanName(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < NAME_MIN || s.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N} ._-]+$/u.test(s)) return null;
  return s;
}

// ---- network -------------------------------------------------------------------------------
interface Reply {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

async function request(url: string, init?: RequestInit): Promise<Reply> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return (await res.json()) as Reply;
  } finally {
    clearTimeout(t);
  }
}

// text/plain keeps this a "simple" request: no CORS preflight, which Apps Script can't answer
const post = (body: object) => request(RANKING_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });

const asError = (e?: string): RankError => (e === 'name_taken' || e === 'bad_name' ? e : e === 'busy' || e === 'slow_down' ? 'busy' : 'other');

/** Claims `name` for `id` (or renames the player). */
export async function registerName(id: string, name: string): Promise<{ ok: true; name: string } | { ok: false; error: RankError }> {
  if (!rankingEnabled()) return { ok: false, error: 'other' };
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: 'bad_name' };
  try {
    const r = await post({ action: 'register', id, name: clean });
    return r.ok ? { ok: true, name: typeof r.name === 'string' ? r.name : clean } : { ok: false, error: asError(r.error) };
  } catch {
    return { ok: false, error: 'network' };
  }
}

let flushing = false;

/** Sends the pending score, if any. Safe to call anytime; a failed send stays pending. */
export async function flushPending(): Promise<boolean> {
  const p = loadPlayer();
  if (!rankingEnabled() || !p?.pending || flushing) return false;
  if (p.pending.score <= p.sent) {
    savePlayer({ ...p, pending: undefined });
    return false;
  }
  flushing = true;
  try {
    const r = await post({ action: 'score', id: p.id, name: p.name, score: p.pending.score, wave: p.pending.wave });
    const cur = loadPlayer() ?? p;
    if (r.ok) {
      savePlayer({ ...cur, sent: Math.max(cur.sent, p.pending.score), pending: cur.pending && cur.pending.score > p.pending.score ? cur.pending : undefined });
      return true;
    }
    // a score the server refuses outright (too high for the wave) is dropped; the rest retries later
    if (r.error === 'bad_score') savePlayer({ ...cur, pending: undefined });
  } catch {
    /* offline: stays pending */
  } finally {
    flushing = false;
  }
  return false;
}

/** Queues the run's score for the ranking and tries to send it right away. */
export async function submitScore(score: number, wave: number): Promise<boolean> {
  const p = loadPlayer();
  if (!rankingEnabled() || !p || !(score > 0) || score <= p.sent) return false;
  if (!p.pending || score > p.pending.score) savePlayer({ ...p, pending: { score: Math.round(score), wave: Math.max(1, Math.round(wave)) } });
  return flushPending();
}

/** The top of the ranking (and this player's place). Falls back to the copy kept on this device. */
export async function fetchRanking(id?: string): Promise<RankData | null> {
  if (!rankingEnabled()) return null;
  try {
    const q = `?action=top${id ? `&id=${encodeURIComponent(id)}` : ''}`;
    const r = await request(RANKING_URL + q);
    if (!r.ok || !Array.isArray(r.top)) throw new Error('bad reply');
    const data: RankData = { top: r.top as RankEntry[], total: Number(r.total) || 0, me: r.me as RankData['me'] };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      /* cache is optional */
    }
    return data;
  } catch {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return { ...(JSON.parse(raw) as RankData), stale: true };
    } catch {
      /* nothing cached */
    }
    return null;
  }
}
