import { missionsFor, streakAlive } from '../game/missions';
import type { MetaSave } from '../game/meta';

// The day's three missions with their progress, and the day streak
export function Missions({ meta, today }: { meta: MetaSave; today: string }) {
  const date = meta.daily.date || today;
  const list = missionsFor(date);
  const alive = streakAlive(meta.streak, today);
  const count = alive ? meta.streak.count : 0;
  const played = meta.streak.last === today;
  return (
    <div className="kg-panel text-left w-full p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-serif text-sm font-extrabold text-[var(--paper)]">Missões do dia</span>
        <span className={`text-[11px] font-bold ${count > 0 ? 'text-[var(--ember)]' : 'text-[var(--paper)]/50'}`}>
          {count > 0 ? `${count} ${count === 1 ? 'dia' : 'dias'} seguidos${played ? '' : ' · jogue hoje!'}` : 'Jogue hoje para começar uma sequência'}
        </span>
      </div>
      <div className="space-y-1.5">
        {list.map((m) => {
          const done = meta.daily.done.includes(m.id);
          const v = Math.min(m.target, meta.daily.prog[m.id] ?? 0);
          return (
            <div key={m.id}>
              <div className="flex items-center justify-between text-[11px]">
                <span className={done ? 'text-[var(--jade)] font-bold' : 'text-[var(--paper)]/85'}>
                  {done ? '✓ ' : ''}
                  {m.text}
                </span>
                <span className={done ? 'text-[var(--jade)] font-bold' : 'text-[var(--ember)] font-bold'}>
                  {done ? 'feita' : `${v}/${m.target} · +${m.reward} 誉`}
                </span>
              </div>
              <div className="h-1 rounded-full bg-[rgba(239,230,210,0.14)] overflow-hidden mt-0.5">
                <div className={`h-full ${done ? 'bg-[var(--jade)]' : 'bg-[var(--ember)]'}`} style={{ width: `${(v / m.target) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
