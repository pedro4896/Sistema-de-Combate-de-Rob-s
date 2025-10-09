import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";

export default function Screen() {
  const [state, setState] = useState<any>(null);
  function refresh(s:any){ setState(s); }
  useEffect(() => {
    api("/state").then(r => refresh(r.state));
    return onMessage(msg => msg.type==="UPDATE_STATE" && refresh(msg.payload.state));
  }, []);
  if (!state) return null;

  const mm = String(Math.floor(state.timer/60)).padStart(2,"0");
  const ss = String(state.timer%60).padStart(2,"0");
  const rec = state.recoveryTimer;

  const winnerName = state.winner
    ? (state.robots.find((r:any)=>r.id===state.winner)?.name ?? "—")
    : "—";

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center"
         style={{ backgroundImage: "radial-gradient(ellipse at center, rgba(0,255,156,0.1), transparent 60%)" }}>
      <div className="text-5xl md:text-8xl font-black tracking-widest">
        {state.status==="recovery" ? `RECOVERY ${rec}s` : `${mm}:${ss}`}
      </div>
      <div className="mt-8 text-3xl font-bold">
        🏆 {winnerName !== "—" ? `Vencedor: ${winnerName}` : ""}
      </div>
    </div>
  );
}
