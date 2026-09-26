import { useEffect, useState } from 'react';
import { X, RotateCcw, Copy, Check } from 'lucide-react';
import { TUNE, TUNABLES, loadTune, saveTune, resetTune } from './game/tunables';

// Live-tuning panel for movement feel (turn speed, camera follow, run swing, ...).
// TUNE is a plain mutable object read directly by engine.ts/animation.ts every frame -
// dragging a slider here has no React re-render round trip through the game loop, it
// just writes the field and the next frame picks it up. Only ever mounted when the
// ?tune=1 query flag is present (see App.tsx), never for regular players.
export function TunePanel({ onClose }: { onClose: () => void }) {
  // local render-only copy, just to move the slider thumbs and show the number -
  // TUNE itself is mutated directly, this state doesn't feed back into the game.
  const [values, setValues] = useState<typeof TUNE>({ ...TUNE });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadTune();
    setValues({ ...TUNE });
  }, []);

  const setOne = (key: keyof typeof TUNE, v: number) => {
    TUNE[key] = v;
    setValues((prev) => ({ ...prev, [key]: v }));
    saveTune();
  };

  const handleReset = () => {
    resetTune();
    setValues({ ...TUNE });
  };

  const handleCopy = async () => {
    const text = JSON.stringify(TUNE, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked - the values are still visible/saved, just can't auto-copy
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-auto max-h-[70vh] flex flex-col bg-[rgba(22,18,31,0.94)] border-t border-[rgba(239,230,210,0.25)] rounded-t-2xl shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(239,230,210,0.15)]">
        <span className="text-[var(--paper)] font-semibold text-sm">Ajuste de movimento</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="w-8 h-8 rounded-full bg-[rgba(239,230,210,0.1)] flex items-center justify-center active:scale-95"
            title="Copiar valores"
            aria-label="Copiar valores"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[var(--paper)]" />}
          </button>
          <button
            onClick={handleReset}
            className="w-8 h-8 rounded-full bg-[rgba(239,230,210,0.1)] flex items-center justify-center active:scale-95"
            title="Restaurar padrão"
            aria-label="Restaurar padrão"
          >
            <RotateCcw className="w-4 h-4 text-[var(--paper)]" />
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[rgba(239,230,210,0.1)] flex items-center justify-center active:scale-95"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="w-4 h-4 text-[var(--paper)]" />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {TUNABLES.map((t) => (
          <label key={t.key} className="flex flex-col gap-1">
            <span className="text-xs text-[rgba(239,230,210,0.85)] flex justify-between">
              <span>{t.label}</span>
              <span className="tabular-nums text-[var(--ember)]">{values[t.key].toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={t.min}
              max={t.max}
              step={t.step}
              value={values[t.key]}
              onChange={(e) => setOne(t.key, parseFloat(e.target.value))}
              className="w-full accent-[var(--ember)]"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
