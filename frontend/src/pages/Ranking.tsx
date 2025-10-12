import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Bot } from "lucide-react";

interface GroupTableItem {
  robotId: string;
  name: string;
  team?: string;
  pts: number;
  wins: number;
  losses: number;
  draws: number;
  ko?: number;
  wo?: number;
}

export default function Ranking() {
  const [ranking, setRanking] = useState<GroupTableItem[]>([]);

    useEffect(() => {
    const load = async () => {
        const r = await api("/ranking");
        if (r.ok) setRanking(r.ranking);
    };

    load();

    // Atualiza quando o estado mudar
    return onMessage((m) => {
        if (m.type === "UPDATE_STATE") {
        load();
        }
    });
    }, []);

    const renderRobotImage = (robot: Robot, color: string) => {
      // Verifica se o robô tem imagem e exibe
      if (robot?.image)
        return (
          <img
            src={robot.image}
            alt={robot.name}
            className={`w-20 h-20 object-cover rounded-full shadow-lg mb-3 mt-3 flex items-center justify-center`}
          />
        );
    
      // Fallback caso a imagem não esteja disponível
      return (
         <div
          className={`w-20 h-20 object-cover rounded-full shadow-lg mb-3 mt-3 flex items-center justify-center bg-${color}-800`}
        >
         <Bot size={48} className={`text-${color}-300`} />
        </div>
      );
    };



  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000814] to-[#001933] text-white flex flex-col items-center p-10">
      <h1 className="text-4xl font-extrabold flex items-center gap-3 mb-10 text-yellow-400">
        <Trophy className="text-yellow-400" size={40} /> Ranking Geral de Robôs
      </h1>

      <div className="w-full max-w-5xl overflow-x-auto rounded-xl shadow-lg bg-white/10 backdrop-blur-md border border-white/20">
        <table className="w-full text-sm text-center border-collapse">
          <thead className="bg-white/10 text-yellow-400">
            <tr>
              <th className="py-3">#</th>
              <th className="text-left pl-3">Robô</th>
              <th>Pontos</th>
              <th>Vitórias</th>
              <th>Derrotas</th>
              <th>Empates</th>
              <th>K.O</th>
              <th>W.O</th>
            </tr>
          </thead>

          <tbody>
            {ranking.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-6 text-gray-400">
                  Nenhum dado disponível ainda. Aguarde o término das lutas.
                </td>
              </tr>
            ) : (
              ranking.map((r, i) => (
                <tr
                  key={r.robotId}
                  className={`border-b border-white/10 hover:bg-white/5 transition ${
                    i === 0 ? "text-yellow-300 font-bold" : "text-white/90"
                  }`}
                >
                  <td className="py-3">{i + 1}</td>
                  <td className="text-left flex items-center gap-3 pl-3">
                    <div className="">
                      {renderRobotImage(r, "green")}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-white">{r.name}</span>
                      {r.team && (
                        <span className="text-xs text-white/60">
                          Equipe {r.team}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{r.pts}</td>
                  <td>{r.wins}</td>
                  <td>{r.losses}</td>
                  <td>{r.draws}</td>
                  <td>{r.ko || 0}</td>
                  <td>{r.wo || 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
