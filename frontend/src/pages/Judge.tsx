import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage, send } from "../ws";
import { Play, Pause, RotateCcw, AlarmClock, TimerReset } from "lucide-react";

export default function Judge() {
  const [state, setState] = useState<any>(null);

  function refresh(s:any){ setState(s); }
  useEffect(() => {
    api("/state").then(r => refresh(r.state));
    return onMessage(msg => msg.type==="UPDATE_STATE" && refresh(msg.payload.state));
  }, []);

  if (!state) return <p className="sub">Carregando...</p>;
  const current = state.matches.find((m:any)=>m.id===state.currentMatchId);

  function start(id:string){ send("START_MATCH", { matchId:id, duration:180 }); }
  function pause(){ send("PAUSE"); }
  function resume(){ send("RESUME"); }
  function recovery(){ send("START_RECOVERY", { seconds: 10 }); }

  const mm = String(Math.floor(state.timer/60)).padStart(2,"0");
  const ss = String(state.timer%60).padStart(2,"0");
  const rec = state.recoveryTimer;

  return (
    <div className="space-y-6">
      <div className="card text-center">
        <div className="sub uppercase">Timer principal</div>
        <div className="timer">
          {mm}:{ss}
        </div>
        {state.status==="recovery" && (
          <div className="mt-2 text-xl">
            Recuperação: <span className="font-extrabold text-arena-danger">{rec}s</span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn btn-accent flex items-center gap-2" onClick={()=>current && start(current.id)}>
            <Play size={16}/> Iniciar
          </button>
          <button className="btn flex items-center gap-2" onClick={pause}><Pause size={16}/> Pausar</button>
          <button className="btn flex items-center gap-2" onClick={resume}><RotateCcw size={16}/> Retomar</button>
          <button className="btn btn-danger flex items-center gap-2" onClick={recovery}>
            <AlarmClock size={16}/> Recuperação (10s)
          </button>
        </div>
        <div className="mt-2 sub">Status: {state.status}</div>
      </div>

      <div className="card">
        <div className="heading mb-3">Lutas</div>
        <div className="grid md:grid-cols-2 gap-3">
          {state.matches.map((m:any)=>(
            <div key={m.id} className={`p-4 rounded-2xl border ${state.currentMatchId===m.id?"border-arena-accent":"border-white/10"} bg-white/5`}>
              <div className="flex items-center justify-between">
                <div className="font-bold">{m.robotA?.name ?? "—"}</div>
                <div className="text-arena-accent font-black">VS</div>
                <div className="font-bold">{m.robotB?.name ?? "—"}</div>
              </div>
              <div className="mt-2 sub">Score: {m.scoreA} — {m.scoreB}</div>
              <div className="mt-2 flex gap-2">
                {!m.finished && <button className="btn btn-accent" onClick={()=>send("START_MATCH",{matchId:m.id})}>Selecionar & Iniciar</button>}
                {m.finished && <span className="sub">🏆 {m.winner ? m.winner.slice(0,8) : "Empate"}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sub">
        <TimerReset size={16}/> Ao encerrar no Scores a próxima luta é selecionada automaticamente.
      </div>
    </div>
  );
}
