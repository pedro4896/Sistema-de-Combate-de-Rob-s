import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { motion } from "framer-motion";
import { Trash2, Plus } from "lucide-react";
import { Bot } from "lucide-react";
import { Edit3 } from "lucide-react";

type Robot = { id:string; name:string; team:string; image?:string, score?:number; };

export default function Robots() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [image, setImage] = useState("");
  const [score, setScore] = useState(0);
  const [editing, setEditing] = useState<Robot | null>(null);
  const [editName, setEditName] = useState("");
  const [editTeam, setEditTeam] = useState("");
  const [editImage, setEditImage] = useState("");

  function refresh(s:any){ setRobots(s.robots); }
  useEffect(()=>{ api("/state").then(r=>refresh(r.state)); return onMessage(m=>m.type==="UPDATE_STATE"&&refresh(m.payload.state)); },[]);

  // CORRIGIDO: Agora verifica o retorno da API para saber se foi bem-sucedido.
  async function addRobot(){
    if(!name.trim()){
      alert("O nome do robô é obrigatório.");
      return;
    }
    
    // Normaliza team e image para enviar null (compatível com o backend)
    const robotData = {
      name,
      team: team.trim() || null, 
      image: image.trim() || null,
      score
    };

    // A função api retorna um objeto { ok, error, ... }
    const result = await api("/robots", {
        method:"POST",
        body: robotData // api.ts fará JSON.stringify
    });
    
    if (result.ok) {
        // Sucesso
        alert(`✅ Robô "${name}" cadastrado com sucesso!`); 
        setName(""); setTeam(""); setImage(""); setScore(0);
    } else {
        // Erro: exibe o erro do backend (incluindo a mensagem de restrição 409)
        alert(result.error || "❌ Falha ao cadastrar o robô. Erro desconhecido.");
    }
  }

  // Abre modal de edição
  const openEdit = (robot: Robot) => {
    setEditing(robot);
    setEditName(robot.name);
    setEditTeam(robot.team || "");
    setEditImage(robot.image || "");
  };

  // CORRIGIDO: Verifica o retorno da API para saber se foi bem-sucedido.
  const saveEdit = async () => {
    if (!editing) return;
    
    // Normaliza team e image para enviar null (compatível com o backend)
    const updatedData = {
      name: editName,
      team: editTeam.trim() || null, 
      image: editImage.trim() || null,
    };

    const result = await api(`/robots/${editing.id}`, {
        method: "PUT",
        // api.ts fará JSON.stringify
        body: updatedData, 
    });

    if (result.ok) {
        alert(`✅ Robô "${editName}" atualizado com sucesso!`);
        setEditing(null);
    } else {
        // Erro: exibe o erro do backend
        alert(result.error || "❌ Falha ao atualizar o robô. Erro desconhecido.");
    }
  };

  async function delRobot(id:string){ 
      const result = await api(`/robots/${id}`,{method:"DELETE"}); 
      
      if (result.ok) {
          alert("🗑️ Robô removido com sucesso!");
      } else {
          alert(result.error || "❌ Falha ao remover o robô.");
      }
  }

  const renderRobotImage = (robot: Robot, color: string) => {
    // Verifica se o robô tem imagem e exibe
    if (robot?.image)
      return (
        <img
          src={robot.image}
          alt={robot.name}
          className={`object-cover w-full h-full`}
        />
      );

    // Fallback caso a imagem não esteja disponível
    return (
      <div
        className={`flex items-center justify-center shadow-inner mb-3`}
      >
      <Bot size={"60%"} className={`text-${color}-300`} />
      </div>
    );
  };

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
              {renderRobotImage(r, "white")}
            </div>
            <div className="mt-3 flex items-center justify-start gap-4">
              <div>
                <div className="heading">{r.name}</div>
                <div className="sub">Equipe: {r.team || "N/A"}</div>
              </div>
              <button className="ml-auto btn btn-danger" onClick={()=>delRobot(r.id)}><Trash2 size={16}/></button>
              <button
                onClick={() => openEdit(r)}
                className="flex items-center gap-2 bg-yellow-400 text-black px-4 py-2 rounded-lg font-semibold hover:opacity-90 transition"
              >
                <Edit3 size={16} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
      {/* === MODAL DE EDIÇÃO === */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#001933] p-8 rounded-2xl w-96 text-center shadow-2xl border border-yellow-400/30">
            <h2 className="text-2xl font-bold text-yellow-400 mb-4">
              Editar Robô
            </h2>

            <input
              type="text"
              placeholder="Nome"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full p-2 mb-3 rounded bg-white/10 border border-white/20 text-white text-center"
            />

            <input
              type="text"
              placeholder="Equipe"
              value={editTeam}
              onChange={(e) => setEditTeam(e.target.value)}
              className="w-full p-2 mb-3 rounded bg-white/10 border border-white/20 text-white text-center"
            />

            <input
              type="text"
              placeholder="URL da imagem"
              value={editImage}
              onChange={(e) => setEditImage(e.target.value)}
              className="w-full p-2 mb-3 rounded bg-white/10 border border-white/20 text-white text-center"
            />

            <div className="flex justify-between mt-4">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:opacity-80"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                className="px-4 py-2 bg-yellow-400 text-black font-bold rounded-lg hover:opacity-80"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}