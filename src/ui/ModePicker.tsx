import type { Player } from '../game/ranking';

export type GameMode = 'waves' | 'conquest';

export interface RankStatus {
  rankOn: boolean; // the ranking exists at all (RANKING_URL set)
  rankActive: boolean; // the player joined it this session
  practice: boolean; // ?wave=N practice run: nothing counts
}

/** What this choice means for the ranking, in few words (used by the start button too). */
export function modeNote(mode: GameMode, r: RankStatus): { ranked: boolean; text: string } {
  if (mode === 'conquest') return { ranked: false, text: 'sem ranking' };
  if (!r.rankOn) return { ranked: false, text: 'recorde só neste aparelho' };
  if (r.practice) return { ranked: false, text: 'treino · sem ranking' };
  if (!r.rankActive) return { ranked: false, text: 'sem nome: não ranqueia' };
  return { ranked: true, text: 'ranqueado' };
}

function badgeText(mode: GameMode, r: RankStatus, player: Player | null): string {
  if (mode === 'conquest') return 'Sem ranking';
  if (!r.rankOn) return 'Só recorde neste aparelho';
  if (r.practice) return 'Treino · não conta';
  return r.rankActive ? `Ranqueado · jogando como ${player?.name ?? ''}` : 'Ranqueado · você ainda não entrou';
}

const MODES: { id: GameMode; glyph: string; name: string; goal: string; lines: string[] }[] = [
  {
    id: 'waves',
    glyph: '波',
    name: 'Ondas',
    goal: 'Aguente o máximo que puder',
    lines: ['Inimigos chegam em ondas cada vez mais fortes, com um chefe a cada 4 ondas.', 'Não tem fim: acaba quando você cai. Sua pontuação é a que vale no ranking.']
  },
  {
    id: 'conquest',
    glyph: '旗',
    name: 'Conquista',
    goal: 'Tome o território',
    lines: ['Há 3 postos inimigos espalhados pelo campo. Em cada um, derrote o capitão da guarnição.', 'Patrulhas rondam entre os postos. Com os 3 tomados, os reforços voltam mais fortes. Não conta para o ranking.']
  }
];

// The choice of how to play, as two cards: what each mode is, and whether it is ranked.
export function ModePicker({
  mode,
  onChange,
  status,
  player,
  onJoin
}: {
  mode: GameMode;
  onChange: (m: GameMode) => void;
  status: RankStatus;
  player: Player | null;
  onJoin: () => void; // opens the name screen
}) {
  return (
    <div className="mb-4 text-left">
      <div className="font-serif text-xs tracking-[0.3em] text-[var(--paper)]/60 text-center mb-2">ESCOLHA O MODO DE JOGO</div>
      <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Modo de jogo">
        {MODES.map((m) => {
          const on = mode === m.id;
          const note = modeNote(m.id, status);
          const needsJoin = m.id === 'waves' && status.rankOn && !status.practice && !status.rankActive;
          return (
            <div
              key={m.id}
              className={`relative flex flex-col rounded-lg border-2 p-3 transition-colors ${on ? 'border-[var(--ember)] bg-[rgba(255,170,90,0.10)]' : 'border-[rgba(239,230,210,0.2)] bg-[rgba(22,18,31,0.6)] hover:border-[rgba(239,230,210,0.4)]'}`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`font-serif text-3xl font-black leading-none ${on ? 'text-[var(--ember)]' : 'text-[var(--paper)]/60'}`}>{m.glyph}</span>
                <div className="min-w-0 flex-1">
                  <button
                    role="radio"
                    aria-checked={on}
                    aria-describedby={`mode-desc-${m.id}`}
                    onClick={() => onChange(m.id)}
                    className="font-serif text-lg font-extrabold text-[var(--paper)] leading-tight text-left cursor-pointer after:absolute after:inset-0 after:content-['']"
                  >
                    {m.name}
                  </button>
                  <div className="text-[11px] text-[var(--paper)]/70 leading-tight">{m.goal}</div>
                </div>
                <span
                  aria-hidden="true"
                  className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? 'border-[var(--ember)]' : 'border-[rgba(239,230,210,0.35)]'}`}
                >
                  {on && <span className="block w-2.5 h-2.5 rounded-full bg-[var(--ember)]" />}
                </span>
              </div>

              <div id={`mode-desc-${m.id}`} className="mt-2 space-y-1 text-[11px] leading-snug text-[var(--paper)]/80">
                {m.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>

              <div className="mt-auto pt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide uppercase ${
                    note.ranked ? 'bg-[rgba(79,214,168,0.16)] text-[var(--jade)]' : needsJoin ? 'bg-[rgba(255,209,102,0.16)] text-[#ffd166]' : 'bg-[rgba(239,230,210,0.1)] text-[var(--paper)]/70'
                  }`}
                >
                  <span className="font-serif text-xs leading-none">頂</span>
                  {badgeText(m.id, status, player)}
                </span>
                {needsJoin && (
                  <button
                    onClick={() => {
                      onChange('waves');
                      onJoin();
                    }}
                    className="relative z-10 text-[11px] font-extrabold bg-[var(--torii)] text-[var(--paper)] px-2.5 py-1 rounded active:scale-95 transition-all cursor-pointer"
                  >
                    Entrar no ranking
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
