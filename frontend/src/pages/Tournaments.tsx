import React, { useEffect, useState } from "react";
import { api } from "../api"; // Assumindo que o arquivo '../api.ts' foi atualizado com as novas funções
import { onMessage } from "../ws";
import { motion } from "framer-motion";
import { Plus, Edit3, Trash2, Swords, CheckCircle, Bot, Play, X, Upload } from "lucide-react";
import toast from "react-hot-toast"; 

// TIPAGEM ATUALIZADA
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
  repechageRobotIds?: string[];
  repechageWinner?: Robot | null;
  repechageAdvanceCount: number; 
  useRepechage: boolean; // ADICIONADO: Flag para indicar o uso de repescagem
};
type ArenaState = {
    robots: Robot[];
    tournaments: Tournament[];
    tournamentId: string | null; 
    matches: any[];
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
  const [state, setState] = useState<ArenaState>({ robots: [], tournaments: [], tournamentId: null, matches: [] });
  const [newTourName, setNewTourName] = useState("");
  const [newTourDesc, setNewTourDesc] = useState("");
  const [newTourImage, setNewTourImage] = useState("");
  const [newGroupCount, setNewGroupCount] = useState(2);
  const [newAdvancePerGroup, setNewAdvancePerGroup] = useState(2);
  const [newRepechageAdvanceCount, setNewRepechageAdvanceCount] = useState(1);
  const [newUseRepechage, setNewUseRepechage] = useState(true); // NOVO ESTADO: Ativado por padrão
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [editImage, setEditImage] = useState("");
  const [newTourFileName, setNewTourFileName] = useState("");
  const [editTourFileName, setEditTourFileName] = useState("");
  
  const [managingRobots, setManagingRobots] = useState<Tournament | null>(null);
  const [selectedRobots, setSelectedRobots] = useState<string[]>([]);
  
  // NOVO ESTADO PARA REPESCAGEM
  const [managingRepechage, setManagingRepechage] = useState<Tournament | null>(null);
  const [selectedRepechageRobots, setSelectedRepechageRobots] = useState<string[]>([]);
  // FIM NOVO ESTADO REPESCAGEM

  // NOVO ESTADO PARA GERENCIAR O MODAL DE CONFIRMAÇÃO
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialog>({
    open: false,
    title: "",
    description: "",
    action: () => {},
  });
  
  const inputStyle = "px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white";

  // NOVA FUNÇÃO: Converte arquivo para Base64 e atualiza o estado
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setTargetImage: React.Dispatch<React.SetStateAction<string>>, setTargetFileName: React.Dispatch<React.SetStateAction<string>>) => {
    const file = e.target.files?.[0];
    if (!file) {
        setTargetImage("");
        setTargetFileName("");
        return;
    }

    if (file.size > 5* 1024 * 1024) { // Limite de 5MB
        toast.error("O arquivo é muito grande (máx: 5MB).");
        e.target.value = '';
        setTargetImage("");
        setTargetFileName("");
        return;
    }
    
    setTargetFileName(file.name);
    
    const reader = new FileReader();
    reader.onloadend = () => {
        setTargetImage(reader.result as string);
    };
    reader.onerror = () => {
        toast.error("Falha ao ler o arquivo.");
        setTargetImage("");
        setTargetFileName("");
    };
    reader.readAsDataURL(file);
  };

  function refresh(s: any) { 
    setState(s);
    
    // Atualiza selectedRobots (participantes gerais) se o modal estiver aberto
    if (managingRobots) {
        const currentTour = s.tournaments.find((t: Tournament) => t.id === managingRobots.id);
        if (currentTour) {
            setSelectedRobots(currentTour.participatingRobotIds || []);
        }
    }
    
    // NOVO: Atualiza selectedRepechageRobots se o modal de repescagem estiver aberto
    if (managingRepechage) {
        const currentTour = s.tournaments.find((t: Tournament) => t.id === managingRepechage.id);
        if (currentTour) {
            setSelectedRepechageRobots(currentTour.repechageRobotIds || []);
        }
    }
  }
  
  useEffect(() => { 
    api("/state").then((r: any) => refresh(r.state)); 
    return onMessage((m: any) => m.type === "UPDATE_STATE" && refresh(m.payload.state)); 
  }, []);

  // --- HANDLERS DE TORNEIOS (CRUD e Ações Principais) ---
  const handleCreateTournament = async () => {
    if (!newTourName.trim()) return toast.error("O nome é obrigatório!", { duration: 3000 });

    setLoading(true);
    const result = await api("/tournaments", {
      method: "POST",
      body: {
        name: newTourName,
        description: newTourDesc.trim() || null,
        image: newTourImage.trim() || null,
        groupCount: newGroupCount,
        advancePerGroup: newAdvancePerGroup,
        repechageAdvanceCount: newRepechageAdvanceCount, 
        useRepechage: newUseRepechage, // NOVO: Campo adicionado
      },
    });

    if (result.ok) {
      toast.success("Torneio Criado com Sucesso", { duration: 3000 });
      setNewTourName("");
      setNewTourDesc("");
      setNewTourImage("");
      setNewTourFileName("");
      setNewGroupCount(2); 
      setNewAdvancePerGroup(2); 
      setNewRepechageAdvanceCount(1); 
      setNewUseRepechage(true); // Resetar o estado da repescagem
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
          image: editImage.trim() || null, 
          groupCount: editing.groupCount,
          advancePerGroup: editing.advancePerGroup,
          repechageAdvanceCount: editing.repechageAdvanceCount, 
          useRepechage: editing.useRepechage, // NOVO: Campo adicionado
        },
      });

      if (result.ok) {
        toast.success(`Torneio "${editing.name}" atualizado!`);
        setEditing(null);
        setEditImage("");
        setEditTourFileName("");
      } else {
        toast.error(result.error || "Falha ao atualizar o torneio.");
      }
  };

  const handleDeleteTournament = (id: string, name: string) => {
    setConfirmationDialog({
        open: true,
        title: `Deletar Torneio "${name}"`,
        description: `Esta ação não pode ser desfeita. Todas as partidas de "${name}" serão excluídas. Confirma?`,
        action: async () => {
              const result = await api(`/tournaments/${id}`, { method: "DELETE" });
              if (result.ok) {
                  toast.success(result.message);
              } else {
                  toast.error(result.error || "Falha ao deletar o torneio.");
              }
        }
    });
  };
  
  const handleActivateTournament = (id: string, name: string) => {
    const currentTour = state.tournaments.find(t => t.id === id);
    if (!currentTour || (currentTour.participatingRobots?.length || 0) < 2) {
        toast.error("O torneio precisa de no mínimo 2 robôs para gerar o chaveamento. Use o botão Gerenciar Robôs.");
        return;
    }
    
    setConfirmationDialog({
        open: true,
        title: `Ativar Torneio "${name}"`,
        description: `Isto irá gerar o chaveamento de GRUPOS e definir "${name}" como o torneio ATIVO. Confirma a ativação?`,
        action: async () => {
            const result = await api(`/tournaments/${id}/activate`, { method: "POST" });
            if (result.ok) {
                toast.success(result.message);
            } else {
                toast.error(result.error || "Falha ao ativar/gerar o chaveamento.");
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
                toast.success(result.message);
            } else {
                toast.error(result.error || "Falha ao finalizar o torneio.");
            }
        }
    });
  };

  // --- Lógica de Gerenciamento de Robôs (Participantes Gerais) ---
  const openRobotManager = (tournament: Tournament) => {
    if (tournament.status !== 'draft') {
        toast.error("Apenas torneios em status 'draft' podem ter os robôs gerenciados.");
        return;
    }
    setManagingRobots(tournament);
    setSelectedRobots(tournament.participatingRobotIds || []);
  };
  
  const openEdit = (tournament: Tournament) => {
    setEditing(tournament);
    setEditImage(tournament.image || "");
    setEditTourFileName("");
    // NOVO: Garantir que o campo seja preenchido no estado de edição
    setEditing(prev => ({ 
        ...prev!, 
        repechageAdvanceCount: tournament.repechageAdvanceCount || 1, // Inicializa com o valor atual ou 1
        useRepechage: tournament.useRepechage ?? true, // NOVO: Inicializa o useRepechage com o valor atual ou true como fallback
    }));
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
        toast.error("Erro: O torneio não está mais em status 'draft'.");
        return;
    }

    const result = await api(`/tournaments/${managingRobots.id}/set-robots`, {
        method: "POST",
        body: { robotIds: selectedRobots }
    });

    if (result.ok) {
        toast.success(result.message);
        setManagingRobots(null);
        setSelectedRobots([]);
    } else {
        toast.error(result.error || "Falha ao salvar a lista de robôs.");
    }
  };

  // --- LÓGICA DE GERENCIAMENTO DE REPESCAGEM (NOVAS FUNÇÕES) ---
  
  const openRepechageManager = (tournament: Tournament) => {
      // Verifica se a repescagem está ativa para este torneio
      if (!tournament.useRepechage) {
          toast.error(`A repescagem está desativada para o torneio "${tournament.name}". Ative-a nas opções de edição para gerenciá-la.`);
          return;
      }
      setManagingRepechage(tournament);
      // Carrega os robôs de repescagem existentes no estado local do modal
      setSelectedRepechageRobots(tournament.repechageRobotIds || []);
  };

  const closeRepechageManager = () => {
    setManagingRepechage(null);
    setSelectedRepechageRobots([]);
  };

  const toggleRepechageRobotSelection = (robotId: string) => {
      setSelectedRepechageRobots(prev => 
          prev.includes(robotId) 
              ? prev.filter(id => id !== robotId) 
              : [...prev, robotId]
      );
  };
    
  const saveRepechageRobots = async () => {
      if (!managingRepechage) return;
      
      setLoading(true);
      const result = await api(`/tournaments/${managingRepechage.id}/set-repechage-robots`, {
          method: "POST",
          body: { robotIds: selectedRepechageRobots }
      });
      setLoading(false);

      if (result.ok) {
          toast.success(result.message);
          // Não fecha o modal, apenas salva a lista
      } else {
          toast.error(result.error || "Falha ao salvar a lista de repescagem.");
      }
  };
    
  const generateRepechage = (id: string, name: string) => {
      const currentTour = state.tournaments.find(t => t.id === id);
      
      if (!currentTour || (currentTour.repechageRobotIds?.length || 0) < 2) {
          toast.error("Selecione e salve pelo menos 2 robôs para a repescagem antes de gerar o chaveamento.");
          return;
      }
      
      if (!currentTour.useRepechage) {
          toast.error("A repescagem está desativada neste torneio.");
          return;
      }
      
      const repechageMatchesExist = state.matches.some(m => m.tournamentId === id && m.phase === 'repechage');
      if (repechageMatchesExist) {
          toast.error("O chaveamento da repescagem já foi gerado. Finalize as partidas existentes.");
          return;
      }

      setConfirmationDialog({
          open: true,
          title: `Gerar Repescagem para "${name}"`,
          description: `Isso irá gerar as partidas de Round-Robin para os ${currentTour.repechageRobotIds?.length} robôs selecionados. A Fase de Grupos deve estar completa. Confirma?`,
          action: async () => {
              const result = await api(`/tournaments/${id}/generate-repechage`, { method: "POST" });
              if (result.ok) {
                  toast.success(result.message);
                  closeRepechageManager();
              } else {
                  toast.error(result.error || "Falha ao gerar o chaveamento da repescagem.");
              }
          }
      });
  };
  // --- FIM LÓGICA DE REPESCAGEM ---


  return (
    <div className="p-8">
      <h1 className="text-3xl font-extrabold flex items-center gap-3 text-arena-accent mb-6">
        <Swords /> Gerenciamento de Torneios
      </h1>
      <hr className="mb-8 border-white/20" />

      {/* MODAL DE CONFIRMAÇÃO REUTILIZÁVEL */}
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

          {/* Input Imagem URL/Upload */}
          <div className="w-96">
            <label className="sub block mb-1">Imagem do Torneio (Upload ou URL, máx: 5MB)</label>
            <div className="flex items-center gap-2">
                <input 
                    type="file" 
                    accept="image/*" 
                    onChange={(e) => handleFileUpload(e, setNewTourImage, setNewTourFileName)} 
                    className="hidden" 
                    id="new-tour-file-upload"
                    disabled={newTourImage.length > 0 && !newTourImage.startsWith('data:')}
                />
                <label 
                    htmlFor="new-tour-file-upload" 
                    className={`cursor-pointer px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition flex items-center justify-center gap-2 flex-grow 
                        ${newTourFileName || (newTourImage.length > 0 && newTourImage.startsWith('data:')) ? 'text-green-400 border-green-400/30' : ''} 
                        ${newTourImage.length > 0 && !newTourImage.startsWith('data:') ? 'opacity-50 cursor-not-allowed' : ''}`
                    }
                >
                    <Upload size={18} />
                    {newTourFileName || (newTourImage.length > 0 && newTourImage.startsWith('data:')) ? 
                        `Arquivo: ${newTourFileName || 'Base64 (' + Math.ceil(newTourImage.length/1024) + 'KB)'}` :
                        "Upload da Imagem (máx: 5MB)"
                    }
                </label>
            </div>
            <input 
                type="text"
                className={`${inputStyle} w-full mt-2`} 
                value={newTourImage.startsWith('data:') ? '' : newTourImage} 
                onChange={e => { setNewTourImage(e.target.value); setNewTourFileName(''); }}
                placeholder="Ou cole a URL da imagem aqui"
                disabled={!!newTourFileName} 
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

          {/* Input Classificados (Grupos) */}
            <div>
            <label className="sub block mb-1">Classificados (Grupos)</label>
            <input
              type="number"
              min="1"
              className={`${inputStyle} w-36`}
              placeholder="2"
              value={newAdvancePerGroup}
              onChange={(e) => setNewAdvancePerGroup(Number(e.target.value))}
            />
            </div>
            
          {/* NOVO: Input Classificados (Repescagem) */}
          <div>
            <label className="sub block mb-1">Classificados (Repescagem)</label>
            <input
              type="number"
              min="1"
              className={`${inputStyle} w-48`}
              placeholder="1"
              value={newRepechageAdvanceCount}
              onChange={(e) => setNewRepechageAdvanceCount(Number(e.target.value))}
              disabled={!newUseRepechage} // Desabilita se não for usar repescagem
            />
          </div>
          
          {/* NOVO: Checkbox Usar Repescagem */}
          <div className="flex items-center pt-5">
              <label className="sub block text-white/80 flex items-center gap-2 cursor-pointer">
                  <input
                      type="checkbox"
                      checked={newUseRepechage}
                      onChange={(e) => setNewUseRepechage(e.target.checked)}
                      className="form-checkbox h-5 w-5 text-purple-600 rounded"
                  />
                  Utilizar Repescagem
              </label>
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
              {/* DATA DE REGISTRO */}
              <p className="text-xs text-white/60 mt-1">
                  Criado em: {tour.date || "N/A"}
              </p>
              <p className="text-xs text-white/50 mt-1">
                  Participantes: {tour.participatingRobots?.length || 0} Robôs | Grupos: {tour.groupCount}, Classificados: {tour.advancePerGroup} (Grupos)
                  {tour.useRepechage && 
                      <>, Repescagem: <strong className="text-purple-300">ATIVA ({tour.repechageAdvanceCount} classificados)</strong></>
                  }
                  {!tour.useRepechage && 
                      <>, Repescagem: <strong className="text-gray-400">DESATIVADA</strong></>
                  }
              </p>
            </div>
            
            {/* Botões de Ação */}
            <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2 mt-3 md:mt-0 items-center justify-end flex-shrink-0 ml-4">
              
              {/* Botão Gerenciar Robôs (Participantes Gerais - Apenas Draft) */}
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
                  onClick={() => openEdit(tour)}
                  disabled={tour.status !== 'draft'}
                  className={`p-2 rounded-lg transition text-yellow-400/80 hover:bg-white/10 ${tour.status !== 'draft' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                  <Edit3 size={18} />
              </button>

              {/* Botão Gerenciar Repescagem (NOVO) */}
              {tour.useRepechage && (tour.status === 'draft' || tour.status === 'active') && (tour.participatingRobots?.length || 0) > 0 && (
                  <button
                      title="Gerenciar Repescagem"
                      onClick={() => openRepechageManager(tour)}
                      className="p-2 rounded-lg bg-purple-600 hover:bg-purple-500 transition text-white"
                  >
                      <Swords size={18} />
                  </button>
              )}

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

            {/* CAMPO NOME COM LABEL */}
            <label className="sub block mb-1 text-white/80 text-left">Nome</label>
            <input
              type="text"
              placeholder="Nome"
              value={editing.name}
              onChange={(e) => setEditing({...editing, name: e.target.value})}
              className={`w-full ${inputStyle} mb-3`}
            />

            {/* CAMPO DESCRIÇÃO COM LABEL */}
            <label className="sub block mb-1 text-white/80 text-left">Descrição</label>
            <textarea
              placeholder="Descrição"
              value={editing.description || ""}
              onChange={(e) => setEditing({...editing, description: e.target.value})}
              className={`w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white mb-3`}
              rows={3}
            />

            {/* CAMPO IMAGEM/UPLOAD COM LABEL */}
            <div className="text-left w-full mb-3">
                <label className="sub block mb-1 text-white/80">Imagem do Robô (Upload ou URL, máx: 5MB)</label>
                <div className="flex items-center gap-2">
                    <input 
                        type="file" 
                        accept="image/*" 
                        onChange={(e) => handleFileUpload(e, setEditImage, setEditTourFileName)} 
                        className="hidden" 
                        id="edit-tour-file-upload"
                        disabled={editImage.length > 0 && !editImage.startsWith('data:')}
                    />
                    <label 
                        htmlFor="edit-tour-file-upload" 
                        className={`cursor-pointer px-4 py-2 rounded-xl w-full bg-white/5 border border-white/10 text-white hover:bg-white/10 transition flex items-center justify-center gap-2 flex-grow 
                            ${editTourFileName || (editImage && editImage.startsWith('data:')) ? 'text-green-400 border-green-400/30' : ''}
                            ${editImage.length > 0 && !editImage.startsWith('data:') && !editTourFileName ? 'opacity-50 cursor-not-allowed' : ''}`
                        }
                    >
                        <Upload size={18} />
                        {editTourFileName || (editImage && editImage.startsWith('data:')) ? 
                            `Arquivo: ${editTourFileName || 'Base64 (' + Math.ceil(editImage.length/1024) + 'KB)'}` :
                            "Upload da Imagem (máx: 5MB)"
                        }
                    </label>
                </div>
                {/* Campo para inserir URL (se não for Base64) */}
                <input 
                    type="text"
                    placeholder="Ou cole a URL da imagem aqui"
                    value={editImage && editImage.startsWith('data:') ? '' : editImage} 
                    onChange={(e) => { setEditImage(e.target.value); setEditTourFileName(''); }}
                    className={inputStyle + ' w-full mt-2'}
                    disabled={!!editTourFileName} 
                />
            </div>
            
            {/* CAMPOS GRUPO E CLASSIFICADOS COM LABELS */}
            <div className="flex gap-4 mb-4">
              <div className="flex-1">
                <label className="sub block mb-1 text-white/80 text-left">Qtd. Grupos</label>
                <input
                    type="number"
                    min="1"
                    placeholder="Qtd. Grupos"
                    value={editing.groupCount}
                    onChange={(e) => setEditing({...editing, groupCount: Number(e.target.value)})}
                    className={`${inputStyle} w-full`}
                />
              </div>
              <div className="flex-1">
                <label className="sub block mb-1 text-white/80 text-left">Classificados por Grupo</label>
                <input
                    type="number"
                    min="1"
                    placeholder="Classificados"
                    value={editing.advancePerGroup}
                    onChange={(e) => setEditing({...editing, advancePerGroup: Number(e.target.value)})}
                    className={`${inputStyle} w-full`}
                />
              </div>
            </div>

            {/* NOVO: CAMPO CLASSIFICADOS REPESCAGEM COM LABEL */}
            <div className="mb-4">
              <label className="sub block mb-1 text-white/80 text-left">Classificados da Repescagem</label>
              <input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={editing.repechageAdvanceCount}
                  onChange={(e) => setEditing({...editing, repechageAdvanceCount: Number(e.target.value)})}
                  className={`${inputStyle} w-full`}
                  disabled={!editing.useRepechage} // Desabilita se não for usar repescagem
              />
            </div>

            {/* NOVO: Checkbox Utilizar Repescagem */}
            <div className="mb-4 text-left">
                <label className="sub block mb-1 text-white/80 text-left flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={editing.useRepechage}
                        onChange={(e) => setEditing({...editing, useRepechage: e.target.checked})}
                        className="form-checkbox h-5 w-5 text-purple-600 rounded"
                    />
                    Utilizar Repescagem
                </label>
            </div>
            
            <div className="flex justify-between mt-4">
              <button
                onClick={() => { setEditing(null); setEditImage(editing.image || ""); setEditTourFileName(""); }}
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

      {/* === MODAL DE GERENCIAMENTO DE ROBÔS (Participantes Gerais) === */}
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

      {/* === MODAL DE GERENCIAMENTO DE REPESCAGEM === */}
      {managingRepechage && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#001933] p-8 rounded-2xl w-full max-w-lg shadow-2xl border border-purple-400/30">
            <h2 className="text-2xl font-bold text-purple-400 mb-4">
              Repescagem para "{managingRepechage.name}"
            </h2>

            <div className="space-y-6">
                
              {/* SEÇÃO 1: SELEÇÃO DE ROBÔS */}
              <div>
                  <h3 className="text-lg font-bold text-white mb-2 text-left">1. Selecionar Participantes</h3>
                  <p className="text-sm text-white/70 mb-3 text-left">
                      Escolha os robôs que competirão nesta fase eliminatória adicional (mínimo 2). 
                      A lista exibe apenas robôs <strong>selecionados para o torneio principal</strong>.
                      <span className="font-bold text-yellow-300 block mt-1">ATENÇÃO: Selecione APENAS os robôs ELIMINADOS na Fase de Grupos.</span>
                  </p>
                  
                  {/* Botões de Ação do Modal */}
                  <div className="flex justify-start space-x-3 mb-3">
                      <button 
                        onClick={() => setSelectedRepechageRobots(managingRepechage.participatingRobotIds || [])} 
                        className="text-xs bg-purple-500/50 hover:bg-purple-500/70 p-1 rounded">
                          Selecionar Todos (Participantes)
                      </button>
                      <button 
                        onClick={() => setSelectedRepechageRobots([])} 
                        className="text-xs bg-gray-500/50 hover:bg-gray-500/70 p-1 rounded">
                          Limpar Seleção
                      </button>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-2 bg-black/10 p-3 rounded">
                      {/* FILTRO: Lista todos os participantes do torneio principal */}
                      {state.robots
                          .filter(r => managingRepechage.participatingRobotIds?.includes(r.id))
                          .map(robot => (
                          <div 
                              key={robot.id} 
                              className={`flex items-center justify-between p-2 rounded cursor-pointer transition ${selectedRepechageRobots.includes(robot.id) ? 'bg-purple-600/50' : 'bg-white/5 hover:bg-white/10'}`}
                              onClick={() => toggleRepechageRobotSelection(robot.id)}
                          >
                              <span>{robot.name} ({robot.team || 'S/E'})</span>
                              {selectedRepechageRobots.includes(robot.id) ? 
                                  <CheckCircle size={18} className="text-green-400" /> : 
                                  <Plus size={18} className="text-gray-400" />
                              }
                          </div>
                      ))}
                      {(managingRepechage.participatingRobots?.length || 0) === 0 && 
                          <p className="text-center text-white/50">Nenhum robô foi adicionado ao torneio principal.</p>
                      }
                  </div>
                  
                  <p className="text-sm text-white/70 mt-3">Robôs na Repescagem: {selectedRepechageRobots.length}</p>
                  
                  <button
                      onClick={saveRepechageRobots}
                      className={`w-full mt-3 px-4 py-2 text-black font-bold rounded-lg transition ${selectedRepechageRobots.length < 2 ? 'bg-gray-500 cursor-not-allowed' : 'bg-purple-400 hover:bg-purple-300'}`}
                      disabled={loading}
                  >
                      {loading ? "Salvando..." : `Salvar Seleção de Repescagem (${selectedRepechageRobots.length})`}
                  </button>
              </div>

              {/* SEÇÃO 2: GERAR PARTIDAS */}
              <div className="border-t border-white/20 pt-4">
                  <h3 className="text-lg font-bold text-white mb-2 text-left">2. Gerar Partidas</h3>
                  <p className="text-sm text-white/70 mb-4 text-left">
                      {state.matches.some(m => m.phase === 'repechage' && m.tournamentId === managingRepechage.id) ?
                          <span className="text-red-400 font-bold flex items-center gap-2"><X size={18} /> O chaveamento da repescagem JÁ FOI GERADO.</span> :
                          `Gere o chaveamento Round-Robin depois que a Fase de Grupos terminar. ${managingRepechage.repechageAdvanceCount} robô(s) será(ão) classificado(s) para a Fase Final.`
                      }
                  </p>
                  <button
                      onClick={() => generateRepechage(managingRepechage.id, managingRepechage.name)}
                      className={`w-full px-4 py-2 text-black font-bold rounded-lg transition flex items-center justify-center gap-2 ${
                          (managingRepechage.repechageRobotIds?.length || 0) < 2 || state.matches.some(m => m.phase === 'repechage' && m.tournamentId === managingRepechage.id)
                          ? 'bg-gray-500 cursor-not-allowed' 
                          : 'bg-green-600 hover:bg-green-500'
                      }`}
                      disabled={(managingRepechage.repechageRobotIds?.length || 0) < 2 || loading || state.matches.some(m => m.phase === 'repechage' && m.tournamentId === managingRepechage.id)}
                  >
                      <Play size={18} />
                      Gerar Chaveamento de Repescagem
                  </button>
              </div>
              
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={closeRepechageManager}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:opacity-80"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}