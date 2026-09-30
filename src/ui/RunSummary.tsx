import { Swords } from 'lucide-react';
import { CARDS } from '../game/cards';
import { nextGoal, upgradeCost, type MetaSave, type RunSummary as Summary } from '../game/meta';

export interface RunResult {
  summary: Summary;
  before: number; // Honra before this run was banked
  after: number;
  prevBest: number;
  prevBestWave: number;
}

const RANK_COLOR: Record<string, string> = { S: '#ffd166', A: '#8fe0c8', B: '#9ec5ff', C: '#c9c2d6', D: '#8a8398' };

// After a run: what it earned, how close the next goal is, and a big "again" button - the
// point where a player decides whether there is one more run in them
export function RunSummary({
  result,
  meta,
  starting,
  loadPct,
  onAgain,
  onBuy,
  onTemple,
  onArsenal
}: {
  result: RunResult;
  meta: MetaSave;
  starting: boolean;
  loadPct: number;
  onAgain: () => void;
  onBuy: (id: string) => void;
  onTemple: () => void;
  onArsenal: () => void;
}) {
  const s = result.summary;
  const newRecord = s.score > result.prevBest;
  const goal = nextGoal(meta);
  const afford = goal ? meta.honor >= goal.cost : false;
  const lines: [string, number][] = [
    ['Ondas', s.honor.wave],
    ['Notas', s.honor.rank],
    ['Finalizações', s.honor.finish],
    ['Abates', s.honor.kill],
    ['Chefe', s.honor.boss]
  ];
  const cards = CARDS.filter((c) => (s.cards[c.id] ?? 0) > 0);
  const upCost = goal ? upgradeCost(goal.def, goal.lvl) : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-[rgba(22,18,31,0.88)] backdrop-blur-md z-30">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3">
      <div className="w-full max-w-2xl mx-auto min-h-full flex flex-col justify-center">
        <div className="text-center mb-3">
          <div className="short-hide font-serif text-6xl font-bold text-[var(--torii)] leading-none">散</div>
          <h2 className="font-serif text-2xl font-extrabold text-[var(--paper)] mt-1">Você caiu na onda {s.wave}</h2>
          <div className="text-sm text-[var(--paper)]/85 mt-1">
            <b className="text-[var(--ember)]">{s.score.toLocaleString('pt-BR')}</b> pontos ·{' '}
            {newRecord ? (
              <b className="text-[#ffd166]">NOVO RECORDE!</b>
            ) : (
              <span>{result.prevBest > 0 ? `faltaram ${(result.prevBest - s.score + 1).toLocaleString('pt-BR')} para o recorde` : 'sem recorde ainda'}</span>
            )}
          </div>
          {s.ranks.length > 0 && (
            <div className="flex justify-center gap-1.5 mt-2">
              {s.ranks.map((r, i) => (
                <span key={i} className="font-serif text-sm font-black w-6 h-6 rounded-full flex items-center justify-center border" style={{ color: RANK_COLOR[r], borderColor: RANK_COLOR[r] }}>
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-[rgba(239,230,210,0.2)] bg-[rgba(30,24,42,0.9)] p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-serif font-extrabold text-[var(--paper)]">Honra ganha</span>
              <span className="font-serif text-xl font-black text-[var(--ember)]">+{s.honor.total} 誉</span>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {lines
                .filter(([, v]) => v > 0)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[11px] text-[var(--paper)]/75">
                    <span>{k}</span>
                    <span>+{v}</span>
                  </div>
                ))}
            </div>
            <div className="text-[11px] text-[var(--paper)]/60 mt-1.5 border-t border-[rgba(239,230,210,0.12)] pt-1.5">
              Saldo: {meta.honor.toLocaleString('pt-BR')} 誉
            </div>
          </div>

          <div className="rounded-lg border border-[rgba(239,230,210,0.2)] bg-[rgba(30,24,42,0.9)] p-3 flex flex-col">
            {goal && upCost !== null ? (
              <>
                <span className="font-serif font-extrabold text-[var(--paper)]">Próxima melhoria</span>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="font-serif text-3xl font-black text-[var(--ember)] leading-none">{goal.def.glyph}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[var(--paper)]">
                      {goal.def.name} {goal.lvl + 1}
                    </div>
                    <div className="text-[11px] text-[var(--paper)]/70 leading-snug">{goal.def.desc}</div>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-[rgba(239,230,210,0.15)] overflow-hidden mt-2">
                  <div className="h-full bg-[var(--ember)]" style={{ width: `${Math.min(100, (meta.honor / upCost) * 100)}%` }} />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-[var(--paper)]/70">
                    {Math.min(meta.honor, upCost)}/{upCost} 誉
                  </span>
                  {afford && (
                    <button onClick={() => onBuy(goal.def.id)} className="text-xs font-extrabold px-3 py-1 rounded-md bg-[var(--torii)] text-[var(--paper)] cursor-pointer active:scale-95">
                      Comprar
                    </button>
                  )}
                </div>
                {!afford && <div className="text-[11px] text-[var(--ember)] mt-1">Faltam {upCost - meta.honor} 誉 — uma partida boa chega lá.</div>}
              </>
            ) : (
              <span className="font-serif font-extrabold text-[var(--jade)]">Todas as melhorias no máximo!</span>
            )}
          </div>
        </div>

        {cards.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {cards.map((c) => (
              <span key={c.id} className="text-[11px] px-2 py-0.5 rounded-full border border-[rgba(239,230,210,0.25)] text-[var(--paper)]/85 bg-[rgba(30,24,42,0.7)]">
                <b className="text-[var(--ember)] font-serif">{c.glyph}</b> {c.name}
                {(s.cards[c.id] ?? 0) > 1 ? ` ×${s.cards[c.id]}` : ''}
              </span>
            ))}
          </div>
        )}

      </div>
      </div>
      <div className="shrink-0 border-t border-[rgba(239,230,210,0.12)] bg-[rgba(16,12,24,0.9)] px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onAgain}
            disabled={starting}
            className="relative overflow-hidden font-serif font-extrabold text-lg bg-[var(--torii)] text-[var(--paper)] px-10 py-3 rounded-md hover:brightness-110 active:scale-95 transition-all shadow-lg cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            {starting && <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-200" style={{ width: `${loadPct}%` }} />}
            <span className="relative">{starting ? `Carregando… ${loadPct}%` : 'Jogar de novo'}</span>
          </button>
          <div className="flex gap-2">
            <button onClick={onTemple} className="flex items-center gap-1.5 font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-5 py-2 rounded-md active:scale-95 transition-all cursor-pointer">
              <span className="font-serif text-[var(--ember)]">誉</span> Templo
            </button>
            <button onClick={onArsenal} className="flex items-center gap-1.5 font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-5 py-2 rounded-md active:scale-95 transition-all cursor-pointer">
              <Swords className="w-4 h-4 text-[var(--ember)]" /> Trocar armas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
