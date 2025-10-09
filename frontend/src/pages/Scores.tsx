import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy, Save } from "lucide-react";

export default function Scores() {
  const [state, setState] = useState<any>(null);
  const [scoreA, setScoreA] = useState<number>(0);
  const [scoreB, setScoreB] = useState<number>(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api("/state").then((r) => setState(r.state));
    return onMessage((m) => m.type === "UPDATE_STATE" && setState(m.payload.state));
  }, []);

  const current = useMemo(() => {
    if (!state) return null;
    return (
      state.matches.find((m: any) => m.id === state.currentMatchId) ??
      state.matches.find((m: any) => !m.finished) ??
      state.matches[state.matches.length - 1]
    );
  }, [state]);

  if (!state) return <p className="sub">Carregando dados...</p>;
  if (!current) return <p className="sub">Nenhuma luta ativa.</p>;

  const a = current.robotA;
  const b = current.robotB;
  const winner =
    scoreA > scoreB ? a : scoreB > scoreA ? b : null;

  async function saveResult() {
    if (!current) return;
    await api(`/matches/${current.id}/result`, {
      method: "POST",
      body: JSON.stringify({ scoreA, scoreB }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="heading flex items-center gap-2">
          <Trophy /> Atribuir Pontuação
        </h2>
        {saved && (
          <span className="text-arena-accent text-sm font-bold">
            ✅ Resultado salvo!
          </span>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div
          className={`card text-center ${
            winner?.id === a?.id ? "border-arena-accent shadow-[0_0_20px_#00FF9C50]" : ""
          }`}
        >
          <div className="heading mb-2">{a?.name ?? "—"}</div>
          <div className="sub mb-2">Equipe: {a?.team ?? "—"}</div>
          {a?.image && (
            <img
              src={a.image}
              className="mx-auto mb-2 max-h-48 rounded-xl object-cover"
            />
          )}
          <input
            type="number"
            value={scoreA}
            onChange={(e) => setScoreA(Number(e.target.value))}
            className="text-4xl font-bold text-center w-24 mx-auto bg-white/10 rounded-xl p-2"
          />
        </div>

        <div
          className={`card text-center ${
            winner?.id === b?.id ? "border-arena-accent shadow-[0_0_20px_#00FF9C50]" : ""
          }`}
        >
          <div className="heading mb-2">{b?.name ?? "—"}</div>
          <div className="sub mb-2">Equipe: {b?.team ?? "—"}</div>
          {b?.image && (
            <img
              src={b.image}
              className="mx-auto mb-2 max-h-48 rounded-xl object-cover"
            />
          )}
          <input
            type="number"
            value={scoreB}
            onChange={(e) => setScoreB(Number(e.target.value))}
            className="text-4xl font-bold text-center w-24 mx-auto bg-white/10 rounded-xl p-2"
          />
        </div>
      </div>

      <div className="flex justify-center mt-6">
        <button
          className="btn btn-accent flex items-center gap-2"
          onClick={saveResult}
          disabled={!a || !b}
        >
          <Save size={16} /> Salvar Resultado
        </button>
      </div>

      {winner && (
        <div className="text-center mt-6 text-2xl font-bold text-arena-accent animate-pulse">
          🏆 {winner.name} venceu esta luta!
        </div>
      )}

      <div className="mt-8 sub text-center">
        Ao salvar, o sistema avança automaticamente para o próximo confronto
        (se houver) e o telão será atualizado com os novos robôs e timers
        reiniciados.
      </div>
    </div>
  );
}
