import React, { useState } from "react";
import Robots from "./pages/Robots";
import Bracket from "./pages/Bracket";
import Judge from "./pages/Judge";
import Scores from "./pages/Scores";
import Screen from "./pages/Screen";
import Ranking from "./pages/Ranking";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import { Trophy, Sword, MonitorPlay, Users, Timer, LogIn, LogOut, Home, List } from "lucide-react";

export default function App() {
  const [tab, setTab] = useState<
    "robots" | "bracket" | "judge" | "scores" | "screen" | "ranking" | "login" | "landing"
  >("landing");

  const [isLogged, setIsLogged] = useState(!!localStorage.getItem("token"));

  // Componente padrão de botão do menu
  const Tab = ({
    id,
    icon,
    label,
  }: {
    id: any;
    icon: any;
    label: string;
  }) => (
    <button
      onClick={() => setTab(id)}
      className={`btn mx-1 flex items-center gap-1 ${
        tab === id ? "btn-accent text-black" : "bg-arena-card text-white"
      } hover:opacity-90 transition`}
    >
      {icon}
      <span className="ml-1 hidden sm:inline">{label}</span>
    </button>
  );

  // Função de callback para ser usada no Login
  const handleLogin = () => {
    setIsLogged(true);
    // Após o login, redireciona o usuário para a nova página de gerenciamento de robos
    setTab("robots"); 
  };
  
  // Função de callback para ser usada no Logout
  const handleLogout = () => {
    localStorage.removeItem("token");
    setIsLogged(false);
    // Após o logout, volta para a página pública de Ranking
    setTab("ranking");
  };

  return (
    <div className="min-h-screen">
      {/* ======= HEADER ======= */}
      <header className="sticky top-0 z-30 backdrop-blur bg-black/30 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          {/* LOGO E NOME ALINHADOS NA HORIZONTAL */}
          <div className="flex items-center gap-2">
            {/* CORRIGIDO: Agora usa setTab para navegação interna, evitando recarga de página */}
            <a onClick={() => setTab("landing")} className="cursor-pointer">
              <img
                src="/logoSpectron.svg"
                alt="Logo Spectron"
                className="w-20 h-20 object-contain"
              />
            </a>
          <h1 
            onClick={() => setTab("landing")}
            className="text-2xl font-extrabold tracking-widest cursor-pointer"
          >
            Spectro<span className="text-arena-accent">Clash</span>
          </h1>
          </div>

          {/* NAVEGAÇÃO */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Páginas públicas */}
            <Tab id="landing" icon={<Home size={18} />} label="Início" />
            <Tab id="ranking" icon={<Trophy size={18} />} label="Ranking" />
            <Tab id="screen" icon={<MonitorPlay size={18} />} label="Telão" />

            {/* Páginas restritas (apenas admin logado) */}
            {isLogged && (
              <>
                <Tab id="robots" icon={<Users size={18} />} label="Robôs" />
                <Tab id="bracket" icon={<Sword size={18} />} label="Chaveamento" />
                <Tab id="judge" icon={<Timer size={18} />} label="Luta" />
                <Tab id="scores" icon={<Trophy size={18} />} label="Pontuação" />
              </>
            )}

            {/* Botões de Login / Sair */}
            {!isLogged ? (
              <Tab id="login" icon={<LogIn size={16} />} label="Login" />
            ) : (
              <button
                onClick={handleLogout} // Usa a função corrigida
                className={`btn mx-1 flex items-center gap-1 bg-arena-card text-white hover:opacity-90 transition`}
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            )}
          </div>
        </div>
      </header>


      {/* ======= CONTEÚDO ======= */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Página Landing */}
        {tab === "landing" && <Landing />}

        {/* Páginas públicas */}
        {tab === "ranking" && <Ranking />}
        {tab === "screen" && <Screen />}

        {/* Login */}
        {tab === "login" && <Login onLogin={handleLogin} />} {/* Usa a função corrigida */}

        {/* Páginas restritas (apenas admin logado) */}
        {isLogged && tab === "robots" && <Robots />}
        {isLogged && tab === "bracket" && <Bracket />}
        {isLogged && tab === "judge" && <Judge />}
        {isLogged && tab === "scores" && <Scores />}

        {/* Tentativa de acessar restrita sem login */}
        {!isLogged &&
          ["robots", "bracket", "judge", "scores"].includes(tab) && (
            <div className="text-center text-white/70 mt-20">
              <h2 className="text-2xl font-bold mb-2">🔒 Acesso restrito</h2>
              <p>Faça login como administrador para acessar esta seção.</p>
            </div>
          )}
      </main>
    </div>
  );
}
