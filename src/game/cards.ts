// Level-up cards: each level offers three, the player keeps one. Every card has a hard
// cap so stacking can't break the fights (see engine.ts for where each is applied).

export interface CardDef {
  id: string;
  name: string;
  glyph: string;
  max: number;
  desc: (lvl: number) => string; // what taking the card at `lvl` (1-based) does
}

export const CARDS: CardDef[] = [
  { id: 'lamina', name: 'Fio Cortante', glyph: '斬', max: 5, desc: () => '+7% de dano' },
  { id: 'gume', name: 'Gume Mortal', glyph: '刃', max: 4, desc: () => 'Mais chance de golpe crítico' },
  { id: 'vigor', name: 'Corpo de Aço', glyph: '鋼', max: 4, desc: () => '+10 de vida máxima e cura 10' },
  { id: 'folego', name: 'Pulmões de Vento', glyph: '風', max: 4, desc: () => '+12 de stamina e recupera mais rápido' },
  { id: 'passo', name: 'Passo Leve', glyph: '軽', max: 3, desc: () => 'A esquiva gasta 3 a menos de stamina' },
  { id: 'sombra', name: 'Passo Sombrio', glyph: '影', max: 3, desc: () => 'A esquiva protege por mais tempo' },
  { id: 'ferro', name: 'Postura de Ferro', glyph: '鉄', max: 3, desc: () => 'A postura se recupera 20% mais rápido' },
  { id: 'sede', name: 'Sede de Sangue', glyph: '血', max: 3, desc: (l) => `Cada golpe final cura ${6 * l} de vida` },
  { id: 'pergaminho', name: 'Pergaminho Longo', glyph: '巻', max: 3, desc: () => 'O botão do Ougi dura 5 s a mais' },
  { id: 'cabaca', name: 'Cabaça Cheia', glyph: '瓢', max: 2, desc: () => '+1 gole de cura por onda' },
  { id: 'espolio', name: 'Espólio', glyph: '誉', max: 3, desc: () => '+15% de Honra ganha' }
];

export const cardById = (id: string) => CARDS.find((c) => c.id === id);

/** Three distinct cards that aren't maxed yet (fewer if the pool runs dry). */
export function drawCards(owned: Record<string, number>, n = 3, rnd: () => number = Math.random): string[] {
  const pool = CARDS.filter((c) => (owned[c.id] ?? 0) < c.max).map((c) => c.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

export interface CardOffer {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  level: number; // level this pick brings the card to
  max: number;
}

export function describeOffer(ids: string[], owned: Record<string, number>): CardOffer[] {
  return ids.flatMap((id) => {
    const c = cardById(id);
    if (!c) return [];
    const level = (owned[id] ?? 0) + 1;
    return [{ id, name: c.name, glyph: c.glyph, desc: c.desc(level), level, max: c.max }];
  });
}
