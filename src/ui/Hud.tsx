import { useEffect } from 'react';

// In-run HUD pieces that carry the lacquer look (classes in index.css): the player's bars, the boss
// bar, the healing gourd icon, and the scale the touch controls follow.

// The HUD was drawn for a ~400 px short side: smaller screens shrink it a little, big ones grow it.
// Published as --hud-s on <html> so every HUD block can scale itself from its own corner.
export function useHudScale() {
  useEffect(() => {
    const apply = () => {
      const d = Math.min(window.innerWidth, window.innerHeight);
      document.documentElement.style.setProperty('--hud-s', Math.max(0.85, Math.min(1.25, d / 400)).toFixed(3));
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
}

const unit = (v: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0);

/** A hyōtan (calabash) with its stopper: the healing gourd. */
export function GourdIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M10.2 3.4h3.6v2c0 .6-.4 1.1-.9 1.4 1.7.7 2.9 2.2 2.9 4 0 1-.4 1.9-1 2.6 2.1.9 3.6 2.9 3.6 5.3 0 3-2.7 5.3-6.4 5.3S5.6 21.7 5.6 18.7c0-2.4 1.5-4.4 3.6-5.3-.6-.7-1-1.6-1-2.6 0-1.8 1.2-3.3 2.9-4-.5-.3-.9-.8-.9-1.4v-2z"
        fill="currentColor"
        fillOpacity=".2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9.4 3.2h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.9 9.2c2 .8 4.2.8 6.2 0M7.7 15.3c2.8 1.2 5.8 1.2 8.6 0" stroke="currentColor" strokeWidth="1" opacity=".65" />
    </svg>
  );
}

/** Top-left block: portrait with the level badge, then HP (with a trailing ghost of the damage just
 *  taken), stamina in notches and a thin XP line. */
export function PlayerBars({
  portrait,
  hp,
  maxHp,
  stamina,
  maxStamina,
  xp,
  xpNext,
  level,
  wave,
  mod
}: {
  portrait: string;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  xp: number;
  xpNext: number;
  level: number;
  wave: number;
  mod: { name: string; glyph: string; desc: string } | null;
}) {
  const hpK = unit(hp, maxHp);
  const stK = unit(stamina, maxStamina);
  const xpK = unit(xp, xpNext);
  return (
    <div
      className="absolute top-[calc(var(--sat)+12px)] left-[calc(var(--sal)+12px)] flex items-center gap-3 pointer-events-auto"
      style={{ transform: 'scale(var(--hud-s))', transformOrigin: 'top left' }}
    >
      <div className="relative shrink-0">
        <img
          src={portrait}
          alt=""
          className="w-12 h-12 rounded-full object-cover bg-black/60 border-2 border-[var(--ember)] shadow-[0_0_0_2px_rgba(0,0,0,0.55),0_4px_10px_rgba(0,0,0,0.5)]"
        />
        <span
          className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--jade)] text-[var(--ink)] border-2 border-[var(--ink)] flex items-center justify-center font-serif font-extrabold text-[11px] leading-none"
          title={`Nível ${level}`}
          aria-label={`Nível ${level}`}
        >
          {level}
        </span>
      </div>

      <div className="w-[min(42vw,190px)]">
        <div className="kg-bars">
          <div className={`kg-bar h-4 mb-1 ${hpK < 0.3 ? 'kg-low' : ''}`} role="progressbar" aria-label="Vida" aria-valuemin={0} aria-valuemax={Math.round(maxHp)} aria-valuenow={Math.round(hp)}>
            <div className="kg-ghost" style={{ transform: `scaleX(${hpK})` }} />
            <div className="kg-fill kg-sheen" style={{ transform: `scaleX(${hpK})`, background: 'linear-gradient(90deg, #8e1f28, #e03442)' }} />
            <span className="absolute inset-0 z-[2] flex items-center justify-end pr-2 text-[9px] font-extrabold leading-none tabular-nums text-[var(--paper)] [text-shadow:0_1px_2px_#000]" style={{ transform: 'skewX(12deg)' }}>
              {Math.ceil(hp)}
            </span>
          </div>
          <div className={`kg-bar kg-notch h-2 mb-1 ${stK < 0.22 ? 'kg-low' : ''}`} role="progressbar" aria-label="Fôlego" aria-valuemin={0} aria-valuemax={Math.round(maxStamina)} aria-valuenow={Math.round(stamina)}>
            <div className="kg-fill kg-sheen" style={{ transform: `scaleX(${stK})`, background: stK < 0.22 ? 'linear-gradient(90deg, #b8442a, #f27a4a)' : 'linear-gradient(90deg, #d98a3d, #ffd08a)' }} />
          </div>
          <div className="kg-bar h-1.5" role="progressbar" aria-label="Experiência" aria-valuemin={0} aria-valuemax={Math.round(xpNext)} aria-valuenow={Math.round(xp)}>
            <div className="kg-fill" style={{ transform: `scaleX(${xpK})`, background: 'linear-gradient(90deg, #3f9f80, #7be0bc)' }} />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5 px-0.5 text-xs font-bold text-[var(--paper)] [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
          <span className="font-serif tracking-wide">Onda {wave}</span>
          {mod && (
            <span title={mod.desc} className="inline-flex items-center gap-1 rounded-full border border-[rgba(216,179,106,0.6)] bg-[rgba(22,18,31,0.82)] px-2 py-0.5 text-[10px] font-bold text-[#ffd98a]">
              <span className="font-serif text-xs leading-none">{mod.glyph}</span>
              {mod.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Boss bar at the top center (the notch marks where the first deathblow leaves it). */
export function BossBar({ boss }: { boss: { hp: number; max: number; fury: boolean; name: string } }) {
  const k = unit(boss.hp, boss.max);
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[calc(var(--sat)+10px)] w-[min(38vw,380px)] pointer-events-none">
      <div className={`text-center font-serif text-xs font-extrabold tracking-[0.3em] mb-1 [text-shadow:0_1px_6px_#000] ${boss.fury ? 'text-[#ff5a3a]' : 'text-[var(--paper)]'}`}>
        {boss.name}
        {boss.fury ? ' · 怒' : ''}
      </div>
      <div style={{ transform: 'skewX(-12deg)' }}>
        <div className={`kg-bar h-2.5 ${boss.fury ? 'kg-low' : ''}`}>
          <div className="kg-ghost" style={{ transform: `scaleX(${k})` }} />
          <div className="kg-fill kg-sheen" style={{ transform: `scaleX(${k})`, background: boss.fury ? 'linear-gradient(90deg, #d8480f, #ff7a2a)' : 'linear-gradient(90deg, #a81820, #e0282f)' }} />
          <div className="absolute inset-y-0 left-1/2 z-[2] w-px bg-[rgba(239,230,210,0.7)]" />
        </div>
      </div>
    </div>
  );
}
