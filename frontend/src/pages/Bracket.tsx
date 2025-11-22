import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Swords, Settings, Play } from "lucide-react";
import type { GroupTableItem } from "../../../backend/src/types";
import toast from "react-hot-toast";

// TIPOS ATUALIZADOS para incluir 'repechage' e 'repechageWinner'
type Match = { 
  id: string; 
  phase: 'groups' | 'elimination' | 'repechage'; // ATUALIZADO
  group: string | null; 
  round: number; 
  robotA: any; 
  robotB: any; 
  scoreA: number; 
  scoreB: number; 
  winner: any; 
  finished: boolean; 
  type: 'normal' | 'KO' | 'WO'; 
  tournamentId: string; 
};
type Robot = { id: string; name: string; team: string; };
type Tournament = { 
  id: string; 
  name: string; 
  status: 'draft' | 'active' | 'finished';
  advancePerGroup: number; 
  groupCount: number; 
  participatingRobots?: Robot[]; 
  repechageWinner?: Robot | null; // NOVO: Vencedor da repescagem
};
type ArenaState = {
    robots: Robot[];
    tournaments: Tournament[];
    tournamentId: string | null; 
    matches: Match[]; // Alterado para Match[]
    groupTables: Record<string, GroupTableItem[]>; // Adicionado
    currentMatchId: string | null;
    mainStatus: string;
    // ... outros campos
};


