import { applyUpdate, installApp, isIos, usePwa } from '../pwa';

// The offline line of the menu: how far the download is, and how to install the game as an app.
export function OfflineStatus() {
  const p = usePwa();
  if (!p.supported || p.phase === 'idle') return null;
  if (p.phase === 'downloading') {
    return (
      <div className="mb-3 mx-auto max-w-xs text-[11px] text-[var(--paper)]/80">
        Baixando para jogar offline… <b>{p.pct}%</b>
        <div className="h-1 rounded-full bg-[rgba(239,230,210,0.15)] overflow-hidden mt-1">
          <div className="h-full bg-[var(--ember)] transition-[width] duration-300" style={{ width: `${p.pct}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="mb-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-[var(--paper)]/80">
      <span>
        <b className="text-[var(--jade)]">✓ Pronto para jogar offline</b>
      </span>
      {!p.standalone && p.installable && (
        <button onClick={() => void installApp()} className="font-extrabold bg-[var(--torii)] text-[var(--paper)] px-2.5 py-1 rounded active:scale-95 transition-all cursor-pointer">
          Instalar app
        </button>
      )}
      {!p.standalone && !p.installable && <span className="text-[var(--paper)]/60">{isIos() ? '· Compartilhar → Adicionar à Tela de Início' : '· para instalar: menu ⋮ do navegador → Instalar app'}</span>}
    </div>
  );
}

// A new version is installed and waiting: the player decides when to switch (never mid-run)
export function UpdateBanner({ show }: { show: boolean }) {
  const p = usePwa();
  if (!p.update || !show) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(12px+var(--sab))] z-[50] flex items-center gap-3 rounded-full border border-[var(--ember)] bg-[rgba(22,18,31,0.95)] pl-4 pr-1.5 py-1.5 shadow-lg">
      <span className="text-xs font-bold text-[var(--paper)]">Nova versão disponível</span>
      <button onClick={() => void applyUpdate()} className="text-xs font-extrabold bg-[var(--torii)] text-[var(--paper)] px-3 py-1.5 rounded-full active:scale-95 transition-all cursor-pointer">
        Atualizar
      </button>
    </div>
  );
}
