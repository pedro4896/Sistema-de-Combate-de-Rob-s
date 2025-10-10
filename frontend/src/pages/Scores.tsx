import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Bot } from "lucide-react";

interface Robot {
  id: string;
  name: string;
  team?: string;
  image?: string;
}

export default function Scores() {
  const [state, setState] = useState<any>(null);
  const [match, setMatch] = useState<any>(null);
  const [judges, setJudges] = useState([
    { judgeId: "J1", damageA: 0, hitsA: 0, damageB: 0, hitsB: 0 },
    { judgeId: "J2", damageA: 0, hitsA: 0, damageB: 0, hitsB: 0 },
    { judgeId: "J3", damageA: 0, hitsA: 0, damageB: 0, hitsB: 0 },
  ]);

  useEffect(() => {
    // Busca o estado inicial
    api("/state").then((r) => {
      setState(r.state);
      const current = r.state.matches.find((m: any) => m.id === r.state.currentMatchId);
      setMatch(current);
    });

    // Atualiza em tempo real
    return onMessage((m) => {
      if (m.type === "UPDATE_STATE") {
        setState(m.payload.state);
        const current = m.payload.state.matches.find(
          (mm: any) => mm.id === m.payload.state.currentMatchId
        );
        setMatch(current);
      }
    });
  }, []);

  const update = (ji: number, field: string, val: number) => {
    const copy = [...judges];
    (copy[ji] as any)[field] = val;
    setJudges(copy);
  };

  const submit = async () => {
    if (!match) return alert("❌ Nenhuma luta ativa!");

    // Envia as pontuações para o backend (no formato correto)
    await api(`/matches/${match.id}/judges`, {
      method: "POST",
      body: JSON.stringify({ judges }),
      headers: {
        "Content-Type": "application/json", // Garantir que o header está correto
      },
    });

    alert("✅ Pontuação enviada com sucesso!");
  };


  if (!match) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#000814] text-white">
        <h2 className="text-2xl font-bold mb-4">Nenhuma luta em andamento</h2>
        <p className="text-white/60">
          Aguarde o juiz iniciar uma partida para liberar a tela de pontuação.
        </p>
      </div>
    );
  }

  const robotA: Robot = match.robotA;
  const robotB: Robot = match.robotB;

  const renderRobotImage = (robot: Robot, color: string) => {
    // Verifica se o robô tem imagem e exibe
    if (robot?.image)
      return (
        <img
          src={robot.image}
          alt={robot.name}
          className={`w-32 h-32 object-cover rounded-full border-4 border-${color}-400 shadow-lg mb-3`}
        />
      );

    // Fallback caso a imagem não esteja disponível
    return (
      <div
        className={`w-32 h-32 flex items-center justify-center rounded-full border-4 border-${color}-400 bg-${color}-950/40 shadow-inner mb-3`}
      >
        <Bot size={48} className={`text-${color}-300`} />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000814] to-[#001933] text-white flex flex-col items-center p-10">
      <h1 className="text-3xl font-extrabold text-center mb-10">
        Avaliação dos Jurados — Round {match.round}
      </h1>

      {/* ======= PAINÉIS DOS ROBÔS ======= */}
      <div className="grid md:grid-cols-2 gap-10 w-full max-w-6xl">

        {/* -------- ROBÔ AZUL -------- */}
        <div className="bg-gradient-to-b from-blue-900/90 to-blue-700/50 rounded-2xl p-6 shadow-2xl border border-blue-400/30">
          <div className="flex flex-col items-center mb-6">
            {renderRobotImage(robotA, "blue")}
            <h2 className="text-2xl font-bold text-blue-300">{robotA?.name ?? "Robô Azul"}</h2>
            {robotA?.team && (
              <p className="text-sm text-white/70 mt-1">{robotA.team}</p>
            )}
          </div>

          <h3 className="text-lg font-bold text-center mb-4 text-yellow-400">
            🧩 Notas dos Jurados
          </h3>

          <table className="w-full text-center border-collapse mb-6">
            <thead className="bg-white/10 text-yellow-400">
              <tr>
                <th className="py-2">Jurado</th>
                <th>Dano (0–6)</th>
                <th>Agressividade (0–5)</th>
              </tr>
            </thead>
            <tbody>
              {judges.map((j, i) => (
                <tr key={j.judgeId} className="border-b border-white/10">
                  <td className="font-semibold text-white py-2">{j.judgeId}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="6"
                      value={j.damageA}
                      onChange={(e) => update(i, "damageA", Number(e.target.value))}
                      className="w-16 text-center bg-blue-950/40 border border-blue-300/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={j.hitsA}
                      onChange={(e) => update(i, "hitsA", Number(e.target.value))}
                      className="w-16 text-center bg-blue-950/40 border border-blue-300/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* -------- ROBÔ VERDE -------- */}
        <div className="bg-gradient-to-b from-green-900/90 to-green-700/50 rounded-2xl p-6 shadow-2xl border border-green-400/30">
          <div className="flex flex-col items-center mb-6">
            {renderRobotImage(robotB, "green")}
            <h2 className="text-2xl font-bold text-green-300">{robotB?.name ?? "Robô Verde"}</h2>
            {robotB?.team && (
              <p className="text-sm text-white/70 mt-1">{robotB.team}</p>
            )}
          </div>

          <h3 className="text-lg font-bold text-center mb-4 text-yellow-400">
            🧩 Notas dos Jurados
          </h3>

          <table className="w-full text-center border-collapse mb-6">
            <thead className="bg-white/10 text-yellow-400">
              <tr>
                <th className="py-2">Jurado</th>
                <th>Dano (0–6)</th>
                <th>Agressividade (0–5)</th>
              </tr>
            </thead>
            <tbody>
              {judges.map((j, i) => (
                <tr key={j.judgeId} className="border-b border-white/10">
                  <td className="font-semibold text-white py-2">{j.judgeId}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="6"
                      value={j.damageB}
                      onChange={(e) => update(i, "damageB", Number(e.target.value))}
                      className="w-16 text-center bg-green-950/40 border border-green-300/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={j.hitsB}
                      onChange={(e) => update(i, "hitsB", Number(e.target.value))}
                      className="w-16 text-center bg-green-950/40 border border-green-300/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* -------- BOTÃO ENVIAR -------- */}
      <button
        onClick={submit}
        className="mt-12 bg-yellow-400 text-black font-extrabold px-12 py-4 rounded-2xl text-lg hover:opacity-90 shadow-lg transition"
      >
        Enviar Pontuação
      </button>
    </div>
  );
}
