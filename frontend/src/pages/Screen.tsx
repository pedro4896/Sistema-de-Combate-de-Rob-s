import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";

export default function Screen() {
  const [state, setState] = useState<any>(null);

  // 🔹 Sempre chame useEffect antes de qualquer return
  useEffect(() => {
    api("/state").then((r) => setState(r.state));
    return onMessage((m) => {
      if (m.type === "UPDATE_STATE") setState(m.payload.state);
    });
  }, []);

  // 🔹 O useMemo é chamado sempre, mesmo que state ainda seja null
  const current = useMemo(() => {
    if (!state || !state.matches) return null;
    return (
      state.matches.find((m: any) => m.id === state.currentMatchId) ??
      state.matches[state.matches.length - 1]
    );
  }, [state]);

  // Se ainda não temos dados, renderiza loading simples
  if (!state)
    return (
      <div className="min-h-screen flex items-center justify-center text-white/60">
        Carregando tela...
      </div>
    );

  const a = current?.robotA;
  const b = current?.robotB;
  const mm = String(Math.floor((state.mainTimer || 0) / 60)).padStart(2, "0");
  const ss = String((state.mainTimer || 0) % 60).padStart(2, "0");
  const rec = state.recoveryActive ? state.recoveryTimer : null;
  const winner = state.winner || current?.winner;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#000814] to-[#001933]">
      <div className="text-6xl md:text-8xl font-black tracking-widest text-arena-accent">
        {state.recoveryActive ? `RECOVERY ${rec}s` : `${mm}:${ss}`}
      </div>

      <div className="grid md:grid-cols-2 gap-10 mt-10 max-w-5xl w-full px-6">
        {[a, b].map((r: any, i) => (
          <div
            key={i}
            className={`card text-center ${
              winner && winner.id === r?.id
                ? "border-arena-accent shadow-[0_0_20px_#00FF9C50]"
                : ""
            }`}
          >
            <div className="font-bold text-xl">{r?.name ?? "—"}</div>
            {r?.image && (
              <img
                src={r.image}
                className="mt-2 w-full max-h-64 object-cover rounded-xl"
              />
            )}
            <div className="mt-1 sub">Equipe: {r?.team ?? "—"}</div>
            <div className="mt-1 sub">
              Score: {i === 0 ? current?.scoreA : current?.scoreB}
            </div>
          </div>
        ))}
      </div>

      {winner && (
        <div className="mt-10 text-4xl font-extrabold text-arena-accent animate-pulse">
          🏆 {winner.name} venceu!
        </div>
      )}
    </div>
  );
}
