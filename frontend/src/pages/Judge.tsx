import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { onMessage, send } from "../ws";
import { Play, Pause, RotateCcw, AlarmClock, OctagonX } from "lucide-react";

export default function Judge() {
  const [state, setState] = useState<any>(null);

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

  if (!state) return <p className="sub">Carregando...</p>;
  if (!current) return <p className="sub">Sem lutas ativas no momento.</p>;

  const a = current.robotA, b = current.robotB;

  const mm = String(Math.floor((state.mainTimer || 0) / 60)).padStart(2, "0");
  const ss = String((state.mainTimer || 0) % 60).padStart(2, "0");
  const rec = state.recoveryActive ? state.recoveryTimer : 0;

  return (
    <div className="space-y-6">
      {/* Info dos robôs */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="heading mb-2">{a?.name ?? "—"}</div>
          <div className="sub mb-2">Equipe: {a?.team ?? "—"}</div>
          <div className="aspect-video bg-black/40 rounded-xl overflow-hidden flex items-center justify-center mb-2">
            {a?.image ? <img src={a.image} className="w-full h-full object-cover" /> : <span className="sub">Sem imagem</span>}
          </div>
          <div className="sub">Score: {current?.scoreA ?? 0}</div>
        </div>

        <div className="card">
          <div className="heading mb-2 text-right">{b?.name ?? "—"}</div>
          <div className="sub mb-2 text-right">Equipe: {b?.team ?? "—"}</div>
          <div className="aspect-video bg-black/40 rounded-xl overflow-hidden flex items-center justify-center mb-2">
            {b?.image ? <img src={b.image} className="w-full h-full object-cover" /> : <span className="sub">Sem imagem</span>}
          </div>
          <div className="sub text-right">Score: {current?.scoreB ?? 0}</div>
        </div>
      </div>

      {/* Timers e Controles */}
      <div className="card text-center">
        <div className="sub uppercase">Timer principal (3min)</div>
        <div className="timer">{mm}:{ss}</div>

        {state.recoveryActive && (
          <div className="mt-2 text-xl">
            Recuperação: <span className="font-extrabold text-arena-danger">{rec}s</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {/* Iniciar/Reiniciar principal em 180s */}
          <button
            className="btn btn-accent flex items-center gap-2"
            onClick={() => send("START_MAIN", { seconds: 180 })}
            title="Inicia o cronômetro principal em 3min"
          >
            <Play size={16} /> Iniciar 3min
          </button>

          {/* Pausar principal */}
          <button
            className="btn flex items-center gap-2"
            onClick={() => send("PAUSE_MAIN")}
          >
            <Pause size={16} /> Pausar
          </button>

          {/* Retomar principal de onde parou */}
          <button
            className="btn flex items-center gap-2"
            onClick={() => send("RESUME_MAIN")}
          >
            <RotateCcw size={16} /> Retomar 3min
          </button>

          {/* Reset total do cronômetro principal (zera e volta para idle) */}
          <button
            className="btn flex items-center gap-2"
            onClick={() => send("RESET_MAIN", { seconds: 180 })}
            title="Zera e volta para 3:00 parado"
          >
            <RotateCcw size={16} /> Resetar 3min
          </button>

          {/* Iniciar recuperação 10s (pausa 3min automaticamente e retoma ao terminar) */}
          <button
            className="btn btn-danger flex items-center gap-2"
            onClick={() => send("START_RECOVERY", { seconds: 10 })}
            title="Pausa 3min e inicia 10s; ao acabar, 3min retoma"
          >
            <AlarmClock size={16} /> Iniciar 10s
          </button>

          {/* Encerrar luta imediatamente */}
          <button
            className="btn btn-danger flex items-center gap-2"
            onClick={() => send("END_MATCH")}
          >
            <OctagonX size={16} /> Encerrar Luta
          </button>
        </div>

        <div className="mt-2 sub">
          Status: {state.mainStatus} {state.recoveryActive ? " | recovery" : ""}
        </div>
      </div>

      {/* Dica fluxo */}
      <div className="sub">
        Ao salvar a pontuação na tela **Pontuação**, o chaveamento promove automaticamente os vencedores para a próxima fase e o telão é atualizado.
      </div>
    </div>
  );
}
