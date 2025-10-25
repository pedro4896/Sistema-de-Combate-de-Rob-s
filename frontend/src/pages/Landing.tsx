import React from "react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000814] to-[#001933] text-white flex flex-col items-center justify-center px-6 text-center">
      {/* LOGO */}
      <h1 className="text-5xl font-extrabold mb-4 tracking-widest">
        Spectro<span className="text-arena-accent">Clash</span>
      </h1>
      <p className="text-lg text-white/80 max-w-lg mb-10">
        Bem-vindo ao sistema de gerenciamento de batalhas de robôs. A Arena v3
        oferece uma plataforma para controlar cronômetros, pontuação, exibir
        resultados e até acompanhar as lutas em tempo real.
      </p>

      {/* DESCRIÇÃO DAS FUNCIONALIDADES */}
      <div className="space-y-10 mt-12">
        <div className="flex flex-col sm:flex-row gap-8 items-center">
          <div className="bg-white/10 p-6 rounded-xl shadow-lg w-72">
            <h2 className="text-2xl font-bold text-arena-accent mb-3">Controle de Combates</h2>
            <p className="text-sm text-white/70">
              Cronometragem dos combates, desde a fase de grupos até a luta final. Tudo sincronizado.
            </p>
          </div>

          <div className="bg-white/10 p-6 rounded-xl shadow-lg w-72">
            <h2 className="text-2xl font-bold text-arena-accent mb-3">Pontuação em Tempo Real</h2>
            <p className="text-sm text-white/70">
              A pontuação dos robôs é calculada em tempo real por jurados, com métricas de dano e agressividade.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-8 items-center">
          <div className="bg-white/10 p-6 rounded-xl shadow-lg w-72">
            <h2 className="text-2xl font-bold text-arena-accent mb-3">Telão Interativo</h2>
            <p className="text-sm text-white/70">
              Exibição ao vivo das batalhas no telão, com resultado e estatísticas das lutas.
            </p>
          </div>

          <div className="bg-white/10 p-6 rounded-xl shadow-lg w-72">
            <h2 className="text-2xl font-bold text-arena-accent mb-3">Fase de Grupos e Mata-Mata</h2>
            <p className="text-sm text-white/70">
              Organize as lutas em grupos e avance para o mata-mata até a grande final.
            </p>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="mt-16 text-sm text-white/40">
        Desenvolvido por Pedro Victor • Projeto Arena de Combate 🤖⚔️
      </footer>
    </div>
  );
}
