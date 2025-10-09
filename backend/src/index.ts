import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ArenaState, Robot, Match, RankingItem, ArenaStatus } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);
const server = createServer(app);
const wss = new WebSocketServer({ server });

/* ----------------- STATE ----------------- */
let state: ArenaState = {
  robots: [],
  matches: [],
  currentMatchId: null,
  timer: 0,
  recoveryTimer: 0,
  status: "idle",
  winner: null,
  ranking: []
};

let tickInterval: NodeJS.Timeout | null = null;

function broadcast(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

function setStatus(s: ArenaStatus) {
  state.status = s;
  broadcast("UPDATE_STATE", { state });
}

function stopTick() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function startMainTimer(seconds = 180) {
  stopTick();
  state.timer = seconds;
  state.recoveryTimer = 0;
  setStatus("running");
  tickInterval = setInterval(() => {
    if (state.status !== "running") return;
    state.timer = Math.max(0, state.timer - 1);
    broadcast("UPDATE_STATE", { state });
    if (state.timer === 0) {
      setStatus("finished");
      stopTick();
    }
  }, 1000);
}

function startRecoveryTimer(seconds = 10) {
  stopTick();
  state.recoveryTimer = seconds;
  setStatus("recovery");
  tickInterval = setInterval(() => {
    if (state.status !== "recovery") return;
    state.recoveryTimer = Math.max(0, state.recoveryTimer - 1);
    broadcast("UPDATE_STATE", { state });
    if (state.recoveryTimer === 0) {
      setStatus("paused"); // após recovery, volta pausado para decisão do juiz
      stopTick();
    }
  }, 1000);
}

function computeRanking(): RankingItem[] {
  const wins: Record<string, number> = {};
  for (const r of state.robots) wins[r.id] = 0;
  for (const m of state.matches) {
    if (m.finished && m.winner) wins[m.winner] = (wins[m.winner] || 0) + 1;
  }
  const result: RankingItem[] = state.robots.map(r => ({
    robotId: r.id,
    robotName: r.name,
    wins: wins[r.id] || 0
  }));
  result.sort((a, b) => b.wins - a.wins || a.robotName.localeCompare(b.robotName));
  return result;
}

function findMatch(id: string) {
  return state.matches.find(m => m.id === id);
}

/* ----------------- WS ----------------- */
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "UPDATE_STATE", payload: { state } }));
  ws.on("message", (raw) => {
    try {
      const { type, payload } = JSON.parse(String(raw));
      switch (type) {
        case "START_MATCH": {
          const { matchId, duration = 180 } = payload;
          if (findMatch(matchId)) {
            state.currentMatchId = matchId;
            startMainTimer(duration);
          }
          break;
        }
        case "PAUSE": {
          setStatus("paused");
          break;
        }
        case "RESUME": {
          if (state.timer > 0) {
            setStatus("running");
            startMainTimer(state.timer);
          }
          break;
        }
        case "START_RECOVERY": {
          const { seconds = 10 } = payload || {};
          startRecoveryTimer(seconds);
          break;
        }
        case "SET_STATUS": {
          setStatus(payload.status);
          break;
        }
        default:
          break;
      }
    } catch (e) {
      console.error("Invalid WS msg", e);
    }
  });
});

/* ----------------- REST ----------------- */
app.get("/state", (_req, res) => res.json({ state }));

app.post("/robots", (req, res) => {
  const { name, image } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const robot: Robot = { id: uuidv4(), name, image };
  state.robots.push(robot);
  state.ranking = computeRanking();
  broadcast("UPDATE_STATE", { state });
  res.status(201).json(robot);
});

app.delete("/robots/:id", (req, res) => {
  const id = req.params.id;
  state.robots = state.robots.filter(r => r.id !== id);
  state.matches = state.matches.map(m => {
    if (m.robotA?.id === id) m.robotA = null;
    if (m.robotB?.id === id) m.robotB = null;
    return m;
  });
  state.ranking = computeRanking();
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true });
});

// gera pares simples (rodada 1)
app.post("/matches/generate", (_req, res) => {
  const robots = [...state.robots];
  const matches: Match[] = [];
  for (let i = 0; i < robots.length; i += 2) {
    matches.push({
      id: uuidv4(),
      round: 1,
      robotA: robots[i] ?? null,
      robotB: robots[i + 1] ?? null,
      scoreA: 0,
      scoreB: 0,
      winner: null,
      finished: false
    });
  }
  state.matches = matches;
  state.currentMatchId = matches[0]?.id ?? null;
  state.ranking = computeRanking();
  broadcast("UPDATE_STATE", { state });
  res.json({ matches });
});

// iniciar match também via REST (opcional)
app.post("/matches/:id/start", (req, res) => {
  const { duration = 180 } = req.body || {};
  const id = req.params.id;
  if (!findMatch(id)) return res.status(404).json({ error: "match not found" });
  state.currentMatchId = id;
  startMainTimer(duration);
  res.json({ ok: true });
});

// resultado + ranking
app.post("/matches/:id/result", (req, res) => {
  const id = req.params.id;
  const { scoreA = 0, scoreB = 0 } = req.body || {};
  const m = findMatch(id);
  if (!m) return res.status(404).json({ error: "match not found" });

  m.scoreA = Number(scoreA);
  m.scoreB = Number(scoreB);
  m.finished = true;
  if (m.scoreA > m.scoreB) m.winner = m.robotA?.id ?? null;
  else if (m.scoreB > m.scoreA) m.winner = m.robotB?.id ?? null;
  else m.winner = null;

  state.winner = m.winner;
  setStatus("finished");
  stopTick();
  state.ranking = computeRanking();

  // avança para próxima luta pendente
  const idx = state.matches.findIndex(x => x.id === id);
  const next = state.matches.slice(idx + 1).find(x => !x.finished);
  state.currentMatchId = next?.id ?? null;

  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true, ranking: state.ranking });
});

app.get("/ranking", (_req, res) => {
  res.json({ ranking: state.ranking });
});

app.post("/arena/reset", (_req, res) => {
  stopTick();
  state = {
    robots: [],
    matches: [],
    currentMatchId: null,
    timer: 0,
    recoveryTimer: 0,
    status: "idle",
    winner: null,
    ranking: []
  };
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true });
});

server.listen(PORT, () => console.log(`✅ backend @ ${PORT}`));
