import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { Trophy } from "lucide-react";

export default function Scores() {
  const [state, setState] = useState<any>(null);
  const [scoreA, setScoreA] = useState<number>(0);
  const [scoreB, setScoreB] = useState<number>(0);

  useEffect(()=>{ api("/state").then(r=>setState(r.state)); return onMessage(m=>m.type==="UPDATE_STATE"&&setState(m.payload.state)); },[]);

  const current = useMemo(()=> state?.matches.find((m:any)=>m.id===state.currentMatchId) ?? state?.matches.find((m:any)=>!m.finished), [state]);
  if(!state) return <p className="sub">Carregando...</p>;
  if(!current) return <p className="sub">Não há luta pendente para pontuar.</p>;

  const a = current.robotA, b = current.robotB;

  async function save() {
    await api(`/matches/${current.id}/result`, { method:"POST", body: JSON.stringify({ scoreA, scoreB }) });
    setScoreA(0); setScoreB(0);
  }

  return (
    <div className="card max-w-2xl mx-auto text-center">
      <div className="heading flex items-center justify-center gap-2"><Trophy/> Atribuir Pontuação</div>
      <div className="mt-4 grid grid-cols-3 items-center gap-3">
        <div className="text-right">
          <div className="font-bold text-xl">{a?.name ?? "—"}</div>
          {a?.image && <img src={a.image} className="w-36 h-24 object-cover rounded-xl ml-auto mt-2" />}
          <input type="number" className="mt-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 w-24 text-center"
            value={scoreA} onChange={e=>setScoreA(parseInt(e.target.value || "0"))}/>
        </div>
        <div className="text-arena-accent font-black text-3xl">VS</div>
        <div className="text-left">
          <div className="font-bold text-xl">{b?.name ?? "—"}</div>
          {b?.image && <img src={b.image} className="w-36 h-24 object-cover rounded-xl mt-2" />}
          <input type="number" className="mt-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 w-24 text-center"
            value={scoreB} onChange={e=>setScoreB(parseInt(e.target.value || "0"))}/>
        </div>
      </div>
      <button className="btn btn-accent mt-5" onClick={save}>Salvar Pontuação</button>
      <div className="mt-3 sub">Ao salvar: vencedor exibido no telão, chaveamento avança automaticamente e o ranking é recalculado.</div>
    </div>
  );
}
