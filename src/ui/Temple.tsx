import { UPGRADES, upgradeCost, type MetaSave } from '../game/meta';

// Between runs: spend Honra on small permanent upgrades
export function Temple({
  meta,
  persistent,
  onBuy,
  onClose
}: {
  meta: MetaSave;
  persistent: boolean;
  onBuy: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-[rgba(16,12,24,0.88)] backdrop-blur-md p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-md py-3 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-3">
          <div className="font-serif text-5xl font-bold text-[var(--torii)] leading-none">誉</div>
          <h2 className="font-serif text-2xl font-extrabold text-[var(--paper)] mt-1">Templo da Honra</h2>
          <div className="text-sm text-[var(--ember)] font-bold mt-0.5">{meta.honor.toLocaleString('pt-BR')} de Honra</div>
        </div>
        <div className="space-y-2">
          {UPGRADES.map((u) => {
            const lvl = meta.up[u.id] ?? 0;
            const cost = upgradeCost(u, lvl);
            const can = cost !== null && meta.honor >= cost;
            return (
              <div key={u.id} className="flex items-center gap-3 rounded-lg border border-[rgba(239,230,210,0.2)] bg-[rgba(30,24,42,0.9)] px-3 py-2">
                <div className="font-serif text-3xl font-black text-[var(--ember)] w-9 text-center leading-none">{u.glyph}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-sm font-extrabold text-[var(--paper)]">{u.name}</div>
                  <div className="text-[11px] text-[var(--paper)]/75 leading-snug">{u.desc}</div>
                  <div className="flex gap-1 mt-1">
                    {Array.from({ length: u.max }, (_, k) => (
                      <span key={k} className={`w-2 h-1.5 rounded-sm ${k < lvl ? 'bg-[var(--ember)]' : 'bg-[rgba(239,230,210,0.2)]'}`} />
                    ))}
                  </div>
                </div>
                {cost === null ? (
                  <span className="text-[11px] font-bold text-[var(--jade)] w-16 text-center">MÁX</span>
                ) : (
                  <button
                    onClick={() => onBuy(u.id)}
                    disabled={!can}
                    className={`w-16 py-1.5 rounded-md text-xs font-extrabold border transition-all ${
                      can
                        ? 'bg-[var(--torii)] border-[var(--torii)] text-[var(--paper)] cursor-pointer active:scale-95 hover:brightness-110'
                        : 'border-[rgba(239,230,210,0.2)] text-[var(--paper)]/40'
                    }`}
                  >
                    {cost} 誉
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!persistent && (
          <p className="text-[11px] text-[#ff9a7a] text-center mt-2">O navegador bloqueou o salvamento: o progresso vale só nesta sessão.</p>
        )}
        <button
          onClick={onClose}
          className="mt-4 mx-auto block font-bold text-sm border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-8 py-2.5 rounded-md active:scale-95 transition-all cursor-pointer"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
