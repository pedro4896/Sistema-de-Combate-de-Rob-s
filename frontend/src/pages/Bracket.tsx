import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Swords, Settings, Play } from "lucide-react";
import type { GroupTableItem } from "../../../backend/src/types";
import toast from "react-hot-toast";

// Tipos auxiliares importados do backend/src/types.ts (Simplificados para leitura)
type Match = { id: string; phase: 'groups' | 'elimination'; group: string | null; round: number; robotA: any; robotB: any; scoreA: number; scoreB: number; winner: any; finished: boolean; type: 'normal' | 'KO' | 'WO'; tournamentId: string; };
type Robot = { id: string; name: string; team: string; };
type Tournament = { 
  id: string; 
  name: string; 
  status: 'draft' | 'active' | 'finished';
  advancePerGroup: number; 
  groupCount: number; 
  participatingRobots?: Robot[]; 
};

export default function Chaveamento() {
  const [state, setState] = useState<any>(null);

  // Estados para seleção de torneio
  const [availableTournaments, setAvailableTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [displayedTournament, setDisplayedTournament] = useState<Tournament | null>(null);

  // valores ativos aplicados (Apenas mantidos para compatibilidade com a interface)
  const [groupCountActive, setGroupCountActive] = useState(2);
  const [advancePerGroupActive, setAdvancePerGroupActive] = useState(2);
  const [loading, setLoading] = useState(false);

  // NOVO FLUXO DE BUSCA DE DADOS
  const fetchTournamentData = async (tourId: string, globalState: any) => {
    // Busca dados específicos do torneio via novo endpoint
    const result = await api(`/tournaments/${tourId}/data`);
    
    if (result.ok) {
        // Combina o estado global (para robots e lista de torneios) com os dados específicos
        const matchesForTour = result.matches || [];
        const groupTablesForTour = result.groupTables || {};
        const tourDetails = result.tournament;

        setState({
            ...globalState,
            matches: matchesForTour,
            groupTables: groupTablesForTour,
            tournamentId: globalState.tournamentId, // Mantém o ativo global
            currentMatchId: result.currentMatchId, // Pega o currentMatchId correto
            mainStatus: result.mainStatus,
        });

        setDisplayedTournament(tourDetails);
        setGroupCountActive(tourDetails.groupCount);
        setAdvancePerGroupActive(tourDetails.advancePerGroup);
    } else {
        // Se a busca de dados falhar (ex: torneio deletado), apenas atualiza a lista de torneios
        setState(globalState);
        setSelectedTournamentId(null);
        setDisplayedTournament(null);
        toast.error(result.error || "Falha ao carregar dados do torneio.");
    }
  }

  const fetchGlobalState = async (targetTournamentId?: string | null) => {
    const r = await api("/state");
    const newState = { ...r.state };
    
    const allTours: Tournament[] = newState.tournaments;
    setAvailableTournaments(allTours);
    
    // Determina qual ID usar: target, ativo global, ou selecionado
    let tourToLoadId = targetTournamentId || newState.tournamentId || selectedTournamentId;
    
    if (!tourToLoadId && allTours.length > 0) {
        // Se nada estiver selecionado, carrega o primeiro
        tourToLoadId = allTours[0].id;
    }

    if (tourToLoadId) {
        // Se há um ID para carregar, usa a função específica
        setSelectedTournamentId(tourToLoadId);
        await fetchTournamentData(tourToLoadId, newState);
    } else {
        // Se não houver torneios
        setState(newState);
        setSelectedTournamentId(null);
        setDisplayedTournament(null);
    }
  }

  // Efeito para carregar o estado inicial e configurar o listener WebSocket
  useEffect(() => {
    fetchGlobalState(null); // Chama na montagem
    
    // CORREÇÃO: O listener WebSocket passa 'null' para forçar a verificação do torneio ATIVO
    // (o que garante que o recém-gerado seja carregado)
    return onMessage((m: any) => m.type === "UPDATE_STATE" && fetchGlobalState(null)); 
  }, []); // Sem dependência: executa apenas na montagem

  
  const handleTournamentSelectChange = (id: string) => {
      // Quando o usuário seleciona um torneio, força a recarga do estado
      setSelectedTournamentId(id);
      fetchGlobalState(id);
  }

  
  const gerarChaveamento = async () => {
    if (!displayedTournament) {
      toast.error("Selecione ou crie um torneio primeiro!");
      return;
    }

    if (displayedTournament.status !== 'draft') {
        toast.error("O chaveamento só pode ser gerado para torneios em status DRAFT. Finalize o torneio ATIVO na página de Torneios.");
        return;
    }

    if ((displayedTournament.participatingRobots?.length || 0) < 2) {
        toast.error("O torneio precisa de no mínimo 2 robôs participantes. Defina-os na página de Torneios.");
        return;
    }

    setLoading(true);
    // Chama a nova rota de ativação que também gera as partidas
    const result = await api(`/tournaments/${displayedTournament.id}/activate`, { method: "POST" });
    
    if (result.ok) {
        // O WebSocket se encarregará de chamar fetchGlobalState(null), o que carregará o novo torneio ATIVO
        toast.success(result.message);
    } else {
        toast.error(result.error || "Falha ao gerar chaveamento.");
    }

    setLoading(false);
  };
  
  // 🚀 Iniciar combate - Lógica mantida
  const iniciarCombate = async (matchId: string) => {
    try {
      await api(`/matches/${matchId}/start`, { method: "POST" });
      toast.success("Combate iniciado!");
    } catch (err) {
      console.error("Erro ao iniciar combate:", err);
      toast.error("Falha ao iniciar o combate.");
    }
  };

  if (!state)
    return (
      <div className="min-h-screen flex items-center justify-center text-white/60">
        Carregando...
      </div>
    );

  // Variáveis para simplificar o JSX
  const currentTourStatus = displayedTournament?.status;
  const canGenerateBracket = 
      !loading && 
      !!displayedTournament && 
      currentTourStatus === 'draft' && 
      (displayedTournament.participatingRobots?.length || 0) >= 2;
  
  // O filtro de matches e grupos agora usa o estado `state.matches` e `state.groupTables` 
  // que já foram carregados e filtrados pelo `fetchTournamentData`
  const matches = (state.matches || []).filter((m: any) => m.phase === "groups" && m.tournamentId === selectedTournamentId);
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
          <Trophy className="text-yellow-400" /> Chaveamento do Torneio
        </h1>
      </div>

      {/* ---------- SELETOR DE TORNEIO ---------- */}
      <div className="bg-white/10 p-6 rounded-2xl shadow-xl mb-10 max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="flex-grow">
                <label className="block mb-2 text-sm text-white/70">
                    Selecionar Torneio
                </label>
                <select
                    value={selectedTournamentId || ""}
                    onChange={(e) => handleTournamentSelectChange(e.target.value)}
                    className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full text-white"
                    disabled={availableTournaments.length === 0}
                >
                    <option value="" disabled>-- Selecione um Torneio --</option>
                    {availableTournaments.map(t => (
                        <option key={t.id} value={t.id}>
                            {t.name} ({t.status.toUpperCase()})
                        </option>
                    ))}
                </select>
            </div>
            
            {/* BOTÃO CORRIGIDO: Usa a variável canGenerateBracket */}
            <button
              onClick={gerarChaveamento}
              disabled={!canGenerateBracket}
              className={`font-bold rounded-xl px-6 py-3 transition-all duration-200 flex items-center gap-2 ${
                  canGenerateBracket ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-500 cursor-not-allowed'
              }`}
            >
              <Settings size={18} />
              {loading ? "Gerando..." : "Gerar Chaveamento (Draft)"}
            </button>
        </div>
        {displayedTournament && currentTourStatus === 'draft' && (displayedTournament.participatingRobots?.length || 0) < 2 && (
             <p className="text-sm text-red-400 mt-2">⚠️ Torneio em DRAFT: Adicione pelo menos 2 robôs na página **Torneios** para habilitar a geração.</p>
        )}
      </div>


      {/* ---------- GRUPOS E TABELAS ---------- */}
      <h2 className="text-2xl font-bold mb-6 text-center">Fase de Grupos</h2>
      {groups.length === 0 && selectedTournamentId && (
        <p className="text-white/60 text-center">O Torneio está em **DRAFT** ou o chaveamento ainda não foi gerado. Gere-o usando o botão acima ou na página de Torneios.</p>
      )}
      {groups.length === 0 && !selectedTournamentId && availableTournaments.length > 0 && (
          <p className="text-white/60 text-center">Selecione um torneio para visualizar o chaveamento.</p>
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
                .filter((m: any) => m.group === g && m.phase === "groups" && m.tournamentId === selectedTournamentId)
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
            .filter((m: any) => m.phase === "elimination" && m.group === label && m.tournamentId === selectedTournamentId)
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
        (m: any) => m.phase === "elimination" && !m.group && m.tournamentId === selectedTournamentId
      ) && (
        <div className="mt-16">
          <h2 className="text-2xl font-bold mb-4 text-center text-yellow-400">
            🏆 Fase Final — Campeões dos Grupos
          </h2>

          {(state.matches || [])
            .filter((m: any) => m.phase === "elimination" && !m.group && m.tournamentId === selectedTournamentId)
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

    </div>
  );
}