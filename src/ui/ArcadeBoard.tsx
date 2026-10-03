import type { CSSProperties } from 'react';
import type { RankEntry, RankData } from '../game/ranking';

const PLACE_COLOR = ['#ffd166', '#c9c2d6', '#d99a6c']; // 1st, 2nd, 3rd

interface Row {
  rank: number | null; // null: not on the server yet
  n: string;
  s: number;
  w: number;
  mine: boolean;
  note?: string;
}

// An old arcade cabinet's high-score table: place, name, dotted leader, points and wave. The
// player's row blinks; if it falls outside the shown places it sits below a dashed rule, and a
// score that hasn't reached the server yet shows up as a pending row.
export function ArcadeBoard({
  top,
  me,
  limit,
  pending,
  playerName
}: {
  top: RankEntry[];
  me?: RankData['me'];
  limit: number;
  pending?: { score: number; wave: number } | null;
  playerName?: string | null;
}) {
  const shown: Row[] = top.slice(0, limit).map((r, i) => ({ rank: i + 1, n: r.n, s: r.s, w: r.w, mine: !!me && me.rank === i + 1 }));
  const outside: Row | null =
    me && me.rank > shown.length
      ? { rank: me.rank, n: me.n, s: me.s, w: me.w, mine: true }
      : !me && pending && playerName
        ? { rank: null, n: playerName, s: pending.score, w: pending.wave, mine: true, note: 'pendente' }
        : null;
  const rows = outside ? [...shown, outside] : shown;

  return (
    <div className="font-mono text-[13px] leading-tight">
      {rows.map((r, i) => (
        <div key={`${r.rank}-${r.n}`}>
          {r === outside && shown.length > 0 && <div className="my-1 border-t-2 border-dashed border-[rgba(239,230,210,0.25)]" />}
          <div
            className={`arcade-row flex items-baseline gap-2 px-1.5 py-1 rounded-sm ${r.mine ? 'arcade-mine font-extrabold text-[var(--ember)]' : 'text-[var(--paper)]'}`}
            style={{ '--d': `${(rows.length - 1 - i) * 80}ms` } as CSSProperties}
          >
            <span className="w-9 shrink-0 text-right tabular-nums font-black" style={r.rank !== null && r.rank <= 3 && !r.mine ? { color: PLACE_COLOR[r.rank - 1] } : undefined}>
              {r.mine ? '▶' : ''}
              {r.rank ?? '–'}
            </span>
            <span className="min-w-0 max-w-[9.5rem] truncate uppercase tracking-wider">{r.n}</span>
            <span className="flex-1 min-w-2 translate-y-[-3px] border-b-2 border-dotted border-[rgba(239,230,210,0.25)]" />
            {r.note && <span className="text-[10px] font-bold text-[#ff9a7a]">{r.note}</span>}
            <span className="tabular-nums">{r.s.toLocaleString('pt-BR')}</span>
            <span className="w-9 shrink-0 text-right text-[10px] text-[var(--paper)]/55">波{r.w}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
