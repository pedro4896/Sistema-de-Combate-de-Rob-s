import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage, send } from "../ws";
import { Play, Pause, RotateCcw, AlarmClock, OctagonX } from "lucide-react";
import { Bot } from "lucide-react";

export default function Judge() {
  const [state, setState] = useState<any>(null);

  const recTime = state?.recoveryTimer ?? 0;
  const isRecRunning = !!state?.recoveryActive && !state?.recoveryPaused && recTime > 0;



  useEffect(() => {
    api("/state").then((r) => setState(r.state));
    return onMessage((m) => m.type === "UPDATE_STATE" && setState(m.payload.state));
  }, []);

  // Pega a luta atual; se não houver, pega a próxima pendente
  const current = useMemo(() => {
    if (!state) return null;
    return (
      state.matches.find((m: any) => m.id === state.currentMatchId) ??
      state.matches.find((m: any) => !m.finished) ??
      null
    );
  }, [state]);

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#000814] text-white"> 
        <h2 className="text-2xl font-bold">Carregando dados...</h2>
      </div>
    );
  }

  if (!current) {
  return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#000814] text-white">
        <h2 className="text-2xl font-bold mb-4">Nenhuma luta em andamento</h2>
        <p className="text-white/60">
          Aguarde o juiz iniciar uma partida para liberar a tela de Combate.
        </p>
      </div>
  );
}

if (current.finished) {
  return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#000814] text-white">
        <h2 className="text-2xl font-bold mb-4">Nenhuma luta em andamento</h2>
        <p className="text-white/60">
          Aguarde o juiz iniciar uma partida para liberar a tela de Combate.
        </p>
      </div>
  );
}

  const a = current.robotA, b = current.robotB;

  const mm = String(Math.floor((state.mainTimer || 0) / 60)).padStart(2, "0");
  const ss = String((state.mainTimer || 0) % 60).padStart(2, "0");
  const rec = state.recoveryTimer ?? 0;

  

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
     <Bot size={"80%"} className={`text-${color}-300`} />
    </div>
  );
};

  return (
    <div className="space-y-6">
      {/* Info dos robôs */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="heading mb-2">{a?.name ?? "—"}</div>
          <div className="sub mb-2">Equipe: {a?.team ?? "—"}</div>
          <div className="aspect-video bg-black/40 rounded-xl overflow-hidden flex items-center justify-center mb-2">
            {renderRobotImage(a, "blue")}
          </div>
          <div className="sub">Score: {current?.scoreA ?? 0}</div>
        </div>

        <div className="card">
          <div className="heading mb-2 text-right">{b?.name ?? "—"}</div>
          <div className="sub mb-2 text-right">Equipe: {b?.team ?? "—"}</div>
          <div className="aspect-video bg-black/40 rounded-xl overflow-hidden flex items-center justify-center mb-2">
            {renderRobotImage(b, "green")}
          </div>
          <div className="sub text-right">Score: {current?.scoreB ?? 0}</div>
        </div>
      </div>

    {/* Timers e Controles */}
    <div className="card text-center">
      <div className="sub uppercase">Timer principal (3min)</div>
      <div className="timer">{mm}:{ss}</div>

      <div className="mt-4 text-xl">
        Recuperação:{" "}
        <span className="font-extrabold text-arena-danger">
          {(state.recoveryTimer ?? 0)}s {state.recoveryPaused ? "(Pausado)" : ""}
        </span>
      </div>


      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {/* Botão único de iniciar/pausar 3min */}
        <button
          className={`btn flex items-center gap-2 btn-accent`}
          onClick={() => {
            if (state.mainStatus === "running") send("PAUSE_MAIN");
            else if (state.mainTimer > 0 && state.mainTimer < 180)
              send("RESUME_MAIN");
            else send("START_MAIN", { seconds: 180 });
          }}
        >
          {state.mainStatus === "running" ? <Pause size={16} /> : <Play size={16} />}
          {state.mainStatus === "running" ? "Pausar 3min" : "Iniciar 3min"}
        </button>

        {/* Reset 3min */}
        <button
          className="btn flex items-center gap-2"
          onClick={() => send("RESET_MAIN", { seconds: 180 })}
          title="Zera e volta para 3:00 parado"
        >
          <RotateCcw size={16} /> Resetar 3min
        </button>

        {/* Botão único de iniciar/pausar 10s */}
        <button
          className={`btn flex items-center gap-2 btn-danger`}
          onClick={() => {
            if (isRecRunning) {
              // Está contando → pausar
              send("PAUSE_RECOVERY");
            } else {
              // Não está contando → iniciar (novo) OU retomar
              if (!state.recoveryActive || recTime === 0) {
                // nunca iniciou / terminou / resetou
                send("START_RECOVERY", { seconds: 10 });
              } else {
                // pausado com tempo restante
                send("RESUME_RECOVERY");
              }
            }
          }}
        >
          {isRecRunning ? <Pause size={16} /> : <Play size={16} />}
          {isRecRunning ? "Pausar 10s" : "Iniciar 10s"}
        </button>



        {/* Reset 10s */}
        <button
          className="btn flex items-center gap-2"
          onClick={() => send("RESET_RECOVERY", { seconds: 10 })}
          title="Zera o cronômetro de 10 segundos"
        >
          <RotateCcw size={16} /> Resetar 10s
        </button>

        {/* Encerrar luta */}
        <button
          className="btn btn-danger flex items-center gap-2"
          onClick={() => send("END_MATCH")}
        >
          <OctagonX size={16} /> Encerrar Luta
        </button>
      </div>

      <div className="mt-3 sub">
        Status: {state.mainStatus || "idle"}{" "}
        {state.recoveryActive ? " | recovery" : ""}
      </div>
    </div>

      {/* Dica fluxo */}
      <div className="sub">
        Ao salvar a pontuação na tela **Pontuação**, o chaveamento promove automaticamente os vencedores para a próxima fase e o telão é atualizado.
      </div>
    </div>
  );
}
