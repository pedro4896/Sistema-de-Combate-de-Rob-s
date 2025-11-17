import React, { useState, useEffect, useCallback } from "react";
// Importação do componente Link para navegação interna
import { Link } from "react-router-dom"; 

// Componente simples e reutilizável para os logos dos Patrocinadores
const SponsorLogo: React.FC<{ src: string; alt: string }> = ({ src, alt }) => (
  <div className="p-2 flex items-center justify-center">
    <img
      src={src}
      alt={alt}
      // Aplica filtro preto e branco (grayscale) e reduz a opacidade para um visual mais 'premium' e 'parceiros', 
      // mas permite a cor original (filter-none) e opacidade total ao passar o mouse.
      className="max-h-16 w-auto object-contain"
    />
  </div>
);

export default function Landing() {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Lista de imagens para o carrossel (mantida)
  const images = [
    "/arenaRobotica/arena1.jpg",
    "/arenaRobotica/arena2.jpg",
    "/arenaRobotica/arena3.jpg",
    "/arenaRobotica/arena4.jpg",
    "/arenaRobotica/arena5.jpg",
    "/arenaRobotica/arena6.jpg",
    "/arenaRobotica/arena7.jpg",
    "/arenaRobotica/arena8.jpg",
    "/arenaRobotica/arena9.jpg",
    "/arenaRobotica/arena10.jpg",
    "/arenaRobotica/arena11.jpg",
    "/arenaRobotica/arena12.jpg",
    "/arenaRobotica/arena13.jpg",
    "/arenaRobotica/arena14.jpg",
    "/arenaRobotica/arena15.jpg",
    "/arenaRobotica/arena16.jpg",
    "/arenaRobotica/arena17.jpg",
    "/arenaRobotica/arena18.jpg"
  ];

  // Lógica do Carrossel (mantida)
  const nextImage = useCallback(() => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
  }, [images.length]);

  const prevImage = useCallback(() => {
    setCurrentIndex(
      (prevIndex) => (prevIndex - 1 + images.length) % images.length
    );
  }, [images.length]);

  // Autoplay: Avança a cada 4 segundos
  useEffect(() => {
    const interval = setInterval(nextImage, 4000); 
    return () => clearInterval(interval);
  }, [nextImage]);

  return (
    // Fundo mais escuro (quase preto) para um visual mais robusto e profissional
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center pt-20 pb-16">
      
      {/* 🤖 SEÇÃO HERO - MAIS IMPACTO */}
      <div className="w-full max-w-4xl text-center px-6 mb-24">
        <img
          src="/roboClash.png"
          alt="Logo RoboClash"
          className="w-40 h-40 object-contain mx-auto mb-6" 
        />
        
        {/* Título principal */}
        <h1 className="text-7xl font-extrabold mb-2 
                       bg-clip-text text-transparent 
                       bg-gradient-to-r from-[#00FF9C] to-white/90">
          ROBOCLASH ARENA
        </h1>
        
        {/* ⭐️ Frase de Destaque 1 (Otimizada) */}
        <h2 className="text-2xl font-semibold text-white/80 mb-6">
            O ápice da engenharia em combate. **Sua vitória começa na nossa plataforma**.
        </h2>
        
        {/* ⭐️ Slogan Curto (Otimizado) */}
        <p className="text-xl italic text-[#00FF9C] mb-10">
          O Controle da Arena, em Suas Mãos.
        </p>
        
        {/* Botão principal de Ação */}
        <a 
          href="/screen" 
          className="mt-4 px-10 py-3 bg-[#00FF9C] text-[#0A0A0A] font-bold 
                     rounded-full shadow-lg hover:shadow-[#00FF9C]/50 
                     transition-all duration-300 uppercase tracking-widest text-lg inline-block"
          target="_self" 
        >
          Acessar o Painel
        </a>
      </div>

      {/* 🤝 SEÇÃO DE PARCEIROS E APOIO (CONSOLIDADA E LIMPA) */}
      <div className="w-full max-w-6xl px-6 mb-24">
        <h2 className="text-2xl text-center font-bold text-[#00FF9C]/90 mb-10 
                       tracking-wider uppercase border-b border-[#00FF9C]/30 pb-4">
          Apoio Institucional e Patrocinadores
        </h2>
        
        <div className="flex flex-wrap justify-center items-center gap-10 bg-[#fff] p-10 rounded-2xl shadow-2xl shadow-[#00FF9C]/10">
          
          {/* Grid unificado para todos os logos */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-6 justify-items-center w-full">
            <SponsorLogo src="/JardimDigital.png" alt="Jardim Digital" />
            <SponsorLogo src="/copergas.png" alt="Copergás" />
            <SponsorLogo src="/fundacaoBitury.png" alt="Fundação Bitury" />
            <SponsorLogo src="/logoSpectron.png" alt="Spectron" /> 
          </div>
        </div>
      </div>

      {/* 📸 CARROSSEL DE IMAGENS (EDIÇÕES ANTERIORES) - VISUAL ELEGANTE */}
      <div className="w-full max-w-6xl px-6 relative">
        <h2 className="text-3xl text-center font-bold text-[#00FF9C] mb-2">
          Galeria: Batalhas Históricas
        </h2>
        <p className="text-lg text-center text-white/70 mb-8">
            Reviva cada faísca: **Momentos épicos** que redefiniram a robótica.
        </p>
        <div className="relative rounded-xl shadow-2xl shadow-white/10 overflow-hidden" 
             style={{ aspectRatio: '16 / 9' }}>
          
          {/* Imagem do Carrossel */}
          <img
            src={images[currentIndex]}
            alt={`Edição ${currentIndex + 1}`}
            className="w-full h-full object-cover transition-opacity duration-700 ease-in-out" 
          />
          
          {/* Botões de navegação */}
          <button
            onClick={prevImage}
            className="absolute left-4 top-1/2 transform -translate-y-1/2 
                       bg-black/50 text-white p-3 rounded-full hover:bg-black/70 
                       transition-colors z-10 text-xl font-extrabold"
          >
            ❮
          </button>
          <button
            onClick={nextImage}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 
                       bg-black/50 text-white p-3 rounded-full hover:bg-black/70 
                       transition-colors z-10 text-xl font-extrabold"
          >
            ❯
          </button>
          
          {/* Indicadores de slide (opcional, mas profissional) */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center space-x-2 z-10">
            {images.map((_, index) => (
              <div
                key={index}
                className={`h-2 w-2 rounded-full cursor-pointer transition-all duration-300 ${
                  index === currentIndex ? 'bg-[#00FF9C] w-6' : 'bg-white/40'
                }`}
                onClick={() => setCurrentIndex(index)}
              />
            ))}
          </div>

        </div>
      </div>

      {/* 🚀 FOOTER OTIMIZADO COM ÍCONE E ARROBA ALINHADOS */}
      <footer className="mt-24 text-sm text-white/40 border-t border-white/10 pt-6 w-full text-center">
        <div className="flex flex-col items-center justify-center gap-4">
          
          {/* Ícone do Instagram e Arroba Alinhados Horizontalmente */}
          <a 
            href="https://www.instagram.com/pedrovictor/" 
            target="_blank" 
            rel="noopener noreferrer" 
            aria-label="Instagram de Pedro Victor"
            className="mt-4 flex items-center gap-2 text-white/70 hover:text-[#00FF9C] transition-colors"
          >
            {/* ⭐️ COLOQUE O CÓDIGO SVG/ÍCONE AQUI ⭐️ */}
            <svg 
                className="w-5 h-5"
                fill="none" 
                stroke="currentColor" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth="2" 
                viewBox="0 0 24 24"
            >
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
            {/* ⭐️ FIM DO ÍCONE ⭐️ */}
            <span className="text-base font-medium">@PedroVictor</span>
          </a>

          {/* Texto do Desenvolvedor */}
          <p className="text-sm">
            Desenvolvido por Pedro Victor • Projeto Arena de Combate 🤖⚔️
          </p>
        </div>
      </footer>
    </div>
  );
}