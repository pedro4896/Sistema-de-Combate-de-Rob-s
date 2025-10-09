import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

/* -------------------- Tipos -------------------- */
interface Robot {
  id: string;
  name: string;
  team?: string;
  image?: string;
}

interface ScoreDetail {
  judgeId: string;
  damageA: number;
  damageB: number;
  hitsA: number;
  hitsB: number;
}

interface Match {
  id: string;
  phase: "groups" | "elimination";
  round: number;
  group: string | null;
  robotA: Robot | null;
  robotB: Robot | null;
  scoreA: number;
  scoreB: number;
  winner: Robot | null;
  finished: boolean;
  judges?: ScoreDetail[];
}

interface ArenaState {
  robots: Robot[];
  matches: Match[];
  currentMatchId: string | null;
  mainTimer: number;
  recoveryTimer: number;
  mainStatus: "idle" | "running" | "paused" | "finished";
  recoveryActive: boolean;
  winner: Robot | null;
  lastWinner: Robot | null;
  ranking: any[];
  groupTables: Record<string, any>;
  groupCount?: number;
  advancePerGroup?: number;
}

const app = express();
app.use(cors());
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server });
const PORT = Number(process.env.PORT || 8080);

/* -------------------- Estado Global -------------------- */
let state: ArenaState = {
  robots: [],
  matches: [],
  currentMatchId: null,
  mainTimer: 0,
  recoveryTimer: 0,
  mainStatus: "idle",
  recoveryActive: false,
  winner: null,
  lastWinner: null,
  ranking: [],
  groupTables: {}
};

/* -------------------- Utilitários -------------------- */
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

/* -------------------- Timers -------------------- */
let mainTick: NodeJS.Timeout | null = null;
let recoveryTick: NodeJS.Timeout | null = null;

function stopAllTimers() {
  if (mainTick) clearInterval(mainTick);
  if (recoveryTick) clearInterval(recoveryTick);
  mainTick = null;
  recoveryTick = null;
}

function resetTimers() {
  stopAllTimers();
  state.mainTimer = 0;
  state.recoveryTimer = 0;
  state.mainStatus = "idle";
  state.recoveryActive = false;
}

function setCurrentMatch(id: string | null) {
  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  if (id) state.winner = null;
  broadcast("UPDATE_STATE", { state });
}

function startMainTimer(seconds = 180) {
  stopAllTimers();
  state.mainTimer = seconds;
  state.mainStatus = "running";
  broadcast("UPDATE_STATE", { state });
  mainTick = setInterval(() => {
    if (state.mainStatus !== "running") return;
    state.mainTimer = Math.max(0, state.mainTimer - 1);
    broadcast("UPDATE_STATE", { state });
    if (state.mainTimer === 0) endMatchNow();
  }, 1000);
}

function startRecoveryTimer(seconds = 10) {
  if (state.mainStatus === "running") {
    state.mainStatus = "paused";
    if (mainTick) clearInterval(mainTick);
  }
  state.recoveryActive = true;
  state.recoveryTimer = seconds;
  broadcast("UPDATE_STATE", { state });

  recoveryTick = setInterval(() => {
    if (!state.recoveryActive) return;
    state.recoveryTimer = Math.max(0, state.recoveryTimer - 1);
    broadcast("UPDATE_STATE", { state });

    if (state.recoveryTimer === 0) {
      clearInterval(recoveryTick!);
      state.recoveryActive = false;
      if (state.mainTimer > 0) startMainTimer(state.mainTimer);
      else endMatchNow();
    }
  }, 1000);
}

function endMatchNow() {
  stopAllTimers();
  state.mainStatus = "finished";
  state.recoveryActive = false;
  broadcast("UPDATE_STATE", { state });
}

/* -------------------- Chaveamento Dinâmico -------------------- */
function divideGroupsDynamic(robots: Robot[], groupCount: number, robotsPerGroup: number): Robot[][] {
  const shuffled = shuffle(robots);
  const groups: Robot[][] = Array.from({ length: groupCount }, () => []);

  let gi = 0;
  for (const r of shuffled) {
    groups[gi].push(r);
    gi = (gi + 1) % groupCount;
  }

  const hasSingle = () => groups.some(g => g.length === 1);
  while (hasSingle()) {
    let largest = groups.reduce((a, b) => (a.length > b.length ? a : b));
    let smallest = groups.find(g => g.length === 1);
    if (!smallest || largest.length <= 2) break;
    smallest.push(largest.pop()!);
  }

  return groups.filter(g => g.length > 0);
}

/* ---- ROUND-ROBIN BALANCEADO ---- */
function generateGroupMatches(groups: Robot[][]): Match[] {
  const matches: Match[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = [...groups[gi]];
    const label = String.fromCharCode(65 + gi);

    if (group.length % 2 !== 0)
      group.push({ id: "bye", name: "Folga" } as Robot);

    const totalRounds = group.length - 1;
    const half = group.length / 2;

    for (let round = 0; round < totalRounds; round++) {
      const rodada: [Robot, Robot][] = [];
      for (let i = 0; i < half; i++) {
        const a = group[i];
        const b = group[group.length - 1 - i];
        if (a.id !== "bye" && b.id !== "bye") rodada.push([a, b]);
      }

      for (const [A, B] of rodada) {
        matches.push({
          id: uuidv4(),
          phase: "groups",
          round: round + 1,
          group: label,
          robotA: A,
          robotB: B,
          scoreA: 0,
          scoreB: 0,
          winner: null,
          finished: false
        });
      }

      const fixed = group[0];
      const rest = group.slice(1);
      rest.unshift(rest.pop()!);
      group.splice(0, group.length, fixed, ...rest);
    }
  }

  return matches;
}