export default function Chaveamento() {
  const [state, setState] = useState<ArenaState | null>(null);

  // Estados para seleção de torneio
  const [availableTournaments, setAvailableTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [displayedTournament, setDisplayedTournament] = useState<Tournament | null>(null);

  // valores ativos aplicados (Apenas mantidos para compatibilidade com a interface)
  const [groupCountActive, setGroupCountActive] = useState(2);
  const [advancePerGroupActive, setAdvancePerGroupActive] = useState(2);
  const [loading, setLoading] = useState(false);

  // Variável para armazenar o vencedor da repescagem (para exibição)
  const repechageWinner = displayedTournament?.repechageWinner;


  // NOVO FLUXO DE BUSCA DE DADOS
  const fetchTournamentData = async (tourId: string, globalState: any) => {
    setLoading(true);
    const result = await api(`/tournaments/${tourId}/data`);
    
    if (result.ok) {
        const matchesForTour: Match[] = result.matches || [];
        const groupTablesForTour = result.groupTables || {};
        const tourDetails: Tournament = result.tournament;

        setState({
            ...globalState,
            matches: matchesForTour,
            groupTables: groupTablesForTour,
            tournamentId: globalState.tournamentId, 
            currentMatchId: result.currentMatchId, 
            mainStatus: result.mainStatus,
        } as ArenaState);

        // Atualiza o torneio exibido com todos os detalhes (incluindo repechageWinner)
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
    setLoading(false);
  }

  const fetchGlobalState = async (targetTournamentId?: string | null) => {
    const r = await api("/state");
    const newState = { ...r.state };
    
    const allTours: Tournament[] = newState.tournaments;
    setAvailableTournaments(allTours);
    
    let tourToLoadId = targetTournamentId || newState.tournamentId || selectedTournamentId;
    
    if (!tourToLoadId && allTours.length > 0) {
        // Se nada estiver selecionado, carrega o primeiro
        tourToLoadId = allTours[0].id;
    }

    if (tourToLoadId) {
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
    fetchGlobalState(null); 
    return onMessage((m: any) => m.type === "UPDATE_STATE" && fetchGlobalState(null)); 
  }, []); 

  
  const handleTournamentSelectChange = (id: string) => {
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

  if (!state || !selectedTournamentId)
    return (
      <div className="min-h-screen flex items-center justify-center text-white/60">
        <h1 className="text-xl">
            {availableTournaments.length === 0 ? 
             "Nenhum torneio cadastrado. Cadastre um na página 'Torneios'." :
             "Carregando dados do torneio..."
            }
        </h1>
      </div>
    );

  // Variáveis para simplificar o JSX
  const currentTourStatus = displayedTournament?.status;
  const canGenerateBracket = 
      !loading && 
      !!displayedTournament && 
      currentTourStatus === 'draft' && 
      (displayedTournament.participatingRobots?.length || 0) >= 2;
  
  const groups = Object.keys(state.groupTables || {});
  
  // Agrupamento e filtragem de partidas
  const matchesByPhase = {
    groups: state.matches.filter((m: Match) => m.phase === "groups" && m.tournamentId === selectedTournamentId),
    repechage: state.matches.filter((m: Match) => m.phase === "repechage" && m.tournamentId === selectedTournamentId).sort((a, b) => a.round - b.round),
    eliminationGroup: state.matches.filter((m: Match) => m.phase === "elimination" && m.group && m.tournamentId === selectedTournamentId).sort((a, b) => a.round - b.round),
    eliminationFinal: state.matches.filter((m: Match) => m.phase === "elimination" && m.group === null && m.tournamentId === selectedTournamentId).sort((a, b) => a.round - b.round),
  };

  const colors = [
    "from-blue-900 to-blue-700",
    "from-green-900 to-green-700",
    "from-purple-900 to-purple-700",
    "from-orange-900 to-orange-700",
    "from-rose-900 to-rose-700",
  ];

  const renderMatch = (m: Match) => (
    <div
        key={m.id}
        className={`flex justify-between items-center bg-white/10 rounded-lg p-3 transition-all ${
            m.finished === false && state.currentMatchId === m.id
              ? "border-2 border-yellow-400 shadow-[0_0_15px_#FFD700] animate-pulse"
              : m.phase === 'repechage' ? "border-l-4 border-purple-500" : "border-l-4 border-transparent"
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
            {state.currentMatchId === m.id
              ? "Em andamento"
              : "Iniciar Luta"}
          </button>
        )}
    </div>
  );


  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000814] to-[#001933] text-white p-8 select-none">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-10">
        <h1 className="text-3xl font-extrabold flex items-center gap-3">
          <Trophy className="text-yellow-400" /> Chaveamento do Torneio
        </h1>
      </div>

      {/* ---------- SELETOR DE TORNEIO E AÇÃO ---------- */}
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
                          {t.name} ({t.status.toUpperCase()}) {t.id === state.tournamentId && "(ATIVO GLOBAL)"}
                      </option>
                  ))}
              </select>
          </div>
          
          {/* BOTÃO GERAR CHAVEAMENTO */}
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

      {/* Exibição do Vencedor da Repescagem (NOVO) */}
      {repechageWinner && (
          <div className="bg-purple-600/30 border border-purple-400 p-4 rounded-lg shadow-md mb-8 max-w-4xl mx-auto text-center">
              <span className="text-xl font-bold text-purple-300 flex items-center justify-center gap-2">
                  <Trophy /> Vencedor da Repescagem: {repechageWinner.name}
              </span>
              <p className="text-sm text-white/70">Este robô avançou para a Fase Final Geral.</p>
          </div>
      )}

      {/* ---------- GRUPOS E TABELAS ---------- */}
      <h2 className="text-2xl font-bold mb-6 text-center">Fase de Grupos</h2>
      {groups.length === 0 && (
          <p className="text-white/60 text-center">O torneio não possui partidas de grupo geradas ou selecionadas.</p>
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
                  {(state!.groupTables[g] as GroupTableItem[] | undefined)?.map(
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

            {/* ---------- PARTIDAS DE GRUPO ---------- */}
            <h4 className="flex items-center gap-2 font-bold mb-2">
              <Swords size={18} /> Partidas de Grupo
            </h4>
            <div className="space-y-2">
              {matchesByPhase.groups
                .filter((m: any) => m.group === g)
                .map(renderMatch)}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- MATA-MATA REPESCAGEM (NOVO) ---------- */}
      {matchesByPhase.repechage.length > 0 && (
          <div className="mt-16 bg-purple-600/20 p-6 rounded-2xl">
              <h2 className="text-2xl font-bold mb-6 text-center text-purple-300">
                  ⚡ Fase de Repescagem
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
                  {/* Agrupamento por Round da Repescagem */}
                  {[...new Set(matchesByPhase.repechage.map(m => m.round))].map(round => (
                      <div key={`rep-r${round}`} className="bg-black/20 p-4 rounded-xl">
                          <h4 className="text-lg font-bold mb-3 text-purple-200">Round {round}</h4>
                          <div className="space-y-2">
                              {matchesByPhase.repechage.filter(m => m.round === round).map(renderMatch)}
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* ---------- MATA-MATA POR GRUPO ---------- */}
      {matchesByPhase.eliminationGroup.length > 0 && (
        <div className="mt-16">
          <h2 className="text-2xl font-bold mb-6 text-center">
            Eliminação Interna (Quartas/Semis por Grupo)
          </h2>
          {Object.keys(state.groupTables || {}).map((label) => (
            <div key={`elim-group-${label}`} className="mb-8 p-4 border border-white/20 rounded-xl">
              <h3 className="text-lg font-bold mb-3 text-yellow-400">
                Grupo {label}
              </h3>
              <div className="space-y-2">
                {matchesByPhase.eliminationGroup
                  .filter((m: any) => m.group === label)
                  .map(renderMatch)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- FASE FINAL ENTRE CAMPEÕES ---------- */}
      {matchesByPhase.eliminationFinal.length > 0 && (
        <div className="mt-16">
          <h2 className="text-2xl font-bold mb-4 text-center text-yellow-400">
            🏆 Fase Final — GERAL
          </h2>

          <div className="space-y-2 max-w-4xl mx-auto">
            {matchesByPhase.eliminationFinal
              .sort((a: any, b: any) => a.round - b.round)
              .map(renderMatch)}
          </div>
        </div>
      )}
      
      <div className="mt-10 text-center text-white/60 text-sm">
        Após o fim das partidas, os{" "}
        <span className="text-arena-accent font-bold">
          {advancePerGroupActive} primeiros
        </span>{" "}
        de cada grupo avançam, e o vencedor da **Repescagem** se junta à Fase Final.
      </div>

    </div>
  );
}