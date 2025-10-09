import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ArenaState, Robot, Match, RankingItem, RoundName, MainStatus } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);
const server = createServer(app);
const wss = new WebSocketServer({ server });

let state: ArenaState = {
  robots: [],
  matches: [],
  currentRound: null,
  currentMatchId: null,
  mainTimer: 0,
  mainStatus: "idle",
  recoveryTimer: 0,
  recoveryActive: false,
  winner: null,
  ranking: []
};

let mainTick: NodeJS.Timeout | null = null;
let recoveryTick: NodeJS.Timeout | null = null;

function broadcast(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  for (const c of wss.clients)
    if (c.readyState === WebSocket.OPEN) c.send(msg);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function computeRanking(): RankingItem[] {
  const wins: Record<string, number> = {};
  for (const r of state.robots) wins[r.id] = 0;
  for (const m of state.matches)
    if (m.finished && m.winner) wins[m.winner.id] = (wins[m.winner.id] || 0) + 1;
  return state.robots
    .map(r => ({
      robotId: r.id,
      robotName: r.name,
      wins: wins[r.id] || 0
    }))
    .sort((a, b) => b.wins - a.wins || a.robotName.localeCompare(b.robotName));
}

function setMainStatus(s: MainStatus) {
  state.mainStatus = s;
  broadcast("UPDATE_STATE", { state });
}

function stopMainTick() {
  if (mainTick) clearInterval(mainTick);
  mainTick = null;
}
function stopRecoveryTick() {
  if (recoveryTick) clearInterval(recoveryTick);
  recoveryTick = null;
}

function startMainTimer(seconds = 180) {
  stopMainTick();
  state.mainTimer = seconds;
  setMainStatus("running");
  mainTick = setInterval(() => {
    if (state.mainStatus !== "running") return;
    state.mainTimer = Math.max(0, state.mainTimer - 1);
    broadcast("UPDATE_STATE", { state });
    if (state.mainTimer === 0) {
      endMatchNow();
    }
  }, 1000);
}

function startRecovery(seconds = 10) {
  stopRecoveryTick();
  if (state.mainStatus === "running") {
    stopMainTick();
    state.mainStatus = "paused";
  }
  state.recoveryTimer = seconds;
  state.recoveryActive = true;
  broadcast("UPDATE_STATE", { state });

  recoveryTick = setInterval(() => {
    if (!state.recoveryActive) return;
    state.recoveryTimer = Math.max(0, state.recoveryTimer - 1);
    broadcast("UPDATE_STATE", { state });
    if (state.recoveryTimer === 0) {
      stopRecoveryTick();
      state.recoveryActive = false;
      if (state.mainTimer > 0) startMainTimer(state.mainTimer);
      else endMatchNow();
    }
  }, 1000);
}

function endMatchNow(matchId?: string) {
  stopMainTick();
  stopRecoveryTick();
  state.recoveryActive = false;
  setMainStatus("finished");
  broadcast("UPDATE_STATE", { state });
}

function generateTournament() {
  const shuffled = shuffle(state.robots);
  const count = shuffled.length;
  const roundsNeeded = Math.ceil(Math.log2(count));
  const fullCount = 2 ** roundsNeeded;
  while (shuffled.length < fullCount)
    shuffled.push({ id: `bye-${shuffled.length}`, name: "BYE", team: "", image: "" });

  const rounds: RoundName[] = ["quarter", "semi", "final"];
  const firstRound = rounds[Math.max(0, rounds.length - roundsNeeded)];
  const makePair = (a: Robot | null, b: Robot | null, round: RoundName): Match => ({
    id: uuidv4(),
    round,
    robotA: a,
    robotB: b,
    scoreA: 0,
    scoreB: 0,
    winner: null,
    finished: false
  });

  const matches: Match[] = [];
  for (let i = 0; i < shuffled.length; i += 2)
    matches.push(makePair(shuffled[i], shuffled[i + 1], firstRound));

  state.matches = matches;
  state.currentRound = firstRound;
  state.currentMatchId = matches[0]?.id ?? null;
  state.ranking = computeRanking();
  broadcast("UPDATE_STATE", { state });
}

function findMatch(id: string) {
  return state.matches.find(m => m.id === id);
}

function allFinishedIn(round: RoundName) {
  return state.matches.filter(m => m.round === round).every(m => m.finished);
}

function nextRoundName(r: RoundName): RoundName | null {
  if (r === "quarter") return "semi";
  if (r === "semi") return "final";
  return null;
}

function promoteWinners(from: RoundName) {
  const winners = state.matches
    .filter(m => m.round === from)
    .map(m => m.winner)
    .filter(Boolean) as Robot[];

  const to = nextRoundName(from);
  if (!to) return;
  const nextMatches: Match[] = [];
  for (let i = 0; i < winners.length; i += 2)
    nextMatches.push({
      id: uuidv4(),
      round: to,
      robotA: winners[i] ?? null,
      robotB: winners[i + 1] ?? null,
      scoreA: 0,
      scoreB: 0,
      winner: null,
      finished: false
    });
  state.matches.push(...nextMatches);
  state.currentRound = to;
  state.currentMatchId = nextMatches[0]?.id ?? null;
}

function finalizeMatch(matchId: string, scoreA: number, scoreB: number) {
  const m = findMatch(matchId);
  if (!m) return;
  m.scoreA = scoreA;
  m.scoreB = scoreB;
  m.finished = true;
  if (m.scoreA > m.scoreB) m.winner = m.robotA;
  else if (m.scoreB > m.scoreA) m.winner = m.robotB;
  else m.winner = null;
  state.winner = m.winner ?? null;

  if (allFinishedIn(m.round)) {
    const next = nextRoundName(m.round);
    if (next) promoteWinners(m.round);
    else {
      state.currentRound = "final";
      state.currentMatchId = null;
    }
  } else {
    const nextMatch = state.matches
      .filter(x => x.round === m.round)
      .find(x => !x.finished);
    state.currentMatchId = nextMatch?.id ?? state.currentMatchId;
  }
  state.ranking = computeRanking();
  broadcast("UPDATE_STATE", { state });
}

/* ----------- WEBSOCKET ----------- */
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "UPDATE_STATE", payload: { state } }));
  ws.on("message", (raw) => {
    try {
      const { type, payload } = JSON.parse(String(raw));
      switch (type) {
        case "START_MATCH": startMainTimer(payload?.duration ?? 180); break;
        case "PAUSE_MAIN": stopMainTick(); state.mainStatus = "paused"; break;
        case "RESET_MAIN": stopMainTick(); state.mainTimer = payload?.seconds ?? 180; setMainStatus("idle"); break;
        case "START_RECOVERY": startRecovery(payload?.seconds ?? 10); break;
        case "STOP_RECOVERY": stopRecoveryTick(); state.recoveryActive = false; break;
        case "END_MATCH": endMatchNow(payload?.matchId); break;
      }
    } catch {}
  });
});

/* ----------- REST ----------- */
app.get("/state", (_req, res) => res.json({ state }));
app.post("/robots", (req, res) => {
  const { name, image, team } = req.body;
  const robot: Robot = { id: uuidv4(), name, image, team };
  state.robots.push(robot);
  state.ranking = computeRanking();
  broadcast("UPDATE_STATE", { state });
  res.json(robot);
});
app.post("/matches/generate-tournament", (_req, res) => {
  generateTournament();
  res.json({ matches: state.matches });
});
app.post("/matches/:id/result", (req, res) => {
  const { scoreA, scoreB } = req.body;
  finalizeMatch(req.params.id, scoreA, scoreB);
  res.json({ ok: true });
});
app.post("/arena/reset", (_req, res) => {
  state = {
    robots: [],
    matches: [],
    currentRound: null,
    currentMatchId: null,
    mainTimer: 0,
    mainStatus: "idle",
    recoveryTimer: 0,
    recoveryActive: false,
    winner: null,
    ranking: []
  };
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true });
});

server.listen(PORT, () => console.log(`✅ Backend rodando em ${PORT}`));
