import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { motion } from "framer-motion";
import { Trash2, Plus, X, Upload } from "lucide-react"; // Adicionado ícone Upload
import { Bot } from "lucide-react";
import { Edit3 } from "lucide-react";
import toast from "react-hot-toast";

type Robot = { id:string; name:string; team:string; image?:string, score?:number; };

// Interface para o estado do Modal de Confirmação
interface ConfirmationDialog {
    open: boolean;
    title: string;
    description: string;
    action: () => void; // Função a ser executada na confirmação
}

// Componente Simulado de AlertDialog para substituir window.confirm/alert
const CustomAlertDialog = ({ open, title, description, action, onClose }: {
    open: boolean;
    title: string;
    description: string;
    action: () => void;
    onClose: () => void;
}) => {
    if (!open) return null;

    const handleConfirm = () => {
        action();
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#001933] p-8 rounded-2xl w-full max-w-sm text-center shadow-2xl border border-red-400/30 relative">
                <button 
                    onClick={onClose}
                    className="absolute top-3 right-3 text-white/70 hover:text-white transition"
                >
                    <X size={20} />
                </button>
                <h2 className="text-xl font-bold text-red-400 mb-4">{title}</h2>
                <p className="text-white/80 mb-6">{description}</p>
                <div className="flex justify-between mt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 rounded-lg hover:opacity-80"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-4 py-2 bg-red-700 text-white font-bold rounded-lg hover:bg-red-600"
                    >
                        Confirmar Ação
                    </button>
                </div>
            </div>
        </div>
    );
};


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
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialog>({
      open: false,
      title: "",
      description: "",
      action: () => {},
  });
  // NOVOS STATES: Para gerenciar o nome do arquivo selecionado (UX)
  const [fileName, setFileName] = useState(""); 
  const [editFileName, setEditFileName] = useState(""); 


  // CLASSE DE ESTILO PADRÃO PARA INPUTS
  const inputStyle = "px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white";
  // Estilo para inputs dentro de modais
  const modalInputStyle = "w-full p-2 rounded bg-white/10 border border-white/20 text-white text-center";


  function refresh(s:any){ setRobots(s.robots); }
  useEffect(()=>{ api("/state").then(r=>refresh(r.state)); return onMessage(m=>m.type==="UPDATE_STATE"&&refresh(m.payload.state)); },[]);

  // NOVA FUNÇÃO: Converte arquivo para Base64 e atualiza o estado
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setTargetImage: React.Dispatch<React.SetStateAction<string>>, setTargetFileName: React.Dispatch<React.SetStateAction<string>>) => {
    const file = e.target.files?.[0];
    if (!file) {
        setTargetImage("");
        setTargetFileName("");
        return;
    }

    if (file.size > 1024 * 1024) { // Limite de 1MB para não sobrecarregar o DB/Base64
        toast.error("O arquivo é muito grande (máx: 1MB).");
        e.target.value = '';
        setTargetImage("");
        setTargetFileName("");
        return;
    }
    
    setTargetFileName(file.name);
    
    const reader = new FileReader();
    reader.onloadend = () => {
        // O resultado é uma string Base64 (ex: "data:image/jpeg;base64,...")
        setTargetImage(reader.result as string);
    };
    reader.onerror = () => {
        toast.error("Falha ao ler o arquivo.");
        setTargetImage("");
        setTargetFileName("");
    };
    reader.readAsDataURL(file);
  };

  // CORRIGIDO: Usa toast para notificações
  async function addRobot(){
    if(!name.trim()){
      toast.error("O nome do robô é obrigatório.");
      return;
    }
    
    const robotData = {
      name,
      team: team.trim() || null, 
      image: image.trim() || null,
      score
    };

    const result = await api("/robots", {
        method:"POST",
        body: robotData
    });
    
    if (result.ok) {
        toast.success(`Robô "${name}" cadastrado com sucesso!`); 
        setName(""); setTeam(""); setImage(""); setScore(0); setFileName(""); // Reseta o nome do arquivo
    } else {
        toast.error(result.error || "Falha ao cadastrar o robô. Erro desconhecido.");
    }
  }

  // Abre modal de edição (ATUALIZADO para limpar o nome do arquivo)
  const openEdit = (robot: Robot) => {
    setEditing(robot);
    setEditName(robot.name);
    setEditTeam(robot.team || "");
    setEditImage(robot.image || "");
    setEditFileName(""); // Reseta o nome do arquivo ao abrir a edição
  };

  // CORRIGIDO: Usa toast para notificações e verifica restrição de PUT
  const saveEdit = async () => {
    if (!editing) return;
    
    const updatedData = {
      name: editName,
      team: editTeam.trim() || null, 
      image: editImage.trim() || null,
    };

    const result = await api(`/robots/${editing.id}`, {
        method: "PUT",
        body: updatedData, 
    });

    if (result.ok) {
        toast.success(`Robô "${editName}" atualizado com sucesso!`);
        setEditing(null);
        setEditFileName(""); // Limpa o nome do arquivo após salvar
    } else {
        toast.error(result.error || "Falha ao atualizar o robô. Erro desconhecido.");
    }
  };

  // Funções que ativam o modal de confirmação
  const confirmDelete = async (id: string) => {
    const result = await api(`/robots/${id}`,{method:"DELETE"}); 
    if (result.ok) {
        toast.success("Robô removido com sucesso!");
    } else {
        toast.error(result.error || "Falha ao remover o robô.");
    }
  };

  const delRobot = (robot: Robot) => {
      setConfirmationDialog({
          open: true,
          title: `Deletar Robô "${robot.name}"`,
          description: `Tem certeza que deseja deletar o robô "${robot.name}"? Esta ação não pode ser desfeita.`,
          action: () => confirmDelete(robot.id),
      });
  };
  
  const renderRobotImage = (robot: Robot, color: string) => {
    if (robot?.image)
      return (
        <img
          src={robot.image}
          alt={robot.name}
          className={`object-contain w-full h-full`}
        />
      );

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
      {/* Modal de Confirmação para Deletar */}
      <CustomAlertDialog
          open={confirmationDialog.open}
          title={confirmationDialog.title}
          description={confirmationDialog.description}
          action={confirmationDialog.action}
          onClose={() => setConfirmationDialog({ ...confirmationDialog, open: false })}
      />
      
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div><label className="sub block mb-1">Nome</label>
          <input className={`${inputStyle} w-60`} value={name} onChange={e=>setName(e.target.value)} /></div>
        <div><label className="sub block mb-1">Equipe</label>
          <input className={`${inputStyle} w-60`} value={team} onChange={e=>setTeam(e.target.value)} /></div>
        
        {/* NOVO CAMPO DE UPLOAD DE ARQUIVO (Cadastro) */}
        <div className="w-96">
            <label className="sub block mb-1">Imagem do Robô (Upload ou URL)</label>
            <div className="flex items-center gap-2">
                <input 
                    type="file" 
                    accept="image/*" 
                    onChange={(e) => handleFileUpload(e, setImage, setFileName)} 
                    className="hidden" 
                    id="file-upload"
                    // Desabilita o upload se for uma URL para evitar confusão.
                    disabled={image.length > 0 && !image.startsWith('data:')}
                />
                <label 
                    htmlFor="file-upload" 
                    className={`cursor-pointer px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition flex items-center justify-center gap-2
                        ${fileName || (image.length > 0 && image.startsWith('data:')) ? 'text-green-400 border-green-400/30' : ''} 
                        ${image.length > 0 && !image.startsWith('data:') ? 'opacity-50 cursor-not-allowed' : ''}`
                    }
                >
                    <Upload size={18} />
                    {fileName || (image.length > 0 && image.startsWith('data:')) ? 
                        `Arquivo: ${fileName || 'Em Base64 (' + Math.ceil(image.length/1024) + 'KB)'}` :
                        "Upload da Imagem (máx: 1MB)"
                    }
                </label>
            </div>
            {/* Campo para inserir URL (se não for Base64) */}
            <input 
                type="text"
                className={`${inputStyle} w-full mt-2`} 
                value={image.startsWith('data:') ? '' : image} // Exibe a URL se não for Base64
                onChange={e => { setImage(e.target.value); setFileName(''); }}
                placeholder="Ou cole a URL da imagem aqui"
                disabled={!!fileName} // Desabilita se um arquivo foi carregado
            />
        </div>
        {/* FIM DO NOVO CAMPO DE CADASTRO */}
        
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
              
              {/* BOTÃO DE EDITAR DISCRETO (Ícone) */}
              <button
                onClick={() => openEdit(r)}
                className="ml-auto p-2 text-yellow-400/80 hover:bg-white/10 rounded-lg transition"
              >
                <Edit3 size={18} />
              </button>
              
              {/* BOTÃO DE DELETAR DISCRETO (Ícone) */}
              <button 
                  className="p-2 text-red-400/80 hover:bg-white/10 rounded-lg transition" 
                  onClick={()=>delRobot(r)}>
                  <Trash2 size={18} />
              </button>

            </div>
          </motion.div>
        ))}
      </div>
      {/* === MODAL DE EDIÇÃO === */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#001933] p-8 rounded-2xl w-96 text-center shadow-2xl border border-yellow-400/30">
            <h2 className="text-2xl font-bold text-arena-accent mb-4">
              Editar Robô
            </h2>
            
            {/* CAMPO NOME COM LABEL */}
            <label className="sub block mb-1 text-white/80 text-left">Nome</label>
            <input
              type="text"
              placeholder="Nome"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className={modalInputStyle + ' mb-3'}
            />

            {/* CAMPO EQUIPE COM LABEL */}
            <label className="sub block mb-1 text-white/80 text-left">Equipe</label>
            <input
              type="text"
              placeholder="Equipe"
              value={editTeam}
              onChange={(e) => setEditTeam(e.target.value)}
              className={modalInputStyle + ' mb-3'}
            />
            
            {/* CAMPO IMAGEM/UPLOAD COM LABEL */}
            <div className="text-left w-full mb-3">
                <label className="sub block mb-1 text-white/80">Imagem do Robô (Upload ou URL)</label>
                <div className="flex items-center gap-2">
                    <input 
                        type="file" 
                        accept="image/*" 
                        onChange={(e) => handleFileUpload(e, setEditImage, setEditFileName)} 
                        className="hidden" 
                        id="edit-file-upload"
                        // Desabilita o upload se for uma URL e nenhum novo arquivo foi selecionado
                        disabled={editImage.length > 0 && !editImage.startsWith('data:')}
                    />
                    <label 
                        htmlFor="edit-file-upload" 
                        className={`cursor-pointer px-4 py-2 rounded-xl w-full bg-white/5 border border-white/10 text-white hover:bg-white/10 transition flex items-center justify-center gap-2
                            ${editFileName || (editImage.length > 0 && editImage.startsWith('data:')) ? 'text-green-400 border-green-400/30' : ''}
                            ${editImage.length > 0 && !editImage.startsWith('data:') && !editFileName ? 'opacity-50 cursor-not-allowed' : ''}`
                        }
                    >
                        <Upload size={18} />
                        {editFileName || (editImage && editImage.startsWith('data:')) ? 
                            `Arquivo: ${editFileName || 'Em Base64 (' + Math.ceil(editImage.length/1024) + 'KB)'}` :
                            "Upload da Imagem (máx: 1MB)"
                        }
                    </label>
                </div>
                {/* Campo para inserir URL (se não for Base64) */}
                <input 
                    type="text"
                    placeholder="Ou cole a URL da imagem aqui"
                    // Mostra a URL apenas se não for uma imagem em Base64
                    value={editImage && editImage.startsWith('data:') ? '' : editImage} 
                    onChange={(e) => { setEditImage(e.target.value); setEditFileName(''); }}
                    className={modalInputStyle + ' mt-2'}
                    disabled={!!editFileName} // Desabilita se um arquivo foi carregado
                />
            </div>
            {/* FIM DO CAMPO IMAGEM/UPLOAD */}

            <div className="flex justify-between mt-4">
              <button
                onClick={() => { setEditing(null); setEditFileName(""); }}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:opacity-80"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                className="px-4 py-2 btn-accent text-black font-bold rounded-lg hover:opacity-80"
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