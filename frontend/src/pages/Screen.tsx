import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";

export default function Screen() {
  const [state, setState] = useState<any>(null);

  useEffect(() => {
    api("/state").then((r) => setState(r.state));
    return onMessage((m) => {
      if (m.type === "UPDATE_STATE") setState(m.payload.state);
    });
  }, []);

  const current = useMemo(() => {
    if (!state || !state.matches) return null;
    return (
      state.matches.find((m: any) => m.id === state.currentMatchId) ??
      state.matches[state.matches.length - 1]
    );
  }, [state]);

  if (!state)
    return (
      <div className="min-h-screen flex items-center justify-center text-white/60">
        Carregando Arena...
      </div>
    );

  const a = current?.robotA;
  const b = current?.robotB;
  const mm = String(Math.floor((state.mainTimer || 0) / 60)).padStart(2, "0");
  const ss = String((state.mainTimer || 0) % 60).padStart(2, "0");
  const rec = state.recoveryActive ? state.recoveryTimer : null;
  const winner = state.winner || current?.winner;
  const lastWinner = state.lastWinner;

  const showLastWinner =
    lastWinner &&
    (!state.currentMatchId ||
      state.mainStatus === "idle" ||
      state.mainStatus === "finished");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#000814] to-[#001933] text-white select-none">
      {/* TIMER CENTRAL */}
      <div className="text-7xl md:text-8xl font-black tracking-widest text-arena-accent drop-shadow-lg">
        {state.recoveryActive
          ? `RECOVERY ${rec}s`
          : `${mm}:${ss}`}
      </div>

      {/* ROBÔS */}
      <div className="grid md:grid-cols-2 gap-10 mt-12 max-w-5xl w-full px-6">
        {[a, b].map((r: any, i) => (
          <div
            key={i}
            className={`card text-center border-2 ${
              winner && winner.id === r?.id
                ? "border-arena-accent shadow-[0_0_25px_#00FF9C80]"
                : "border-white/10"
            }`}
          >
            <div className="font-bold text-2xl">{r?.name ?? "—"}</div>
            {r?.image ? (
              <img
                src={r.image}
                className="mt-3 w-full max-h-64 object-cover rounded-xl"
                alt={r?.name}
              />
            ) : (
              <div className="mt-3 h-64 flex items-center justify-center bg-white/5 rounded-xl text-white/40">
                Sem imagem
              </div>
            )}
            <div className="mt-2 text-sm text-white/70">
              Equipe: {r?.team ?? "—"}
            </div>
            <div className="mt-1 text-lg font-semibold text-arena-accent">
              Score: {i === 0 ? current?.scoreA ?? 0 : current?.scoreB ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* VENCEDOR ATUAL */}
      {winner && (
        <div className="mt-12 text-5xl font-extrabold text-arena-accent animate-pulse">
          🏆 {winner.name} venceu esta luta!
        </div>
      )}

      {/* VENCEDOR ANTERIOR / CAMPEÃO */}
      {showLastWinner && !winner && (
        <div className="mt-12 text-5xl font-extrabold text-arena-accent animate-pulse">
          🏆 {lastWinner.name} venceu o round anterior!
        </div>
      )}

      {/* CAMPEÃO FINAL */}
      {!state.currentMatchId && lastWinner && state.mainStatus === "finished" && (
        <div className="mt-12 text-6xl font-extrabold text-yellow-400 drop-shadow-[0_0_30px_#FFD70090] animate-pulse">
          👑 Campeão: {lastWinner.name}!
        </div>
      )}
    </div>
  );
}
