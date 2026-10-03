import { useCallback, useEffect, useState } from 'react';
import { fetchRanking, type RankData } from '../game/ranking';
import { ArcadeBoard } from './ArcadeBoard';

const SHOWN = 20;

// The global ranking: top players across every device, and where this player stands
export function Ranking({
  playerId,
  playerName,
  active,
  refreshKey,
  onJoin,
  onRename,
  onClose
}: {
  playerId: string | null;
  playerName: string | null;
  active: boolean; // this session is playing as `playerName`
  refreshKey: number;
  onJoin: () => void;
  onRename: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<RankData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setData(await fetchRanking(active && playerId ? playerId : undefined));
    setLoading(false);
  }, [active, playerId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const top = data?.top.slice(0, SHOWN) ?? [];
  const me = data?.me;

  return (
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-[rgba(16,12,24,0.88)] backdrop-blur-md p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-md py-3 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-3">
          <div className="font-serif text-5xl font-bold text-[var(--torii)] leading-none">頂</div>
          <h2 className="font-serif text-2xl font-extrabold text-[var(--paper)] mt-1">Ranking</h2>
          <div className="text-xs text-[var(--paper)]/70 mt-0.5">
            {data ? `${data.total.toLocaleString('pt-BR')} ${data.total === 1 ? 'jogador' : 'jogadores'}` : ' '}
            {data?.stale && <span className="text-[#ff9a7a]"> · sem conexão, mostrando a última lista</span>}
          </div>
        </div>

        <div className="rounded-lg border border-[rgba(239,230,210,0.25)] bg-[rgba(10,8,18,0.85)] px-2 py-2 min-h-24">
          {loading && !data && <div className="arcade-blink text-center font-mono text-sm text-[var(--paper)]/70 py-6">CARREGANDO…</div>}
          {!loading && !data && <div className="text-center text-sm text-[#ff9a7a] py-6">Não foi possível carregar o ranking.</div>}
          {data && top.length === 0 && <div className="text-center text-sm text-[var(--paper)]/70 py-6">Ninguém pontuou ainda. Seja o primeiro!</div>}
          {data && top.length > 0 && <ArcadeBoard top={data.top} me={data.me} limit={SHOWN} />}
        </div>

        {active && playerName && !me && data && !data.stale && (
          <p className="text-[11px] text-[var(--paper)]/60 text-center mt-2">{playerName}, termine uma partida para entrar na lista.</p>
        )}

        <div className="flex items-center justify-center gap-2 mt-3">
          {active ? (
            <button onClick={onRename} className="text-xs font-bold border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-3 py-1.5 rounded-md active:scale-95 transition-all cursor-pointer">
              Mudar nome{playerName ? ` (${playerName})` : ''}
            </button>
          ) : (
            <button onClick={onJoin} className="text-xs font-extrabold bg-[var(--torii)] border border-[var(--torii)] text-[var(--paper)] px-3 py-1.5 rounded-md active:scale-95 transition-all cursor-pointer">
              Entrar no ranking
            </button>
          )}
          <button onClick={() => void load()} className="text-xs font-bold border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-3 py-1.5 rounded-md active:scale-95 transition-all cursor-pointer">
            Atualizar
          </button>
          <button onClick={onClose} className="text-xs font-bold border border-[rgba(239,230,210,0.3)] text-[var(--paper)] px-3 py-1.5 rounded-md active:scale-95 transition-all cursor-pointer">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
