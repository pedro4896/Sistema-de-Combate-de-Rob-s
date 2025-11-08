import React, { useEffect, useState } from "react";
import { api } from "../api";
import { onMessage } from "../ws";
import { motion } from "framer-motion";
import { Plus, Edit3, Trash2, Swords, CheckCircle, Bot, Play, X } from "lucide-react";
import toast from "react-hot-toast"; // Assumindo que você tem um provider para react-hot-toast

type Robot = { id: string; name: string; team: string; };
type Tournament = { 
  id: string; 
  name: string; 
  description?: string; 
  date?: string;
  image?: string;
  status: 'draft' | 'active' | 'finished';
  advancePerGroup: number; 
  groupCount: number; 
  participatingRobotIds?: string[];
  participatingRobots?: Robot[];
};
type ArenaState = {
    robots: Robot[];
    tournaments: Tournament[];
    tournamentId: string | null; // Torneio ativo atual
    // ... outros campos
};

// Interface para o estado do Modal de Confirmação
interface ConfirmationDialog {
    open: boolean;
    title: string;
    description: string;
    action: () => void; // Função a ser executada na confirmação
}

// Componente Simulado de AlertDialog para substituir window.confirm
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
            <div className="bg-[#001933] p-8 rounded-2xl w-full max-w-sm text-center shadow-2xl border border-red-400/30">
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

