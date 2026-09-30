// Wave modifiers: from wave 3 some waves change what the enemies ask of the player (not
// just how many there are). Boss waves (every 4th) never get one - the Oni is enough.

export type ModId = 'nevoa' | 'flechas' | 'ventania' | 'elite' | 'ferro';

export interface WaveMod {
  id: ModId;
  name: string;
  glyph: string;
  desc: string;
  honor: number; // extra Honra for clearing the wave
}

export const WAVE_MODS: WaveMod[] = [
  { id: 'nevoa', name: 'Névoa Densa', glyph: '霧', desc: 'Visão curta: os inimigos surgem de perto', honor: 14 },
  { id: 'flechas', name: 'Chuva de Flechas', glyph: '矢', desc: 'Mais arqueiros, menos samurais', honor: 14 },
  { id: 'ventania', name: 'Ventania', glyph: '風', desc: 'Inimigos 22% mais rápidos', honor: 16 },
  { id: 'elite', name: 'Elites', glyph: '精', desc: 'Samurais de elite: mais vida e dano, soltam pergaminho', honor: 18 },
  { id: 'ferro', name: 'Aço Temperado', glyph: '鉄', desc: 'A postura inimiga quebra bem mais devagar', honor: 16 }
];

export const modById = (id: string) => WAVE_MODS.find((m) => m.id === id);

export const MOD_MIN_WAVE = 3;
export const MOD_CHANCE = 0.55;

/** The modifier for `wave`, or null. Never the same one twice in a row. */
export function pickWaveMod(wave: number, prev: ModId | null, rnd: () => number = Math.random): WaveMod | null {
  if (wave < MOD_MIN_WAVE || wave % 4 === 0 || rnd() > MOD_CHANCE) return null;
  const pool = WAVE_MODS.filter((m) => m.id !== prev);
  return pool[Math.floor(rnd() * pool.length)] ?? null;
}
