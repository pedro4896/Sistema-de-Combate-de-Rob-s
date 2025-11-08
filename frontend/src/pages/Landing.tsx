import React, { useState, useEffect } from "react";

export default function Landing() {
  // Estado para o índice da imagem atual
  const [currentIndex, setCurrentIndex] = useState(0);

  // Lista de imagens para o carrossel
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

  // Função para avançar as imagens no carrossel
  const nextImage = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
  };

  // Função para voltar as imagens no carrossel
  const prevImage = () => {
    setCurrentIndex(
      (prevIndex) => (prevIndex - 1 + images.length) % images.length
    );
  };

  // Autoplay: Avança a cada 3 segundos
  useEffect(() => {
    const interval = setInterval(nextImage, 3000);
    return () => clearInterval(interval); // Limpar o intervalo quando o componente for desmontado
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000814] to-[#001933] text-white flex flex-col items-center justify-start px-6 py-10">
      {/* LOGO E TÍTULO */}
      <div className="flex flex-col items-center mb-1">
        <img
          src="/roboClash.png"
          alt="Logo RoboClash"
          className="w-[300px] h-[300px] object-contain"
        />
        <p className="text-lg text-white/80 max-w-lg mb-10">
          Bem-vindo ao sistema de gerenciamento de torneios de robôs. O RoboClash
          oferece uma plataforma para controlar cronômetros, pontuação e até acompanhar as lutas em tempo real.
        </p>
      </div>

      {/* ESPAÇO PARA PATROCINADORES PRINCIPAIS */}
      <div className="flex flex-col items-center gap-2 mb-5"> {/* Ajuste do gap para 2 */}
        {/* PRIMEIRA DIV - Imagem do Jardim Digital (em destaque) */}
        <div className="w-full max-w-md mb-4"> {/* Reduzido o espaço abaixo */}
          <img
            src="/JardimDigital.png"
            alt="Jardim Digital"
            className="w-full h-48 object-contain shadow-xl"
          />
        </div>

        {/* SEGUNDA DIV - Logos dos Patrocinadores (lado a lado) */}
        <div className="flex gap-4 justify-center w-full bg-[#ffffff] p-4 rounded-lg"> {/* Diminuição do padding e gap */}
          <img
            src="/copergas.png"
            alt="Copergás"
            className="w-32 h-32 object-contain"
          />
          <img
            src="/fundacaoBitury.png"
            alt="Fundação Bitury"
            className="w-32 h-32 object-contain"
          />
        </div>
      </div>

      {/* CARROSSEL DE IMAGENS (EDIÇÕES ANTERIORES) */}
      <div className="w-full max-w-6xl mb-16 relative">
        <h2 className="text-3xl text-center font-bold text-arena-accent mb-6">Edições Anteriores</h2>
        <div className="relative">
          <img
            src={images[currentIndex]}
            alt={`Edição ${currentIndex + 1}`}
            className="w-full max-w-4xl h-auto object-contain rounded-lg mx-auto transition-all duration-500 ease-in-out"
          />

          {/* Botões de navegação */}
          <button
            onClick={prevImage}
            className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-black/40 text-white p-2 rounded-full"
          >
            ❮
          </button>
          <button
            onClick={nextImage}
            className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-black/40 text-white p-2 rounded-full"
          >
            ❯
          </button>
        </div>
      </div>

      {/* MAIS PATROCINADORES */}
      <div className="flex gap-4 mb-10">
        <img src="/sponsor4.png" alt="Patrocinador 4" className="w-32 h-32 object-contain" />
        <img src="/sponsor5.png" alt="Patrocinador 5" className="w-32 h-32 object-contain" />
      </div>

      {/* FOOTER */}
      <footer className="mt-16 text-sm text-white/40">
        Desenvolvido por Pedro Victor • Projeto Arena de Combate 🤖⚔️
      </footer>
    </div>
  );
}
