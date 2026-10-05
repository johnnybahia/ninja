import { Swords } from 'lucide-react';
import { CARDS } from '../game/cards';
import { nextGoal, upgradeCost, type MetaSave, type RunSummary as Summary } from '../game/meta';
import type { MissionDone } from '../game/missions';
import type { RankData } from '../game/ranking';
import { ArcadeBoard } from './ArcadeBoard';

export interface RunResult {
  summary: Summary;
  before: number; // Honra before this run was banked
  after: number;
  prevBest: number;
  prevBestWave: number;
  missions: MissionDone[]; // finished by this run (already paid)
  streak: { count: number; bonus: number } | null; // first run of a new day
}

// The ranking as this run left it: the score is being sent, the table is in, or there is no
// connection (the table is the last copy kept, the score still pending)
export interface RunBoard {
  state: 'sending' | 'ready' | 'offline';
  data: RankData | null;
  score: number;
  wave: number;
  isBest: boolean; // this run set the player's best score
  name: string;
  pending: boolean; // the score has not reached the server yet
}

const SHOWN_AFTER_RUN = 5;

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
  onArsenal,
  board,
  mode = 'waves',
  onJoin,
  onRanking,
  onPlayRanked,
  onChangeMode
}: {
  result: RunResult;
  meta: MetaSave;
  starting: boolean;
  loadPct: number;
  onAgain: () => void;
  onBuy: (id: string) => void;
  onTemple: () => void;
  onArsenal: () => void;
  board?: RunBoard | null; // the ranking after this run (none: ranking off, or the run didn't count)
  mode?: 'waves' | 'conquest';
  onJoin?: () => void; // ranking on but the player hasn't joined this session
  onRanking?: () => void;
  onChangeMode?: () => void;
  onPlayRanked?: () => void; // a Conquista run doesn't rank: offers a ranked Ondas run instead
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
    ['Desafios', s.honor.mod],
    ['Chefe', s.honor.boss]
  ];
  const cards = CARDS.filter((c) => (s.cards[c.id] ?? 0) > 0);
  const upCost = goal ? upgradeCost(goal.def, goal.lvl) : null;
  const me = board?.state === 'ready' ? board.data?.me : undefined;
  const banner = !board || board.state === 'sending' ? '' : me ? (board.isBest ? (me.rank === 1 ? 'NOVO CAMPEÃO!' : `NOVA POSIÇÃO #${me.rank}!`) : `SUA MELHOR POSIÇÃO: #${me.rank}`) : '';

  return (
    <div className="fixed inset-0 flex flex-col bg-[rgba(22,18,31,0.94)] z-30">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3">
      <div className="w-full max-w-2xl mx-auto min-h-full flex flex-col justify-center">
        <div className="text-center mb-3">
          <div className="short-hide font-serif text-6xl font-bold text-[var(--torii)] leading-none">散</div>
          <h2 className="font-serif text-2xl font-extrabold text-[var(--paper)] mt-1">Você caiu {mode === 'conquest' ? 'no posto' : 'na onda'} {s.wave}</h2>
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

        <div className="text-center text-xs text-[var(--paper)]/80 mb-3">
          Honra <b className="text-[var(--ember)]">+{s.honor.total} 誉</b>
          {goal && upCost !== null && (
            <>
              {' '}
              · {afford ? <b className="text-[var(--jade)]">dá para comprar</b> : <>faltam {upCost - meta.honor} 誉 para</>} {goal.def.name} {goal.lvl + 1}
            </>
          )}
        </div>

        {board && (
          <section className="mb-4 rounded-lg border border-[rgba(239,230,210,0.25)] bg-[rgba(10,8,18,0.85)] px-2.5 py-3">
            <div className="text-center font-serif text-xs tracking-[0.35em] text-[var(--paper)]/60">頂 RANKING 頂</div>
            {banner && <div className="arcade-blink text-center font-serif text-lg font-black tracking-widest text-[#ffd166] mt-1">{banner}</div>}
            <div className="mt-2">
              {board.state === 'sending' && !board.data && <div className="arcade-blink text-center font-mono text-sm text-[var(--paper)]/70 py-5">ATUALIZANDO…</div>}
              {board.data && board.data.top.length > 0 && (
                <ArcadeBoard top={board.data.top} me={board.state === 'offline' ? undefined : board.data.me} limit={SHOWN_AFTER_RUN} pending={board.pending ? { score: board.score, wave: board.wave } : null} playerName={board.name} />
              )}
              {board.state === 'offline' && <div className="text-center text-[11px] text-[#ff9a7a] mt-1.5">Sem conexão: sua pontuação será enviada na próxima vez.</div>}
            </div>
            {onRanking && (
              <div className="text-center mt-2">
                <button onClick={onRanking} className="text-[11px] font-bold text-[var(--paper)]/70 underline cursor-pointer">
                  Ver o ranking completo (top 20)
                </button>
              </div>
            )}
          </section>
        )}

        {onPlayRanked && (
          <section className="mb-4 rounded-lg border border-[rgba(239,230,210,0.25)] bg-[rgba(10,8,18,0.85)] px-3 py-3 text-center">
            <div className="font-serif text-xs tracking-[0.35em] text-[var(--paper)]/60">頂 RANKING 頂</div>
            <p className="text-xs text-[var(--paper)]/80 mt-1.5">Esta partida de Conquista não conta para o ranking. Só o modo Ondas é ranqueado.</p>
            <button onClick={onPlayRanked} className="mt-2 text-xs font-extrabold bg-[var(--torii)] border border-[var(--torii)] text-[var(--paper)] px-4 py-1.5 rounded-md active:scale-95 transition-all cursor-pointer">
              Jogar Ondas (ranqueado)
            </button>
          </section>
        )}

        {!board && onJoin && (
          <section className="mb-4 rounded-lg border border-[rgba(239,230,210,0.25)] bg-[rgba(10,8,18,0.85)] px-3 py-3 text-center">
            <div className="font-serif text-xs tracking-[0.35em] text-[var(--paper)]/60">頂 RANKING 頂</div>
            <p className="text-xs text-[var(--paper)]/80 mt-1.5">Escolha um nome para guardar suas pontuações no ranking de todos os jogadores.</p>
            <button onClick={onJoin} className="mt-2 text-xs font-extrabold bg-[var(--torii)] border border-[var(--torii)] text-[var(--paper)] px-4 py-1.5 rounded-md active:scale-95 transition-all cursor-pointer">
              Entrar no ranking
            </button>
          </section>
        )}

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

        {(result.missions.length > 0 || result.streak) && (
          <div className="rounded-lg border border-[rgba(143,224,200,0.45)] bg-[rgba(24,44,40,0.75)] p-3 mb-4">
            {result.missions.map((m) => (
              <div key={m.id} className="flex justify-between text-xs text-[var(--paper)]">
                <span>
                  <b className="text-[var(--jade)]">✓ Missão cumprida</b> · {m.text}
                </span>
                <b className="text-[var(--ember)]">+{m.reward} 誉</b>
              </div>
            ))}
            {result.streak && (
              <div className="flex justify-between text-xs text-[var(--paper)]">
                <span>
                  <b className="text-[var(--jade)]">Sequência</b> · {result.streak.count} {result.streak.count === 1 ? 'dia' : 'dias seguidos'}
                </span>
                <b className="text-[var(--ember)]">+{result.streak.bonus} 誉</b>
              </div>
            )}
          </div>
        )}

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
            <span className={`relative ${starting ? '' : 'arcade-blink'}`}>{starting ? `Carregando… ${loadPct}%` : board ? 'TOQUE PARA JOGAR DE NOVO' : 'Jogar de novo'}</span>
          </button>
          <div className="flex flex-wrap justify-center gap-2">
            <button onClick={onTemple} className="flex items-center gap-1.5 font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-4 py-2 rounded-md whitespace-nowrap active:scale-95 transition-all cursor-pointer">
              <span className="font-serif text-[var(--ember)]">誉</span> Templo
            </button>
            {onRanking && (
              <button onClick={onRanking} className="flex items-center gap-1.5 font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-4 py-2 rounded-md whitespace-nowrap active:scale-95 transition-all cursor-pointer">
                <span className="font-serif text-[var(--ember)]">頂</span> Ranking
              </button>
            )}
            {onChangeMode && (
              <button onClick={onChangeMode} className="flex items-center gap-1.5 font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-4 py-2 rounded-md whitespace-nowrap active:scale-95 transition-all cursor-pointer">
                <span className="font-serif text-[var(--ember)]">波</span> Trocar de modo
              </button>
            )}
            <button onClick={onArsenal} className="flex items-center gap-1.5 font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-4 py-2 rounded-md whitespace-nowrap active:scale-95 transition-all cursor-pointer">
              <Swords className="w-4 h-4 text-[var(--ember)]" /> Trocar armas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
