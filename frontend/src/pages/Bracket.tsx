import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Swords, Settings, Play, List, Zap, CheckCircle } from "lucide-react";
import type { GroupTableItem } from "../../../backend/src/types";

// Tipos adaptados para o frontend
interface Match {
  id: string;
  phase: "groups" | "elimination";
  round: number;
  group?: string | null;
  robotA: { id: string; name: string } | null;
  robotB: { id: string; name: string } | null;
  scoreA: number;
  scoreB: number;
  winner: { id: string; name: string } | null;
  finished: boolean;
  type: "normal" | "KO" | "WO";
}

interface Tournament {
  id: string;
  name: string;
  status: "draft" | "active" | "finished";
  advancePerGroup: number;
  groupCount: number;
}

interface ArenaState {
  matches: Match[];
  groupTables: Record<string, GroupTableItem[]>;
  currentMatchId: string | null;
  tournamentId: string | null; // ID do torneio ativo
  tournaments: Tournament[]; // Lista de todos os torneios
  advancePerGroup: number;
  groupCount: number;
}


export default function Chaveamento() {
  const [state, setState] = useState<ArenaState | null>(null);

  // valores temporários (inputs para NOVO torneio)
  const [tournamentNameInput, setTournamentNameInput] = useState("");
  const [groupCountInput, setGroupCountInput] = useState(2);
  const [robotsPerGroupInput, setRobotsPerGroupInput] = useState(5);
  const [advancePerGroupInput, setAdvancePerGroupInput] = useState(4);

  // valores ativos aplicados
  const [groupCountActive, setGroupCountActive] = useState(2);
  const [advancePerGroupActive, setAdvancePerGroupActive] = useState(2);

  const [loading, setLoading] = useState(false);

  // Função auxiliar para carregar o estado
  const fetchState = async () => {
    try {
      const r = await api("/state");
      const newState = { ...r.state } as ArenaState;
      // O backend já está calculando e incluindo groupTables, então apenas atualizamos
      setState(newState);

      setGroupCountActive(newState?.advancePerGroup || 2);
      setAdvancePerGroupActive(newState?.advancePerGroup || 2);
    } catch (error) {
      console.error("Erro ao buscar estado:", error);
    }
  };

  useEffect(() => {
    fetchState();

    return onMessage((m) => {
      if (m.type === "UPDATE_STATE") {
        const s = { ...m.payload.state } as ArenaState;
        setState(s);

        if (s.groupCount) setGroupCountActive(s.groupCount);
        if (s.advancePerGroup) setAdvancePerGroupActive(s.advancePerGroup);
      }
    });
  }, []);

  // OBS: A função calculateGroupTables do frontend foi removida,
  // pois o backend agora calcula e envia a tabela de grupos já pronta.


  // Gera novo torneio e chaveamento (Grupo)
  const gerarChaveamento = async () => {
    if (!tournamentNameInput) {
      alert("❌ O nome do torneio é obrigatório!");
      return;
    }
    if (!state?.robots || state.robots.length < 2) {
        alert("❌ É necessário cadastrar pelo menos 2 robôs para criar um torneio.");
        return;
    }
    setLoading(true);
    try {
      await api("/matches/generate", {
        method: "POST",
        body: JSON.stringify({
          name: tournamentNameInput,
          groupCount: groupCountInput,
          robotsPerGroup: robotsPerGroupInput,
          advancePerGroup: advancePerGroupInput,
        }),
      });
      alert(`✅ Torneio "${tournamentNameInput}" criado e ativado!`);
    } catch (error) {
      console.error("Erro ao gerar chaveamento:", error);
      alert("❌ Falha ao gerar o chaveamento.");
    } finally {
      setLoading(false);
    }
  };

  // 🚀 Iniciar combate
  const iniciarCombate = async (matchId: string) => {
    try {
      await api(`/matches/${matchId}/start`, { method: "POST" });
      alert("🚀 Combate iniciado!");
    } catch (err) {
      console.error("Erro ao iniciar combate:", err);
      alert("❌ Falha ao iniciar o combate.");
    }
  };
  
  // ⚡ Ativar Torneio Existente
  const handleActivateTournament = async (tournamentId: string) => {
    if (!confirm("Tem certeza que deseja ATIVAR este torneio? O torneio ativo atual será finalizado.")) return;
    setLoading(true);
    try {
        await api(`/tournaments/${tournamentId}/activate`, { method: "POST" });
        alert("✅ Torneio ativado com sucesso!");
    } catch (error) {
        console.error("Erro ao ativar torneio:", error);
        alert("❌ Falha ao ativar o torneio.");
    } finally {
        setLoading(false);
    }
  };

  // 🏁 Finalizar Torneio
  const handleFinishTournament = async (tournamentId: string) => {
    if (!confirm("Tem certeza que deseja FINALIZAR este torneio? Ele será movido para o histórico.")) return;
    setLoading(true);
    try {
        await api(`/tournaments/${tournamentId}/finish`, { method: "POST" });
        alert("✅ Torneio finalizado com sucesso!");
    } catch (error) {
        console.error("Erro ao finalizar torneio:", error);
        alert("❌ Falha ao finalizar o torneio.");
    } finally {
        setLoading(false);
    }
  };


  if (!state)
    return (
      <div className="min-h-screen flex items-center justify-center text-white/60">
        Carregando...
      </div>
    );

  const matches = (state.matches || []).filter((m: any) => m.phase === "groups");
  const groups = Object.keys(state.groupTables || {});
  const colors = [
    "from-blue-900 to-blue-700",
    "from-green-900 to-green-700",
    "from-purple-900 to-purple-700",
    "from-orange-900 to-orange-700",
    "from-rose-900 to-rose-700",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000814] to-[#001933] text-white p-8 select-none">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-10">
        <h1 className="text-3xl font-extrabold flex items-center gap-3">
          <Trophy className="text-yellow-400" /> Gerenciar Torneios
        </h1>
        {state.tournamentId && (
            <div className="text-xl font-bold text-arena-accent">
                Torneio Ativo: {state.tournaments.find(t => t.id === state.tournamentId)?.name}
            </div>
        )}
      </div>

      {/* ---------- CONFIGURAÇÃO DE NOVO TORNEIO ---------- */}
      <h2 className="text-2xl font-bold mb-6 mt-10">Criar Novo Torneio</h2>
      <div className="bg-white/10 p-6 rounded-2xl shadow-xl mb-10">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
          <div className="md:col-span-2">
            <label className="block mb-2 text-sm text-white/70">
              Nome do Torneio
            </label>
            <input
              type="text"
              value={tournamentNameInput}
              onChange={(e) => setTournamentNameInput(e.target.value)}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full text-white"
              placeholder="Ex: Torneio Nacional 2025"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm text-white/70">
              Quantidade de Grupos
            </label>
            <input
              type="number"
              min="1"
              value={groupCountInput}
              onChange={(e) => setGroupCountInput(Number(e.target.value))}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full text-white"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm text-white/70">
              Robôs por Grupo (Base)
            </label>
            <input
              type="number"
              min="2"
              value={robotsPerGroupInput}
              onChange={(e) => setRobotsPerGroupInput(Number(e.target.value))}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full text-white"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm text-white/70">
              Classificados por Grupo
            </label>
            <input
              type="number"
              min="1"
              value={advancePerGroupInput}
              onChange={(e) => setAdvancePerGroupInput(Number(e.target.value))}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full text-white"
            />
          </div>

          <button
            onClick={gerarChaveamento}
            disabled={loading || !tournamentNameInput || state.robots.length < 2}
            className="bg-arena-accent text-black font-bold rounded-xl px-6 py-3 hover:opacity-90 transition-all duration-200 flex items-center justify-center gap-2 w-full md:w-auto"
          >
            <Settings size={18} />
            {loading ? "Gerando..." : "Criar Torneio"}
          </button>
        </div>
        {state.robots.length < 2 && (
            <p className="text-red-400 text-sm mt-3">É necessário cadastrar pelo menos 2 robôs para criar um torneio.</p>
        )}
      </div>

      {/* ---------- LISTA DE TORNEIOS EXISTENTES ---------- */}
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <List size={24} /> Lista de Torneios
      </h2>
      <div className="bg-white/10 p-6 rounded-2xl shadow-xl mb-10">
        <div className="space-y-4">
          {state.tournaments?.length === 0 && (
            <p className="text-white/60">Nenhum torneio cadastrado.</p>
          )}

          {state.tournaments
            .sort((a, b) => (a.status === "active" ? -1 : 1) || a.name.localeCompare(b.name)) // Torneio ativo primeiro
            .map((t) => (
              <div
                key={t.id}
                className={`flex justify-between items-center p-4 rounded-lg transition-all ${
                  t.id === state.tournamentId && t.status === "active"
                    ? "bg-yellow-800/50 border border-yellow-500 shadow-[0_0_10px_#FFD700]"
                    : t.status === "finished"
                    ? "bg-green-800/50 border border-green-500 opacity-70"
                    : "bg-gray-800/50 border border-gray-500"
                }`}
              >
                <div className="flex items-center gap-4">
                    <span className="text-xl font-bold">{t.name}</span>
                    <span className={`px-2 py-1 text-xs rounded-full font-semibold ${
                        t.id === state.tournamentId && t.status === "active" ? "bg-yellow-400 text-black" :
                        t.status === "finished" ? "bg-green-500 text-white" :
                        "bg-gray-500 text-white"
                    }`}>
                        {t.id === state.tournamentId && t.status === "active" ? "ATIVO" : t.status === "finished" ? "FINALIZADO" : "RASCUNHO"}
                    </span>
                </div>
                
                <div className="flex items-center gap-2">
                    {t.id !== state.tournamentId && t.status !== "finished" && (
                        <button
                            onClick={() => handleActivateTournament(t.id)}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-lg transition duration-200 flex items-center gap-1"
                        >
                            <Zap size={16} /> Ativar
                        </button>
                    )}
                    {t.id === state.tournamentId && t.status === "active" && (
                        <button
                            onClick={() => handleFinishTournament(t.id)}
                            disabled={loading}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-lg transition duration-200 flex items-center gap-1"
                        >
                            <CheckCircle size={16} /> Finalizar
                        </button>
                    )}
                    {t.status === "finished" && (
                        <span className="text-sm text-gray-400">Torneio Concluído</span>
                    )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* ---------- EXIBIÇÃO DO TORNEIO ATIVO ---------- */}
      {state.tournamentId && (
        <>
            <h2 className="text-2xl font-bold mb-6 text-center">Fase de Grupos</h2>
            {groups.length === 0 && (
                <p className="text-white/60 text-center">Nenhum grupo gerado ainda para o torneio ativo.</p>
            )}

            <div className="grid xl:grid-cols-2 lg:grid-cols-3 gap-10">
                {groups.map((g, idx) => (
                <div
                    key={g}
                    className={`rounded-2xl p-6 shadow-xl bg-gradient-to-b ${
                    colors[idx % colors.length]
                    }`}
                >
                    <h3 className="text-xl font-bold mb-4">Grupo {g}</h3>

                    {/* ---------- TABELA ---------- */}
                    <div className="overflow-x-auto rounded-lg bg-black/20 p-2 mb-5">
                    <table className="w-full text-sm text-center">
                        <thead className="text-yellow-400 border-b border-white/20">
                        <tr>
                            <th>#</th>
                            <th className="text-left pl-2">Robô</th>
                            <th>Pontos</th>
                            <th>Vitórias</th>
                            <th>Empate</th>
                            <th>Derrotas</th>
                            <th>KO</th>
                            <th>WO</th>
                        </tr>
                        </thead>
                        <tbody>
                        {(state.groupTables[g] as GroupTableItem[] | undefined)?.map(
                            (r, idx2) => (
                            <tr
                                key={r.robotId}
                                className={`border-b border-white/10 ${
                                idx2 < advancePerGroupActive
                                    ? "text-white font-bold"
                                    : "text-white/50"
                                }`}
                            >
                                <td>{idx2 + 1}</td>
                                <td className="text-left pl-2">{r.name}</td>
                                <td>{r.pts}</td>
                                <td>{r.wins}</td>
                                <td>{r.draws}</td>
                                <td>{r.losses}</td>
                                <td>{r.ko}</td>
                                <td>{r.wo}</td>
                            </tr>
                            )
                        )}
                        </tbody>
                    </table>
                    </div>

                    {/* ---------- PARTIDAS ---------- */}
                    <h4 className="flex items-center gap-2 font-bold mb-2">
                    <Swords size={18} /> Partidas
                    </h4>
                    <div className="space-y-2">
                    {matches
                        .filter((m: any) => m.group === g && ["groups", "elimination"].includes(m.phase))
                        .map((m: any) => (
                        <div
                            key={m.id}
                            className={`flex justify-between items-center bg-white/10 rounded-lg p-3 transition-all ${
                            m.finished === false && state.currentMatchId === m.id
                                ? "border-2 border-yellow-400 shadow-[0_0_15px_#FFD700] animate-pulse"
                                : "border-l-4 border-transparent"
                            }`}
                        >
                            <span className="font-semibold">
                            {m.robotA?.name ?? "?"}{" "}
                            <span className="text-arena-accent">vs</span>{" "}
                            {m.robotB?.name ?? "?"}
                            </span>
                            

                            {/* Mostrar vencedor se a partida terminou */}
                            {m.finished && (
                            <div className="flex text-sm text-yellow-400 items-center gap-1">
                                {m.winner ? `Vencedor: ${m.winner.name}` : "Empate"}
                            </div>
                            )}

                            {/* Mostrar tipo de vitória se a partida terminou */}
                            {m.finished && (
                            <div className="flex text-sm text-yellow-400 items-center gap-1">
                                {m.type === "KO" && " K.O"}
                                {m.type === "WO" && "W.O"}
                            </div>
                            )}

                            <div className="flex items-center gap-2">
                            {m.finished ? (
                                <span className="font-bold text-arena-accent">
                                {m.scoreA} - {m.scoreB}
                                </span>
                            ) : (
                                <button
                                onClick={() => iniciarCombate(m.id)}
                                disabled={state.currentMatchId === m.id}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition ${
                                    state.currentMatchId === m.id
                                    ? "bg-yellow-400/30 text-yellow-200 cursor-not-allowed"
                                    : "bg-arena-accent text-black hover:opacity-90"
                                }`}
                                >
                                <Play size={14} />
                                {state.currentMatchId === m.id
                                    ? "Em andamento"
                                    : "Iniciar Luta"}
                                </button>
                            )}
                            </div>
                        </div>
                        ))}
                    </div>
                </div>
                ))}
            </div>

            <div className="mt-10 text-center text-white/60 text-sm">
                Após o fim das partidas, os{" "}
                <span className="text-arena-accent font-bold">
                {advancePerGroupActive} primeiros
                </span>{" "}
                de cada grupo avançam automaticamente para o mata-mata.
            </div>

            {/* ---------- MATA-MATA POR GRUPO ---------- */}
            <h2 className="text-2xl font-bold mt-16 mb-6 text-center">
                Mata-Mata Interno dos Grupos
            </h2>
            {Object.keys(state.groupTables || {}).map((label) => (
                <div key={label} className="mb-8">
                <h3 className="text-lg font-bold mb-3 text-yellow-400">
                    Grupo {label}
                </h3>
                {(state.matches || [])
                    .filter((m: any) => m.phase === "elimination" && m.group === label)
                    .sort((a: any, b: any) => a.round - b.round)
                    .map((m: any) => (
                    <div
                        key={m.id}
                        className={`flex justify-between items-center bg-white/10 rounded-lg p-3 mb-2 transition-all ${
                        m.finished === false && state.currentMatchId === m.id
                            ? "border-2 border-yellow-400 shadow-[0_0_15px_#FFD700] animate-pulse"
                            : "border-l-4 border-transparent"
                        }`}
                    >
                        <span className="font-semibold">
                        {m.robotA?.name ?? "?"}{" "}
                        <span className="text-arena-accent">vs</span>{" "}
                        {m.robotB?.name ?? "?"}
                        </span>

                        {m.finished ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-yellow-400 font-semibold">
                            {m.winner
                                ? `Vencedor: ${m.winner.name} ${
                                    m.type === "KO"
                                    ? "(K.O)"
                                    : m.type === "WO"
                                    ? "(W.O)"
                                    : ""
                                }`
                                : "Empate"}
                            </span>
                            <span className="font-bold text-arena-accent">
                            {m.scoreA} - {m.scoreB}
                            </span>
                        </div>
                        ) : (
                        <button
                            onClick={() => iniciarCombate(m.id)}
                            disabled={state.currentMatchId === m.id}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition ${
                            state.currentMatchId === m.id
                                ? "bg-yellow-400/30 text-yellow-200 cursor-not-allowed"
                                : "bg-arena-accent text-black hover:opacity-90"
                            }`}
                        >
                            <Play size={14} />
                            {state.currentMatchId === m.id ? "Em andamento" : "Iniciar Luta"}
                        </button>
                        )}
                    </div>

                    ))}
                </div>
            ))}

            {/* ---------- FASE FINAL ENTRE CAMPEÕES ---------- */}
            {(state.matches || []).some(
                (m: any) => m.phase === "elimination" && !m.group
            ) && (
                <div className="mt-16">
                <h2 className="text-2xl font-bold mb-4 text-center text-yellow-400">
                    🏆 Fase Final — Campeões dos Grupos
                </h2>

                {(state.matches || [])
                    .filter((m: any) => m.phase === "elimination" && !m.group)
                    .sort((a: any, b: any) => a.round - b.round)
                    .map((m: any) => (
                    <div
                        key={m.id}
                        className={`flex justify-between items-center bg-white/10 rounded-lg p-3 mb-2 transition-all ${
                            m.finished === false && state.currentMatchId === m.id
                            ? "border-2 border-yellow-400 shadow-[0_0_15px_#FFD700] animate-pulse"
                            : "border-l-4 border-transparent"
                        }`}
                    >
                        <span className="font-semibold">
                        {m.robotA?.name ?? "?"}{" "}
                        <span className="text-arena-accent">vs</span>{" "}
                        {m.robotB?.name ?? "?"}
                        </span>

                        {m.finished ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-yellow-400 font-semibold">
                            {m.winner
                                ? `Vencedor: ${m.winner.name} ${
                                    m.type === "KO"
                                    ? "(K.O)"
                                    : m.type === "WO"
                                    ? "(W.O)"
                                    : ""
                                }`
                                : "Empate"}
                            </span>
                            <span className="font-bold text-arena-accent">
                            {m.scoreA} - {m.scoreB}
                            </span>
                        </div>
                        ) : (
                        <button
                            onClick={() => iniciarCombate(m.id)}
                            disabled={state.currentMatchId === m.id}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition ${
                            state.currentMatchId === m.id
                                ? "bg-yellow-400/30 text-yellow-200 cursor-not-allowed"
                                : "bg-arena-accent text-black hover:opacity-90"
                            }`}
                        >
                            <Play size={14} />
                            {state.currentMatchId === m.id ? "Em andamento" : "Iniciar Luta"}
                        </button>
                        )}
                    </div>
                    ))}
                </div>
            )}
        </>
      )}

    </div>
  );
}