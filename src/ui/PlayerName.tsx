import { useState } from 'react';
import { ERROR_TEXT, NAME_MAX, NAME_MIN, cleanName, newPlayerId, registerName, type Player } from '../game/ranking';

// 'new': first visit (or "not me") - pick a name; 'rename': same player, new name;
// 'confirm': someone saved on this browser comes back - is it them?
export type NameMode = 'new' | 'rename' | 'confirm';

export function PlayerName({
  mode,
  current,
  onMode,
  onDone,
  onSkip
}: {
  mode: NameMode;
  current: Player | null;
  onMode: (m: NameMode) => void;
  onDone: (p: Player) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(mode === 'rename' ? current?.name ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (!cleanName(name)) {
      setError(ERROR_TEXT.bad_name);
      return;
    }
    setBusy(true);
    setError('');
    const keepId = mode === 'rename' && current ? current.id : newPlayerId();
    const r = await registerName(keepId, name);
    setBusy(false);
    if (!r.ok) {
      setError(ERROR_TEXT[r.error]);
      return;
    }
    const same = mode === 'rename' && current;
    onDone({ id: keepId, name: r.name, sent: same ? current.sent : 0, pending: same ? current.pending : undefined });
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(16,12,24,0.9)] backdrop-blur-md p-4">
      <div className="w-full max-w-sm rounded-xl border border-[rgba(239,230,210,0.25)] bg-[var(--ink)] p-5 text-center shadow-2xl">
        <div className="font-serif text-5xl font-bold text-[var(--torii)] leading-none">名</div>
        {mode === 'confirm' && current ? (
          <>
            <h2 className="font-serif text-xl font-extrabold text-[var(--paper)] mt-2">Bem-vindo de volta!</h2>
            <p className="text-sm text-[var(--paper)]/80 mt-1">
              Você é <b className="text-[var(--ember)]">{current.name}</b>?
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <button onClick={() => onDone(current)} className="py-2.5 rounded-md font-extrabold text-sm bg-[var(--torii)] border border-[var(--torii)] text-[var(--paper)] active:scale-95 transition-all cursor-pointer">
                Sim, sou eu
              </button>
              <button onClick={() => onMode('new')} className="py-2 rounded-md font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] active:scale-95 transition-all cursor-pointer">
                Não sou eu
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-serif text-xl font-extrabold text-[var(--paper)] mt-2">{mode === 'rename' ? 'Mudar de nome' : 'Seu nome no ranking'}</h2>
            <p className="text-xs text-[var(--paper)]/70 mt-1">Ele aparece para todos que jogam. {NAME_MIN} a {NAME_MAX} caracteres.</p>
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => {
                  setName(e.target.value);
                  setError('');
                }}
                placeholder="Seu nome"
                aria-label="Seu nome"
                className="w-full rounded-md border border-[rgba(239,230,210,0.3)] bg-[rgba(30,24,42,0.9)] px-3 py-2 text-center text-base font-bold text-[var(--paper)] outline-none focus:border-[var(--ember)]"
              />
              {error && <p className="text-[11px] text-[#ff9a7a] mt-1.5">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full mt-3 py-2.5 rounded-md font-extrabold text-sm bg-[var(--torii)] border border-[var(--torii)] text-[var(--paper)] active:scale-95 transition-all cursor-pointer disabled:opacity-60"
              >
                {busy ? 'Salvando…' : mode === 'rename' ? 'Salvar nome' : 'Entrar no ranking'}
              </button>
            </form>
            <button onClick={onSkip} className="mt-3 text-[11px] text-[var(--paper)]/60 underline cursor-pointer">
              Agora não
            </button>
          </>
        )}
      </div>
    </div>
  );
}
