import React, { useEffect, useState , useMemo} from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Bot } from "lucide-react";
import { s } from "framer-motion/client";

interface Robot {
  id: string;
  name: string;
  team?: string;
  image?: string;
  score: number;
}

export default function Scores() {
  const [state, setState] = useState<any>(null);
  const [match, setMatch] = useState<any>(null);
  const [judges, setJudges] = useState([
    { judgeId: "J1", damageA: 0, hitsA: 0, damageB: 0, hitsB: 0 },
    { judgeId: "J2", damageA: 0, hitsA: 0, damageB: 0, hitsB: 0 },
    { judgeId: "J3", damageA: 0, hitsA: 0, damageB: 0, hitsB: 0 },
  ]);
  const [showModal, setShowModal] = useState(false);
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [resultType, setResultType] = useState<"KO" | "WO">("KO");

 useEffect(() => {
  // Buscar o estado inicial
  api("/state").then((r) => {
    const current = r.state.matches.find((m: any) => m.id === r.state.currentMatchId);
    setState(r.state);
    setMatch(current); // Garantir que a luta ativa é recebida corretamente
  });

  // // Atualizar em tempo real via WebSocket
  return onMessage((m) => {
    if (m.type === "UPDATE_STATE") {
      // Garantir que a atualização do estado seja feita corretamente
      setState((prevState: any) => {
        if (prevState.matches !== m.payload.state.matches) {
          // Somente atualizar se houver uma mudança real no estado
          return m.payload.state;
        }
        return prevState;
      });

      // Verificar se a luta ativa foi alterada
      const current = m.payload.state.matches.find(
        (mm: any) => mm.id === m.payload.state.currentMatchId
      );
      setMatch(current); // Atualiza apenas a luta ativa
    }
  });
}, []);


  const update = (ji: number, field: string, val: number) => {
    const copy = [...judges];
    (copy[ji] as any)[field] = val;
    setJudges(copy);
  };

const submitJudges = async () => {
  await api(`/matches/${match.id}/judges`, {
    method: "POST",
    body: JSON.stringify({
      judges,         // Envia as pontuações dos juízes
      decision: [],       // Tipo de decisão (K.O ou W.O)
      winnerId: match.robotA?.id,  // Pode ser robotA ou robotB, dependendo de quem for vencedor
    }),
    headers: { "Content-Type": "application/json" },
  });

  alert(`pontuações enviadas!`);
  setShowModal(false);
};


const submitResult = async () => {
  if (!selectedRobotId) return alert("❌ Selecione um robô!");
  
  // Define o tipo de decisão (K.O ou W.O)
  const decision = resultType === "KO" ? "KO" : "WO";

  // Envia o resultado para o backend (K.O ou W.O)
  await api(`/matches/${match.id}/judges`, {
    method: "POST",
    body: JSON.stringify({
      judges: [],  // Não precisamos enviar os juízes para K.O ou W.O
      decision,
      winnerId: selectedRobotId, // O ID do robô vencedor
    }),
    headers: { "Content-Type": "application/json" },
  });

  alert(`${resultType} aplicado! Robô ${selectedRobotId} ganhou com 33 pontos`);
  setShowModal(false);  // Fecha o modal
  setSelectedRobotId(null);  // Reseta o robô selecionado
};

  // Pega a luta atual; se não houver, pega a próxima pendente
  const current = useMemo(() => {
    if (!state) return null;
    return (
      state.matches.find((m: any) => m.id === state.currentMatchId) ??
      state.matches.find((m: any) => !m.finished) ??
      null
    );
  }, [state]);

if (!state) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#000814] text-white"> 
      <h2 className="text-2xl font-bold">Carregando dados...</h2>
    </div>
  );
}

  if (!current) {
  return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#000814] text-white">
        <h2 className="text-2xl font-bold mb-4">Nenhuma luta em andamento</h2>
        <p className="text-white/60">
          Aguarde o juiz iniciar uma partida para liberar a tela de pontuação.
        </p>
      </div>
  );
}

if (match.finished) {
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
        Avaliação dos Jurados
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
            Notas dos Jurados
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
            Notas dos Jurados
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
        onClick={submitJudges}
        className="mt-12 bg-yellow-400 text-black font-extrabold px-12 py-4 rounded-2xl text-lg hover:opacity-90 shadow-lg transition"
      >
        Enviar Pontuação
      </button>
      {/* -------- BOTÃO KO/WO -------- */}
      <div className="mt-6">
        <button
          onClick={() => setShowModal(true)}
          className="bg-red-500 text-white font-bold py-3 px-8 rounded-xl hover:opacity-90 transition"
        >
          KO/WO
        </button>
      </div>

      {/* ADD: Modal KO/WO */}
      {showModal && match && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-[420px] p-6 text-black">
            <h3 className="text-xl font-bold text-center mb-4">
              Selecione o vencedor e o resultado
            </h3>

            {/* Robôs */}
            <div className="space-y-3">
              <button
                onClick={() => setSelectedRobotId(match.robotA?.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border ${
                  selectedRobotId === match.robotA?.id ? "border-blue-500 bg-blue-50" : "border-gray-200"
                }`}
              >
                {match.robotA?.image ? (
                  <img
                    src={match.robotA?.image}
                    alt={match.robotA?.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-200 grid place-items-center">
                    <Bot size={22} />
                  </div>
                )}
                <div className="text-left">
                  <div className="font-semibold">{match.robotA?.name}</div>
                  <div className="text-xs text-gray-500">{match.robotA?.team}</div>
                </div>
              </button>

              <button
                onClick={() => setSelectedRobotId(match.robotB?.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border ${
                  selectedRobotId === match.robotB?.id ? "border-green-500 bg-green-50" : "border-gray-200"
                }`}
              >
                {match.robotB?.image ? (
                  <img
                    src={match.robotB?.image}
                    alt={match.robotB?.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-200 grid place-items-center">
                    <Bot size={22} />
                  </div>
                )}
                <div className="text-left">
                  <div className="font-semibold">{match.robotB?.name}</div>
                  <div className="text-xs text-gray-500">{match.robotB?.team}</div>
                </div>
              </button>
            </div>

            {/* Tipo de resultado */}
            <div className="flex gap-4 mt-5">
              <button
                onClick={() => setResultType("KO")}
                className={`flex-1 py-2 rounded-lg font-semibold ${
                  resultType === "KO" ? "bg-red-500 text-white" : "bg-red-100 text-red-700"
                }`}
              >
                K.O
              </button>
              <button
                onClick={() => setResultType("WO")}
                className={`flex-1 py-2 rounded-lg font-semibold ${
                  resultType === "WO" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700"
                }`}
              >
                W.O
              </button>
            </div>

            {/* Ações */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={submitResult}
                className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                disabled={!selectedRobotId}
              >
                Confirmar
              </button>
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedRobotId(null);
                }}
                className="flex-1 bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
