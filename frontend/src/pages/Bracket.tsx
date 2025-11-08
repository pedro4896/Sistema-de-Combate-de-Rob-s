import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Swords, Settings, Play } from "lucide-react";
import type { GroupTableItem, Match } from "../../../backend/src/types"; // Garante que todos os tipos são importados com 'type'

export default function Chaveamento() {
  const [state, setState] = useState<any>(null);

  // valores temporários (inputs)
  const [groupCountInput, setGroupCountInput] = useState(2);
  const [robotsPerGroupInput, setRobotsPerGroupInput] = useState(5);
  const [advancePerGroupInput, setAdvancePerGroupInput] = useState(4);

  // valores ativos aplicados
  const [groupCountActive, setGroupCountActive] = useState(2);
  const [advancePerGroupActive, setAdvancePerGroupActive] = useState(2);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Busca estado inicial
    api("/state").then((r) => {
      const newState = { ...r.state };
      // O cálculo da tabela agora é responsabilidade exclusiva do backend.
      setState(newState);

      setGroupCountActive(newState?.groupCount || 2);
      setAdvancePerGroupActive(newState?.advancePerGroup || 2);
    });

    // Atualização em tempo real via WebSocket
    return onMessage((m) => {
      if (m.type === "UPDATE_STATE") {
        const s = { ...m.payload.state };
        // O cálculo da tabela agora é responsabilidade exclusiva do backend.
        setState(s);

        if (s.groupCount) setGroupCountActive(s.groupCount);
        if (s.advancePerGroup) setAdvancePerGroupActive(s.advancePerGroup);
      }
    });
  }, []);

  // Funções de cálculo de tabela de grupo do frontend removidas - confiar no backend.
  
  // Gera chaveamento
  const gerarChaveamento = async () => {
    setLoading(true);
    await api("/matches/generate", {
      method: "POST",
      body: JSON.stringify({
        groupCount: groupCountInput,
        robotsPerGroup: robotsPerGroupInput,
        advancePerGroup: advancePerGroupInput,
      }),
    });
    setGroupCountActive(groupCountInput);
    setAdvancePerGroupActive(advancePerGroupInput);
    setLoading(false);
  };

// 🧩 Gerar fase de eliminação (mata-mata)
const gerarMataMata = async () => {
  if (!state?.groupTables || !state?.matches) {
    alert("❌ Nenhum dado de grupo encontrado.");
    return;
  }

  // Verifica se todos os matches da fase de grupos já terminaram
  const allGroupsFinished = state.matches
    .filter((m: any) => m.phase === "groups")
    .every((m: any) => m.finished);

  if (!allGroupsFinished) {
    alert("⏳ Ainda há partidas em andamento nos grupos!");
    return;
  }

  // A lógica de geração do mata-mata é tratada pelo backend (generateEliminationFromGroups)
  // após o último match da fase de grupos.

  alert("O mata-mata é gerado automaticamente pelo servidor após a última partida de grupo. Caso não tenha gerado, verifique o console do backend.");
  return; 
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
          <Trophy className="text-yellow-400" /> Configurar Chaveamento
        </h1>
      </div>

      {/* ---------- CONFIGURAÇÃO ---------- */}
      <div className="bg-white/10 p-6 rounded-2xl shadow-xl mb-10 max-w-3xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <label className="block mb-2 text-sm text-white/70">
              Quantidade de Grupos
            </label>
            <input
              type="number"
              min="1"
              value={groupCountInput}
              onChange={(e) => setGroupCountInput(Number(e.target.value))}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full"
            />
          </div>

          <div>
            <label className="block mb-2 text-sm text-white/70">
              Robôs por Grupo
            </label>
            <input
              type="number"
              min="2"
              value={robotsPerGroupInput}
              onChange={(e) => setRobotsPerGroupInput(Number(e.target.value))}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full"
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
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 w-full"
            />
          </div>

          <button
            onClick={gerarChaveamento}
            disabled={loading}
            className="bg-arena-accent text-black font-bold rounded-xl px-6 py-3 hover:opacity-90 transition-all duration-200 flex items-center gap-2"
          >
            <Settings size={18} />
            {loading ? "Gerando..." : "Gerar"}
          </button>
        </div>
      </div>

      {/* ---------- GRUPOS E TABELAS ---------- */}
      <h2 className="text-2xl font-bold mb-6 text-center">Fase de Grupos</h2>
      {groups.length === 0 && (
        <p className="text-white/60 text-center">Nenhum grupo gerado ainda.</p>
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
                .filter((m: any) => m.group === g && m.phase === "groups")
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

    </div>
  );
}