/* -------------------- Pontuação dos Jurados -------------------- */
function calculateWinnerFromJudges(judges: ScoreDetail[]): { totalA: number; totalB: number; winner: "A" | "B" | null } {
  let totalA = 0;
  let totalB = 0;
  for (const j of judges) {
    totalA += j.damageA + j.hitsA;
    totalB += j.damageB + j.hitsB;
  }
  if (totalA > totalB) return { totalA, totalB, winner: "A" };
  if (totalB > totalA) return { totalA, totalB, winner: "B" };
  return { totalA, totalB, winner: null };
}

/* -------------------- Funções Auxiliares -------------------- */
function computeGroupTables() {
  const tables: Record<string, any> = {};
  const groupMatches = state.matches.filter(m => m.phase === "groups");
  const groups = Array.from(new Set(groupMatches.map(m => m.group).filter(Boolean))) as string[];

  for (const g of groups) tables[g] = {};

  for (const m of groupMatches) {
    const g = m.group as string;
    if (!m.robotA || !m.robotB) continue;
    const A = m.robotA.id;
    const B = m.robotB.id;

    if (!tables[g][A])
      tables[g][A] = { robotId: A, name: m.robotA.name, pts: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0 };
    if (!tables[g][B])
      tables[g][B] = { robotId: B, name: m.robotB.name, pts: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0 };

    if (!m.finished) continue;
    tables[g][A].gf += m.scoreA; tables[g][A].ga += m.scoreB;
    tables[g][B].gf += m.scoreB; tables[g][B].ga += m.scoreA;

    if (m.scoreA > m.scoreB) {
      tables[g][A].pts += 3; tables[g][A].wins++; tables[g][B].losses++;
    } else if (m.scoreB > m.scoreA) {
      tables[g][B].pts += 3; tables[g][B].wins++; tables[g][A].losses++;
    } else {
      tables[g][A].pts++; tables[g][B].pts++; tables[g][A].draws++; tables[g][B].draws++;
    }
  }

  const result: Record<string, any[]> = {};
  for (const g of groups) {
    result[g] = Object.values(tables[g]).sort((a: any, b: any) =>
      b.pts - a.pts || b.gf - a.gf || b.ga - a.ga
    );
  }
  return result;
}

/* -------------------- Geração principal -------------------- */
function generateTournament(groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2) {
  const robots = [...state.robots];
  if (robots.length < 2) return;

  let groups = divideGroupsDynamic(robots, groupCount, robotsPerGroup);
  const groupMatches = generateGroupMatches(groups);

  state.matches = groupMatches;
  state.groupTables = computeGroupTables();
  state.groupCount = groupCount;
  state.advancePerGroup = advancePerGroup;
  state.currentMatchId = groupMatches[0]?.id ?? null;
  broadcast("UPDATE_STATE", { state });
}

/* -------------------- ENDPOINTS -------------------- */
app.get("/state", (_req, res) => res.json({ state }));

app.post("/robots", (req, res) => {
  const { name, team, image } = req.body;
  const robot: Robot = { id: uuidv4(), name, team, image };
  state.robots.push(robot);
  broadcast("UPDATE_STATE", { state });
  res.json(robot);
});

app.post("/matches/generate", (req, res) => {
  const { groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2 } = req.body || {};
  generateTournament(groupCount, robotsPerGroup, advancePerGroup);
  res.json({ ok: true });
});

app.post("/matches/:id/judges", (req, res) => {
  const { judges } = req.body;
  const match = state.matches.find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: "Match not found" });

  match.judges = judges;
  const result = calculateWinnerFromJudges(judges);
  match.scoreA = result.totalA;
  match.scoreB = result.totalB;
  match.winner = result.winner === "A" ? match.robotA : match.robotB;
  match.finished = true;
  state.groupTables = computeGroupTables();
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true, result });
});

app.post("/arena/reset", (_req, res) => {
  stopAllTimers();
  state = {
    robots: [],
    matches: [],
    currentMatchId: null,
    mainTimer: 0,
    recoveryTimer: 0,
    mainStatus: "idle",
    recoveryActive: false,
    winner: null,
    lastWinner: null,
    ranking: [],
    groupTables: {}
  };
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true });
});

/* -------------------- WEBSOCKET -------------------- */
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "UPDATE_STATE", payload: { state } }));
  ws.on("message", (raw) => {
    try {
      const { type, payload } = JSON.parse(String(raw));
      switch (type) {
        case "START_MAIN": startMainTimer(payload?.seconds ?? 180); break;
        case "PAUSE_MAIN": state.mainStatus = "paused"; break;
        case "RESUME_MAIN": startMainTimer(state.mainTimer); break;
        case "RESET_MAIN": resetTimers(); broadcast("UPDATE_STATE", { state }); break;
        case "START_RECOVERY": startRecoveryTimer(payload?.seconds ?? 10); break;
        case "END_MATCH": endMatchNow(); break;
      }
    } catch {}
  });
});

server.listen(PORT, () =>
  console.log(`✅ Arena Backend v7.0 (Chaveamento + Pontuação Jurados) @${PORT}`)
);