export default function Tournaments() {
  const [state, setState] = useState<ArenaState>({ robots: [], tournaments: [], tournamentId: null });
  const [newTourName, setNewTourName] = useState("");
  const [newTourDesc, setNewTourDesc] = useState("");
  const [newTourDate, setNewTourDate] = useState("");
  const [newTourImage, setNewTourImage] = useState("");
  const [newGroupCount, setNewGroupCount] = useState(2);
  const [newAdvancePerGroup, setNewAdvancePerGroup] = useState(2);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [managingRobots, setManagingRobots] = useState<Tournament | null>(null);
  const [selectedRobots, setSelectedRobots] = useState<string[]>([]);

  // NOVO ESTADO PARA GERENCIAR O MODAL DE CONFIRMAÇÃO
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialog>({
      open: false,
      title: "",
      description: "",
      action: () => {},
  });
  
  const inputStyle = "px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white";


  function refresh(s: any) { 
    setState(s);
    if (managingRobots) {
        const currentTour = s.tournaments.find((t: Tournament) => t.id === managingRobots.id);
        if (currentTour) {
             setSelectedRobots(currentTour.participatingRobotIds || []);
        }
    }
  }
  
  useEffect(() => { 
    api("/state").then((r: any) => refresh(r.state)); 
    return onMessage((m: any) => m.type === "UPDATE_STATE" && refresh(m.payload.state)); 
  }, []);

  const handleCreateTournament = async () => {
    if (!newTourName.trim()) return toast.error("O nome é obrigatório!", { duration: 3000 });

    setLoading(true);
    const result = await api("/tournaments", {
      method: "POST",
      body: {
        name: newTourName,
        description: newTourDesc.trim() || null,
        date: newTourDate.trim() || null,
        image: newTourImage.trim() || null,
        groupCount: newGroupCount,
        advancePerGroup: newAdvancePerGroup,
      },
    });

    if (result.ok) {
      toast.success("Torneio Criado com Sucesso", { duration: 3000 });
      setNewTourName("");
      setNewTourDesc("");
      setNewTourDate("");
      setNewTourImage("");
    } else {
      toast.error(result.error || "Falha ao criar o torneio.", { duration: 3000 });
    }
    setLoading(false);
  };
  
  const handleUpdateTournament = async () => {
      if (!editing || !editing.id) return;
      
      const result = await api(`/tournaments/${editing.id}`, {
        method: "PUT",
        body: {
          name: editing.name,
          description: editing.description?.trim() || null,
          date: editing.date?.trim() || null,
          image: editing.image?.trim() || null,
          groupCount: editing.groupCount,
          advancePerGroup: editing.advancePerGroup,
        },
      });

      if (result.ok) {
        toast.success(`Torneio "${editing.name}" atualizado!`, { duration: 3000 });
        setEditing(null);
      } else {
        toast.error(result.error || "Falha ao atualizar o torneio.", { duration: 3000 });
      }
  };

  // Funções que agora usam o modal de confirmação
  const handleDeleteTournament = (id: string, name: string) => {
    setConfirmationDialog({
        open: true,
        title: `Deletar Torneio "${name}"`,
        description: `Esta ação não pode ser desfeita. Todas as partidas de "${name}" serão excluídas. Confirma?`,
        action: async () => {
             const result = await api(`/tournaments/${id}`, { method: "DELETE" });
             if (result.ok) {
                 toast.success(result.message, { duration: 3000 });
             } else {
                 toast.error(result.error || "Falha ao deletar o torneio.", { duration: 3000 });
             }
        }
    });
  };
  
  const handleActivateTournament = (id: string, name: string) => {
    const currentTour = state.tournaments.find(t => t.id === id);
    if (!currentTour || (currentTour.participatingRobots?.length || 0) < 2) {
        toast.error("O torneio precisa de no mínimo 2 robôs para gerar o chaveamento. Use o botão Gerenciar Robôs.", { duration: 3000 });
        return;
    }
    
    setConfirmationDialog({
        open: true,
        title: `Ativar Torneio "${name}"`,
        description: `Isto irá gerar o chaveamento e definir "${name}" como o torneio ATIVO. Você poderá continuar a edição das regras na página de chaveamento. Confirma a ativação?`,
        action: async () => {
            const result = await api(`/tournaments/${id}/activate`, { method: "POST" });
            if (result.ok) {
                toast.success(result.message, { duration: 3000 });
            } else {
                toast.error(result.error || "Falha ao ativar/gerar o chaveamento.", { duration: 3000 });
            }
        }
    });
  };

  const handleFinalizeTournament = (id: string, name: string) => {
    setConfirmationDialog({
        open: true,
        title: `Finalizar Torneio "${name}"`,
        description: `Isto irá mudar o status de "${name}" para FINALIZADO e desativá-lo. Confirma?`,
        action: async () => {
            const result = await api(`/tournaments/${id}/finalize`, { method: "POST" });
            if (result.ok) {
                toast.success(result.message, { duration: 3000 });
            } else {
                toast.error(result.error || "Falha ao finalizar o torneio.", { duration: 3000 });
            }
        }
    });
  };

  // --- Lógica de Gerenciamento de Robôs ---
  const openRobotManager = (tournament: Tournament) => {
    if (tournament.status !== 'draft') {
        toast.error("Apenas torneios em status 'draft' podem ter os robôs gerenciados.", { duration: 3000 });
        return;
    }
    setManagingRobots(tournament);
    setSelectedRobots(tournament.participatingRobotIds || []);
  };
  
  const toggleRobotSelection = (robotId: string) => {
    setSelectedRobots(prev => 
      prev.includes(robotId) 
        ? prev.filter(id => id !== robotId) 
        : [...prev, robotId]
    );
  };
  
  const selectAllRobots = () => {
    setSelectedRobots(state.robots.map(r => r.id));
  };
  
  const deselectAllRobots = () => {
    setSelectedRobots([]);
  };

  const saveRobots = async () => {
    if (!managingRobots) return;
    
    if (managingRobots.status !== 'draft') {
        toast.error("Erro: O torneio não está mais em status 'draft'.", { duration: 3000 });
        return;
    }

    const result = await api(`/tournaments/${managingRobots.id}/set-robots`, {
        method: "POST",
        body: { robotIds: selectedRobots }
    });

    if (result.ok) {
        toast.success(result.message, { duration: 3000 });
        setManagingRobots(null);
        setSelectedRobots([]);
    } else {
        toast.error(result.error || "Falha ao salvar a lista de robôs.", { duration: 3000 });
    }
  };


  return (
    <div className="p-8">
      <h1 className="text-3xl font-extrabold flex items-center gap-3 text-arena-accent mb-6">
        <Swords /> Gerenciamento de Torneios
      </h1>
      <hr className="mb-8 border-white/20" />

      {/* MODAL DE CONFIRMAÇÃO REUTILIZÁVEL (Substitui window.confirm) */}
      <CustomAlertDialog
          open={confirmationDialog.open}
          title={confirmationDialog.title}
          description={confirmationDialog.description}
          action={confirmationDialog.action}
          onClose={() => setConfirmationDialog({ ...confirmationDialog, open: false })}
      />

      {/* ---------- FORMULÁRIO DE CRIAÇÃO ---------- */}
      <div className="bg-white/10 p-6 rounded-2xl shadow-xl mb-10">
        <h2 className="text-xl font-bold mb-4">Cadastrar Novo Torneio</h2>
        <div className="flex flex-wrap gap-4 items-end">
          
          {/* Input Nome */}
          <div>
            <label className="sub block mb-1">Nome</label>
            <input
              className={`${inputStyle} w-60`}
              placeholder="Nome do Torneio"
              value={newTourName}
              onChange={(e) => setNewTourName(e.target.value)}
            />
          </div>

          {/* Input Descrição */}
          <div>
            <label className="sub block mb-1">Descrição</label>
            <input
              className={`${inputStyle} w-full md:w-80`}
              placeholder="Descrição (Opcional)"
              value={newTourDesc}
              onChange={(e) => setNewTourDesc(e.target.value)}
            />
          </div>

          {/* Input Data */}
          <div>
            <label className="sub block mb-1">Data</label>
            <input
              className={`${inputStyle} w-40`}
              placeholder="Data (AAAA-MM-DD)"
              value={newTourDate}
              onChange={(e) => setNewTourDate(e.target.value)}
            />
          </div>

          {/* Input Imagem URL */}
          <div>
            <label className="sub block mb-1">URL da Imagem</label>
            <input
              className={`${inputStyle} w-80`}
              placeholder="URL da Imagem (Opcional)"
              value={newTourImage}
              onChange={(e) => setNewTourImage(e.target.value)}
            />
          </div>

          {/* Input Qtd. Grupos */}
          <div>
            <label className="sub block mb-1">Qtd. Grupos</label>
            <input
              type="number"
              min="1"
              className={`${inputStyle} w-36`}
              placeholder="2"
              value={newGroupCount}
              onChange={(e) => setNewGroupCount(Number(e.target.value))}
            />
          </div>

          {/* Input Classificados */}
           <div>
            <label className="sub block mb-1">Classificados</label>
            <input
              type="number"
              min="1"
              className={`${inputStyle} w-36`}
              placeholder="2"
              value={newAdvancePerGroup}
              onChange={(e) => setNewAdvancePerGroup(Number(e.target.value))}
            />
          </div>

          <button className="btn btn-accent flex items-center gap-2" onClick={handleCreateTournament} disabled={loading || !newTourName.trim()}>
            <Plus size={18} />
            {loading ? "Criando..." : "Criar Torneio"}
          </button>
        </div>
      </div>

      {/* ---------- LISTA DE TORNEIOS ---------- */}
      <h2 className="text-2xl font-bold mb-4 text-white">Torneios Cadastrados</h2>
      <div className="space-y-4">
        {state.tournaments.map((tour) => (
          <motion.div 
            key={tour.id} 
            className={`p-4 rounded-xl shadow-lg border flex items-start justify-between ${tour.status === 'active' ? 'bg-green-700/30 border-green-400' : tour.status === 'finished' ? 'bg-gray-700/50 border-gray-500' : 'bg-white/10 border-white/20'}`} 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.3 }}
          >
            {/* IMAGEM DO TORNEIO */}
            <div className="w-24 h-24 mr-4 flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center bg-black/40">
                {tour.image ? (
                    <img 
                        src={tour.image} 
                        alt={`Imagem do Torneio ${tour.name}`} 
                        className="object-cover w-full h-full" 
                    />
                ) : (
                    <Swords size={40} className="text-white/50" />
                )}
            </div>

            {/* Detalhes do Torneio */}
            <div className="flex-grow">
              <div className={`text-xl font-bold flex items-center gap-2 ${tour.status === 'active' ? 'text-green-300' : 'text-white'}`}>
                  {tour.name}
                  {tour.status === 'active' && <span className="text-sm font-normal bg-green-500 text-black px-2 py-0.5 rounded">ATIVO</span>}
                  {tour.status === 'finished' && <span className="text-sm font-normal bg-gray-500 text-black px-2 py-0.5 rounded">FINALIZADO</span>}
                  {tour.status === 'draft' && <span className="text-sm font-normal bg-yellow-500 text-black px-2 py-0.5 rounded">DRAFT</span>}
              </div>
              <p className="text-sm text-white/70 mt-1">{tour.description || "Sem descrição."}</p>
              {/* DATA DO TORNEIO */}
              <p className="text-xs text-white/60 mt-1">
                  Data: {tour.date || "N/A"}
              </p>
              <p className="text-xs text-white/50 mt-1">
                  Participantes: {tour.participatingRobots?.length || 0} Robôs | Grupos: {tour.groupCount}, Classificados: {tour.advancePerGroup}
              </p>
            </div>
            
            {/* Botões de Ação */}
            <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2 mt-3 md:mt-0 items-center justify-end flex-shrink-0 ml-4">
              
              {/* Botão Gerenciar Robôs */}
              <button 
                  title="Gerenciar Robôs"
                  onClick={() => openRobotManager(tour)}
                  disabled={tour.status !== 'draft'}
                  className={`p-2 rounded-lg transition text-white ${tour.status === 'draft' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-500 cursor-not-allowed'}`}
              >
                  <Bot size={18} />
              </button>
              
              {/* Botão Editar (Apenas Draft) */}
              <button 
                  title="Editar Detalhes"
                  onClick={() => setEditing(tour)}
                  disabled={tour.status !== 'draft'}
                  className={`p-2 rounded-lg transition text-black ${tour.status === 'draft' ? 'bg-yellow-400 hover:bg-yellow-300' : 'bg-gray-500 cursor-not-allowed'}`}
              >
                  <Edit3 size={18} />
              </button>

              {/* Botão Ativar/Gerar Chaveamento (Apenas Draft) */}
              {tour.status === 'draft' && (
                  <button
                      title="Ativar e Gerar Chaveamento"
                      onClick={() => handleActivateTournament(tour.id, tour.name)}
                      className="p-2 rounded-lg bg-green-600 hover:bg-green-500 transition text-white"
                      disabled={(tour.participatingRobots?.length || 0) < 2}
                  >
                      <Play size={18} />
                  </button>
              )}
              
              {/* Botão Finalizar (Apenas Active) */}
              {tour.status === 'active' && (
                  <button
                      title="Finalizar Torneio"
                      onClick={() => handleFinalizeTournament(tour.id, tour.name)}
                      className="p-2 rounded-lg bg-red-600 hover:bg-red-500 transition text-white"
                  >
                      <CheckCircle size={18} />
                  </button>
              )}
              
              {/* Botão Deletar (Se não for ativo) */}
              {tour.status !== 'active' && (
                  <button 
                      title="Deletar Torneio"
                      onClick={() => handleDeleteTournament(tour.id, tour.name)}
                      className="p-2 rounded-lg bg-red-800 hover:bg-red-700 transition text-white"
                  >
                      <Trash2 size={18} />
                  </button>
              )}
            </div>
          </motion.div>
        ))}
        {state.tournaments.length === 0 && (
            <p className="text-white/50 text-center py-4">Nenhum torneio encontrado.</p>
        )}
      </div>

      {/* === MODAL DE EDIÇÃO DE DETALHES === */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#001933] p-8 rounded-2xl w-full max-w-lg text-center shadow-2xl border border-yellow-400/30">
            <h2 className="text-2xl font-bold text-yellow-400 mb-4">
              Editar {editing.name} (Draft)
            </h2>
            <input
              type="text"
              placeholder="Nome"
              value={editing.name}
              onChange={(e) => setEditing({...editing, name: e.target.value})}
              className={`w-full ${inputStyle} mb-3`}
            />
            {/* Textarea com estilo de input */}
            <textarea
              placeholder="Descrição"
              value={editing.description || ""}
              onChange={(e) => setEditing({...editing, description: e.target.value})}
              className={`w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white mb-3`}
              rows={3}
            />
            <input
              type="text"
              placeholder="Data"
              value={editing.date || ""}
              onChange={(e) => setEditing({...editing, date: e.target.value})}
              className={`w-full ${inputStyle} mb-3`}
            />
             <input
              type="text"
              placeholder="URL da Imagem"
              value={editing.image || ""}
              onChange={(e) => setEditing({...editing, image: e.target.value})}
              className={`w-full ${inputStyle} mb-3`}
            />
            <div className="flex gap-4 mb-4">
              <input
                  type="number"
                  min="1"
                  placeholder="Qtd. Grupos"
                  value={editing.groupCount}
                  onChange={(e) => setEditing({...editing, groupCount: Number(e.target.value)})}
                  className={`w-full ${inputStyle}`}
                />
              <input
                type="number"
                min="1"
                placeholder="Classificados"
                value={editing.advancePerGroup}
                onChange={(e) => setEditing({...editing, advancePerGroup: Number(e.target.value)})}
                className={`w-full ${inputStyle}`}
              />
            </div>
            <div className="flex justify-between mt-4">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:opacity-80"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpdateTournament}
                className="px-4 py-2 bg-yellow-400 text-black font-bold rounded-lg hover:opacity-80"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL DE GERENCIAMENTO DE ROBÔS === */}
      {managingRobots && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#001933] p-8 rounded-2xl w-full max-w-lg shadow-2xl border border-indigo-400/30">
            <h2 className="text-2xl font-bold text-indigo-400 mb-4">
              Robôs para "{managingRobots.name}"
            </h2>
            <div className="flex justify-start space-x-3 mb-3">
                 <button onClick={selectAllRobots} className="text-xs bg-indigo-500/50 hover:bg-indigo-500/70 p-1 rounded">Selecionar Todos</button>
                 <button onClick={deselectAllRobots} className="text-xs bg-gray-500/50 hover:bg-gray-500/70 p-1 rounded">Limpar Seleção</button>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2 bg-black/10 p-3 rounded">
                {state.robots.map(robot => (
                    <div 
                        key={robot.id} 
                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition ${selectedRobots.includes(robot.id) ? 'bg-indigo-600/50' : 'bg-white/5 hover:bg-white/10'}`}
                        onClick={() => toggleRobotSelection(robot.id)}
                    >
                        <span>{robot.name} ({robot.team || 'S/E'})</span>
                        {selectedRobots.includes(robot.id) ? 
                            <CheckCircle size={18} className="text-green-400" /> : 
                            <Plus size={18} className="text-gray-400" />
                        }
                    </div>
                ))}
                {state.robots.length === 0 && <p className="text-center text-white/50">Nenhum robô cadastrado globalmente.</p>}
            </div>
            <p className="text-sm text-white/70 mt-3">Total selecionado: {selectedRobots.length}</p>

            <div className="flex justify-between mt-4">
              <button
                onClick={() => { setManagingRobots(null); setSelectedRobots([]); }}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:opacity-80"
              >
                Cancelar
              </button>
              <button
                onClick={saveRobots}
                disabled={selectedRobots.length < 2}
                className={`px-4 py-2 text-black font-bold rounded-lg transition ${selectedRobots.length < 2 ? 'bg-gray-500 cursor-not-allowed' : 'bg-indigo-400 hover:bg-indigo-300'}`}
              >
                Salvar Participantes ({selectedRobots.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}