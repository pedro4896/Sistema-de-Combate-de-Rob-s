import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { motion } from "framer-motion";
import { Swords, Shuffle } from "lucide-react";

export default function Bracket() {
  const [matches, setMatches] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);

  function refresh(s:any){ setMatches(s.matches); setRanking(s.ranking); }
  useEffect(() => {
    api("/state").then(r => refresh(r.state));
    return onMessage(msg => msg.type==="UPDATE_STATE" && refresh(msg.payload.state));
  }, []);

  async function generate() {
    const r = await api("/matches/generate", { method:"POST" });
    setMatches(r.matches);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <h2 className="heading flex items-center gap-2"><Swords/> Chaveamento</h2>
        <button className="btn btn-accent flex items-center gap-2 ml-auto" onClick={generate}>
          <Shuffle size={16}/> Gerar Automaticamente
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {matches.map((m:any, i:number)=>(
          <motion.div key={m.id} className="card"
            initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} transition={{delay:i*0.04}}>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-center">
                <div className="text-lg font-bold">{m.robotA?.name ?? "—"}</div>
              </div>
              <div className="px-4 py-1 rounded-full bg-white/10 text-arena-accent font-black tracking-widest">VS</div>
              <div className="flex-1 text-center">
                <div className="text-lg font-bold">{m.robotB?.name ?? "—"}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center">
              <div className="sub">Round {m.round}</div>
              <div className="ml-auto sub">
                {m.finished ? (m.winner ? <>🏆 {m.winner.slice(0,8)}</> : "Empate") : "Pendente"}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div>
        <h3 className="heading mb-3">Ranking</h3>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {ranking.map((r:any, i:number)=>(
            <div key={r.robotId} className="card flex items-center gap-3">
              <div className="text-3xl font-black text-arena-accent">#{i+1}</div>
              <div className="flex-1">
                <div className="font-bold">{r.robotName}</div>
                <div className="sub">Vitórias: {r.wins}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
