import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage, send } from "../ws";
import { Play, Pause, RotateCcw, AlarmClock, OctagonX } from "lucide-react";

export default function Judge() {
  const [state, setState] = useState<any>(null);
  const refresh = (s:any)=> setState(s);
  useEffect(()=>{ api("/state").then(r=>refresh(r.state)); return onMessage(m=>m.type==="UPDATE_STATE"&&refresh(m.payload.state)); },[]);

  const current = useMemo(()=> state?.matches.find((m:any)=>m.id===state.currentMatchId), [state]);
  if(!state) return <p className="sub">Carregando...</p>;

  const a = current?.robotA, b = current?.robotB;
  const mm = String(Math.floor((state.mainTimer||0)/60)).padStart(2,"0");
  const ss = String((state.mainTimer||0)%60).padStart(2,"0");
  const rec = state.recoveryActive ? state.recoveryTimer : 0;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        {/* card robô A */}
        <div className="card">
          <div className="heading mb-2">{a?.name ?? "—"}</div>
          <div className="aspect-video bg-black/40 rounded-xl overflow-hidden flex items-center justify-center mb-2">
            {a?.image ? <img src={a.image} className="w-full h-full object-cover"/> : <span className="sub">Sem imagem</span>}
          </div>
          <div className="sub">Score: {current?.scoreA ?? 0}</div>
        </div>
        {/* card robô B */}
        <div className="card">
          <div className="heading mb-2 text-right">{b?.name ?? "—"}</div>
          <div className="aspect-video bg-black/40 rounded-xl overflow-hidden flex items-center justify-center mb-2">
            {b?.image ? <img src={b.image} className="w-full h-full object-cover"/> : <span className="sub">Sem imagem</span>}
          </div>
          <div className="sub text-right">Score: {current?.scoreB ?? 0}</div>
        </div>
      </div>

      {/* Timers */}
      <div className="card text-center">
        <div className="sub uppercase">Timer principal</div>
        <div className="timer">{mm}:{ss}</div>
        {state.recoveryActive && <div className="mt-1 text-xl">Recuperação: <span className="font-black text-arena-danger">{rec}s</span></div>}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn btn-accent flex items-center gap-2" onClick={()=> current && send("START_MATCH",{matchId:current.id,duration:180})}><Play size={16}/> Iniciar</button>
          <button className="btn flex items-center gap-2" onClick={()=>send("PAUSE_MAIN")}><Pause size={16}/> Pausar</button>
          <button className="btn flex items-center gap-2" onClick={()=>send("RESUME_MAIN")}><RotateCcw size={16}/> Retomar</button>
          <button className="btn flex items-center gap-2" onClick={()=>send("RESET_MAIN",{seconds:180})}><RotateCcw size={16}/> Resetar Timer</button>
          <button className="btn btn-danger flex items-center gap-2" onClick={()=>send("START_RECOVERY",{seconds:10})}><AlarmClock size={16}/> 10s</button>
          <button className="btn flex items-center gap-2" onClick={()=>send("STOP_RECOVERY")}><AlarmClock size={16}/> Parar 10s</button>
          <button className="btn btn-danger flex items-center gap-2" onClick={()=>send("END_MATCH",{matchId:state.currentMatchId})}><OctagonX size={16}/> Encerrar Luta</button>
        </div>
        <div className="mt-2 sub">Status: {state.mainStatus} {state.recoveryActive ? " | recovery" : ""}</div>
      </div>
    </div>
  );
}
