import { useEffect, useState } from 'react';
import type { CardOffer } from '../game/cards';

// Level-up choice: three cards, one kept. Taps are ignored for a moment after it opens so
// a thumb still mashing the attack button can't pick a card by accident.
export function CardPicker({ level, offer, onPick }: { level: number; offer: CardOffer[]; onPick: (id: string) => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const t = window.setTimeout(() => setArmed(true), 450);
    return () => window.clearTimeout(t);
  }, [offer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m || !armed) return;
      const card = offer[Number(m[1]) - 1];
      if (card) onPick(card.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offer, armed, onPick]);

  return (
    <div className="fixed inset-0 z-[50] flex flex-col items-center justify-center bg-[rgba(10,8,16,0.72)] backdrop-blur-sm p-3 overflow-auto">
      <div className="font-serif text-[var(--jade)] text-sm font-bold tracking-widest mb-0.5">NÍVEL {level}</div>
      <h2 className="font-serif text-2xl sm:text-3xl font-extrabold text-[var(--paper)] mb-3 sm:mb-5 text-center">Escolha uma bênção</h2>
      <div className="flex gap-2.5 sm:gap-4 w-full max-w-3xl justify-center">
        {offer.map((c, i) => (
          <button
            key={c.id}
            disabled={!armed}
            onClick={() => onPick(c.id)}
            className={`card-in relative flex-1 min-w-0 max-w-[210px] rounded-xl border-2 border-[rgba(239,230,210,0.35)] bg-[rgba(30,24,42,0.94)] px-2.5 py-3 sm:py-5 text-center transition-all ${
              armed ? 'cursor-pointer hover:border-[var(--ember)] hover:bg-[rgba(52,40,60,0.96)] active:scale-95' : 'opacity-70'
            }`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="absolute top-1.5 left-2 text-[10px] font-bold text-[var(--paper)]/45 hidden sm:block">{i + 1}</span>
            <div className="font-serif text-4xl sm:text-5xl font-black text-[var(--ember)] leading-none mb-1.5 sm:mb-2">{c.glyph}</div>
            <div className="font-serif text-sm sm:text-base font-extrabold text-[var(--paper)] leading-tight mb-1">{c.name}</div>
            <div className="text-[11px] sm:text-xs text-[var(--paper)]/80 leading-snug min-h-[2.6em]">{c.desc}</div>
            <div className="flex justify-center gap-1 mt-2">
              {Array.from({ length: c.max }, (_, k) => (
                <span key={k} className={`w-1.5 h-1.5 rounded-full ${k < c.level ? 'bg-[var(--ember)]' : 'bg-[rgba(239,230,210,0.22)]'}`} />
              ))}
            </div>
            {c.level > 1 && <div className="text-[10px] text-[var(--ember)] font-bold mt-1">Nv {c.level}/{c.max}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
