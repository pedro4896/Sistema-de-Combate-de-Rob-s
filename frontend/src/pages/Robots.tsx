import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { motion } from "framer-motion";
import { Trash2, Plus } from "lucide-react";
import { s } from "framer-motion/client";

type Robot = { id:string; name:string; team:string; image?:string, score?:number; };

export default function Robots() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [image, setImage] = useState("");
  const [score, setScore] = useState(0);

  function refresh(s:any){ setRobots(s.robots); }
  useEffect(()=>{ api("/state").then(r=>refresh(r.state)); return onMessage(m=>m.type==="UPDATE_STATE"&&refresh(m.payload.state)); },[]);

  async function addRobot(){
    if(!name.trim())return;
    await api("/robots",{method:"POST",body:JSON.stringify({name,team,image,score})});
    setName(""); setTeam(""); setImage(""); setScore(0);
  }
  async function delRobot(id:string){ await api(`/robots/${id}`,{method:"DELETE"}); }

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div><label className="sub block mb-1">Nome</label>
          <input className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 w-60" value={name} onChange={e=>setName(e.target.value)} /></div>
        <div><label className="sub block mb-1">Equipe</label>
          <input className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 w-60" value={team} onChange={e=>setTeam(e.target.value)} /></div>
        <div><label className="sub block mb-1">URL da imagem</label>
          <input className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 w-96" value={image} onChange={e=>setImage(e.target.value)} /></div>
        <button className="btn btn-accent flex items-center gap-2" onClick={addRobot}><Plus size={18}/>Cadastrar</button>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {robots.map((r,i)=>(
          <motion.div key={r.id} className="card" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}>
            <div className="aspect-video rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
              {r.image ? <img src={r.image} className="w-full h-full object-cover"/> : <span className="sub">Sem imagem</span>}
            </div>
            <div className="mt-3 flex items-center">
              <div>
                <div className="heading">{r.name}</div>
                <div className="sub">Equipe: {r.team}</div>
              </div>
              <button className="ml-auto btn btn-danger" onClick={()=>delRobot(r.id)}><Trash2 size={16}/></button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
