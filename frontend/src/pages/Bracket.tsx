import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Swords, Settings } from "lucide-react";

interface GroupTableItem {
  robotId: string;
  name: string;
  team?: string;
  pts: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
}

export default function Chaveamento() {
  const [state, setState] = useState<any>(null);

  // valores temporários (inputs)
  const [groupCountInput, setGroupCountInput] = useState(2);
  const [robotsPerGroupInput, setRobotsPerGroupInput] = useState(4);
  const [advancePerGroupInput, setAdvancePerGroupInput] = useState(2);

  // valores ativos aplicados
  const [groupCountActive, setGroupCountActive] = useState(2);
  const [advancePerGroupActive, setAdvancePerGroupActive] = useState(2);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/state").then((r) => {
      setState(r.state);
      setGroupCountActive(r.state?.groupCount || 2);
      setAdvancePerGroupActive(r.state?.advancePerGroup || 2);
    });

    return onMessage((m) => {
      if (m.type === "UPDATE_STATE") {
        setState(m.payload.state);
        if (m.payload.state.groupCount)
          setGroupCountActive(m.payload.state.groupCount);
        if (m.payload.state.advancePerGroup)
          setAdvancePerGroupActive(m.payload.state.advancePerGroup);
      }
    });
  }, []);

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

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10">
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
                    <th>PTS</th>
                    <th>W</th>
                    <th>D</th>
                    <th>L</th>
                    <th>GF</th>
                    <th>GA</th>
                    <th>GD</th>
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
                        <td>{r.gf}</td>
                        <td>{r.ga}</td>
                        <td>{r.gd}</td>
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
                .filter((m: any) => m.group === g)
                .map((m: any) => (
                  <div
                    key={m.id}
                    className={`flex justify-between items-center bg-white/10 rounded-lg p-3 ${
                      m.finished
                        ? "border-l-4 border-arena-accent"
                        : "border-l-4 border-transparent"
                    }`}
                  >
                    <span className="font-semibold">
                      {m.robotA?.name ?? "?"}{" "}
                      <span className="text-arena-accent">vs</span>{" "}
                      {m.robotB?.name ?? "?"}
                    </span>
                    {m.finished ? (
                      <span className="font-bold text-arena-accent">
                        {m.scoreA} - {m.scoreB}
                      </span>
                    ) : (
                      <span className="text-white/50">pendente</span>
                    )}
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
    </div>
  );
}
